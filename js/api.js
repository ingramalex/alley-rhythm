/* ── Resilient Apps Script client — shared by index / upload / admin ──
 *
 * Google Apps Script web apps intermittently stall for 10–40s and then answer
 * with an HTML "Sorry, unable to open the file at this time" page (HTTP 404)
 * instead of running the script. It is transient — the same request usually
 * succeeds a second later — so every read (and every idempotent POST) is
 * retried with backoff, and a non-JSON body is treated as a transient failure
 * rather than a real error.
 */

// POST actions that are safe to replay if Google dropped the first attempt.
// Mutations (save_session, upload_image, add_user…) are deliberately NOT here.
var LANE_IDEMPOTENT_POST = {
  get_roster: 1, whoami: 1, admin_verify: 1, list_users: 1, export_all: 1, list_leagues_admin: 1,
};

/**
 * fetch() that returns parsed JSON, retrying transient Google failures.
 * Resolves to { ok, status, json }. Rejects only after all attempts fail
 * (network error) or on a transient failure that never cleared.
 */
async function laneFetchJSON(url, opts, { retries = 3, baseDelay = 1500, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // A stalled execution usually ends in Google's 404 page 30-50s later; a healthy
    // one answers in a few seconds. Abandon slow attempts early and retry instead.
    // timeoutMs = 0 disables this (used for mutations, which may legitimately be slow).
    const ctl = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctl.signal });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (_) {}
      if (j !== null) return { ok: r.ok, status: r.status, json: j };
      // HTML/empty body — Google's transient error page, not our script.
      lastErr = Object.assign(
        new Error('Backend temporarily unavailable (HTTP ' + r.status + ')'),
        { status: r.status, transient: true }
      );
    } catch (e) {
      lastErr = e; // network failure or our own timeout — also worth retrying
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (attempt < retries) {
      await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

/** GET ?action=…&leagueId=… with retry. Throws Error(j.error) on backend errors. */
async function laneApiGet(scriptUrl, action, leagueId, extra) {
  const qs = new URLSearchParams({ action, leagueId: leagueId || '', ...(extra || {}) });
  const { ok, status, json } = await laneFetchJSON(`${scriptUrl}?${qs}`);
  if (!ok || json.error) {
    const msg = json.error || ('API error ' + status);
    throw Object.assign(new Error(msg), { status, serverError: json.error });
  }
  return json;
}

/** POST a JSON body (text/plain to skip CORS preflight). Retries only idempotent actions;
 *  mutations (image analysis, saves) are sent once with no timeout. */
async function laneApiPost(scriptUrl, body) {
  const idempotent = !!LANE_IDEMPOTENT_POST[body.action];
  const retries = idempotent ? 3 : 0;
  const { ok, status, json } = await laneFetchJSON(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }, { retries, timeoutMs: idempotent ? 20000 : 0 });
  if (!ok) throw Object.assign(new Error('HTTP ' + status), { status });
  if (json.error) {
    const e = json.error;
    const code = json.status || (e.includes('expired') || e.includes('sign-in') ? 401 : e.includes('not approved') ? 403 : 500);
    throw Object.assign(new Error(e), { status: code });
  }
  return json;
}
