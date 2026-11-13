#!/usr/bin/env node
/* ── Freeze a season for the website ────────────────────────────────
 *
 * Fetches the league's current stats (?action=all) from the Apps Script
 * backend and writes them as a permanent, read-only archive the site's
 * season picker can load:
 *
 *   data/season-<leagueId>-<seasonId>.json   the frozen stats
 *   data/seasons-<leagueId>.json             index of archived seasons
 *
 * Run this BEFORE pressing "Archive & start new season" in the admin
 * panel — once the live tabs are emptied there is nothing left to fetch.
 *
 * Usage: node scripts/archive-season.js <leagueId> <seasonId> ["Label"]
 *   e.g. node scripts/archive-season.js BlameItOnTheLane 2026 "2026 Season"
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const [leagueId, rawSeasonId, labelArg] = process.argv.slice(2);
const seasonId = String(rawSeasonId || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
if (!leagueId || !seasonId) {
  console.error('Usage: node scripts/archive-season.js <leagueId> <seasonId> ["Label"]');
  process.exit(1);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8') + ';window.LANE_CONFIG = LANE_CONFIG;', sandbox);
const SCRIPT_URL = sandbox.window.LANE_CONFIG.SCRIPT_URL;

async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (_) {}
      if (j && !j.error) return j;
      lastErr = new Error(j ? j.error : `non-JSON response (HTTP ${r.status})`);
    } catch (e) { lastErr = e; }
    await new Promise(res => setTimeout(res, 3000 * Math.pow(2, attempt)));
  }
  throw lastErr;
}

(async () => {
  const seasonFile = path.join(DATA, `season-${leagueId}-${seasonId}.json`);
  const indexFile  = path.join(DATA, `seasons-${leagueId}.json`);
  if (fs.existsSync(seasonFile)) {
    console.error(`${path.relative(ROOT, seasonFile)} already exists — refusing to overwrite an archive. Delete it first if you mean to redo it.`);
    process.exit(1);
  }

  const all = await fetchJSON(`${SCRIPT_URL}?action=all&leagueId=${encodeURIComponent(leagueId)}`);
  const bowlers  = (all.stats && all.stats.bowlers) || [];
  const weeks    = (all.weekly && all.weekly.weeks) || [];
  const sessions = (all.history && all.history.sessions) || [];
  if (!bowlers.length || !weeks.length) {
    console.error('The league has no scores right now — nothing to archive.');
    process.exit(1);
  }

  // The weekly view only carries recent weeks, so take the date range from every
  // bowler's full game log (MM/DD/YYYY keys) as well.
  const dates = [
    ...weeks.map(w => w.week),
    ...bowlers.flatMap(b => Object.keys(b.gamesByDate || {})),
  ].filter(d => /^\d{2}\/\d{2}\/\d{4}$/.test(d || '')).sort((a, z) => new Date(a) - new Date(z));
  const entry = {
    id: seasonId,
    label: labelArg || seasonId,
    from: dates[0],
    to: dates[dates.length - 1],
    weeks: weeks.length,
    sessions: sessions.length,
    games: bowlers.reduce((n, b) => n + (b.gamesCount || 0), 0),
    archivedAt: new Date().toISOString(),
  };

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(seasonFile, JSON.stringify({ season: entry, leagueId, ...all }));

  let index = { leagueId, seasons: [] };
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (_) {}
  index.seasons = [entry, ...(index.seasons || []).filter(s => s.id !== seasonId)];
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');

  console.log(`Archived ${entry.label}: ${entry.from} to ${entry.to}, ${entry.weeks} weeks, ${entry.sessions} sessions, ${entry.games} games, ${bowlers.length} bowlers`);
  console.log(`  ${path.relative(ROOT, seasonFile)}`);
  console.log(`  ${path.relative(ROOT, indexFile)}`);
})().catch(e => { console.error('FAILED — ' + e.message); process.exit(1); });
