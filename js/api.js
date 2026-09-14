/* ── Resilient Apps Script client — shared by index / upload / admin ──
 *
 * Google Apps Script web apps intermittently stall for 10–40s and then answer
 * with an HTML "Sorry, unable to open the file at this time" page (HTTP 404)
 * instead of running the script. It is transient — the same request usually
 * succeeds a second later — so every read (and every idempotent POST) is
 * retried with backoff, and a non-JSON body is treated as a transient failure
 * rather than a real error.
 */

// POST actions that are safe to replay if Google dropped the first attempt,
// with how long to wait per attempt. Anything not listed (upload_image,
// add_user, …) is sent exactly once with no timeout.
// save_session is replayable because each session carries a clientId the
// backend dedupes on — a retry after a dropped response can't double-save.
var LANE_POST_POLICY = {
  get_roster:         { retries: 3, timeoutMs: 20000 },
  whoami:             { retries: 3, timeoutMs: 20000 },
  admin_verify:       { retries: 3, timeoutMs: 20000 },
  login:              { retries: 3, timeoutMs: 20000 },
  list_users:         { retries: 3, timeoutMs: 20000 },
  export_all:         { retries: 3, timeoutMs: 20000 },
  list_leagues_admin: { retries: 3, timeoutMs: 20000 },
  save_session:       { retries: 3, timeoutMs: 45000 },
};

/* ── Long-lived login ───────────────────────────────────────────────
 * Google ID tokens die after an hour. After a Google sign-in the page calls
 * `login` and the backend hands back a session token good for ~90 days; that
 * is what gets stored and sent from then on. Shared by upload + admin.
 */
var LANE_SESSION_KEY = 'ar_session';

function laneSessionLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(LANE_SESSION_KEY) || 'null');
    if (!s || !s.token || !s.user || !(s.expiresAt > Date.now())) return null;
    return s;
  } catch (_) { return null; }
}
function laneSessionSave(token, expiresAt, user) {
  try { localStorage.setItem(LANE_SESSION_KEY, JSON.stringify({ token, expiresAt, user })); } catch (_) {}
}
function laneSessionClear() {
  try {
    localStorage.removeItem(LANE_SESSION_KEY);
    localStorage.removeItem('ar_token'); // pre-session builds stored the raw ID token here
    localStorage.removeItem('ar_user');
  } catch (_) {}
}
/** True for auth failures that mean "sign in again"; false for transient/server trouble. */
function laneIsAuthError(e) { return e && (e.status === 401 || e.status === 403); }

function laneUUID() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

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

/** POST a JSON body (text/plain to skip CORS preflight). Retries per LANE_POST_POLICY;
 *  unlisted mutations (image analysis, user edits) are sent once with no timeout. */
async function laneApiPost(scriptUrl, body) {
  const policy = LANE_POST_POLICY[body.action] || { retries: 0, timeoutMs: 0 };
  const { ok, status, json } = await laneFetchJSON(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  }, policy);
  if (!ok) throw Object.assign(new Error('HTTP ' + status), { status });
  if (json.error) {
    const e = json.error;
    const code = json.status || (e.includes('expired') || e.includes('sign-in') ? 401 : e.includes('not approved') ? 403 : 500);
    throw Object.assign(new Error(e), { status: code });
  }
  return json;
}
