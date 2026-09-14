#!/usr/bin/env node
/* ── Static data snapshot ───────────────────────────────────────────
 *
 * Fetches ?action=all for every active league from the Apps Script backend
 * and writes data/<leagueId>.json. GitHub Pages then serves those files from
 * its CDN, so the site can render real stats in ~100ms instead of waiting
 * 2-10s for an Apps Script round-trip. The page still refreshes from Apps
 * Script in the background, so the snapshot only ever needs to be "recent".
 *
 * Run by .github/workflows/snapshot.yml (on upload via repository_dispatch,
 * on a schedule, or manually). Usage: node scripts/snapshot.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT    = path.join(__dirname, '..');
const DATA    = path.join(ROOT, 'data');
const RETRIES = 4;

// Read SCRIPT_URL / LEAGUES from config.js the same way the browser does.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8') + ';window.LANE_CONFIG = LANE_CONFIG;', sandbox);
const CONFIG = sandbox.window.LANE_CONFIG;

async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (_) {}
      if (j && !j.error) return j;
      // Google's transient HTML 404 page, or a backend error — retry.
      lastErr = new Error(j ? j.error : `non-JSON response (HTTP ${r.status})`);
    } catch (e) { lastErr = e; }
    const delay = 3000 * Math.pow(2, attempt);
    console.log(`  retry ${attempt + 1}/${RETRIES - 1} in ${delay / 1000}s — ${lastErr.message}`);
    await new Promise(res => setTimeout(res, delay));
  }
  throw lastErr;
}

// JSON with volatile timestamp fields removed, for change detection.
function stable(obj) {
  return JSON.stringify(obj, (k, v) => (k === 'snapshotAt' || k === 'updatedAt') ? undefined : v);
}

(async () => {
  const base = CONFIG.SCRIPT_URL;
  let leagues;
  try {
    leagues = (await fetchJSON(`${base}?action=list_leagues`)).leagues || [];
  } catch (e) {
    console.log(`list_leagues failed (${e.message}); falling back to config.js LEAGUES`);
    leagues = CONFIG.LEAGUES || [];
  }
  if (!leagues.length) { console.error('No leagues found'); process.exit(1); }

  fs.mkdirSync(DATA, { recursive: true });
  let failures = 0;
  for (const { leagueId, name } of leagues) {
    process.stdout.write(`${name} (${leagueId}) … `);
    try {
      const all = await fetchJSON(`${base}?action=all&leagueId=${encodeURIComponent(leagueId)}`);
      if (!all.stats || !Array.isArray(all.stats.bowlers)) throw new Error('payload missing stats.bowlers');
      const file = path.join(DATA, `${leagueId}.json`);
      const out  = { snapshotAt: new Date().toISOString(), leagueId, ...all };
      // Only rewrite when real data changed — every response carries fresh
      // updatedAt stamps, and rewriting for those alone would churn the repo
      // (and trigger a Pages deploy) every 30 minutes.
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
      if (prev && stable(prev) === stable(out)) { console.log('unchanged'); continue; }
      fs.writeFileSync(file, JSON.stringify(out));
      console.log(`ok — ${all.stats.bowlers.length} bowlers`);
    } catch (e) {
      // Keep whatever snapshot already exists rather than publishing nothing.
      failures++;
      console.log(`FAILED — ${e.message} (keeping previous snapshot)`);
    }
  }
  process.exit(failures === leagues.length ? 1 : 0);
})();
