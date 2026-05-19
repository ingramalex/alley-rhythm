'use strict';

/**
 * Tests for pure logic extracted from apps-script/Code.gs.
 * Google Apps Script globals (Utilities, Session, SpreadsheetApp, etc.)
 * are either mocked here or the functions are re-declared without their
 * GAS dependencies so they can run in Node.
 */

/* ── safeParseJSON (copied verbatim — pure, no GAS deps) ────────── */
function safeParseJSON(str, def) {
  try { return str ? JSON.parse(str) : def; } catch(e) { return def; }
}

describe('safeParseJSON', () => {
  test('parses valid JSON', () => {
    expect(safeParseJSON('{"a":1}', {})).toEqual({ a: 1 });
  });
  test('returns default for invalid JSON', () => {
    expect(safeParseJSON('not-json', {})).toEqual({});
  });
  test('returns default for empty string', () => {
    expect(safeParseJSON('', { fallback: true })).toEqual({ fallback: true });
  });
  test('returns default for null', () => {
    expect(safeParseJSON(null, [])).toEqual([]);
  });
  test('parses arrays', () => {
    expect(safeParseJSON('[1,2,3]', [])).toEqual([1, 2, 3]);
  });
  test('parses nested objects', () => {
    const input = '{"theme":{"primary":"#39ff14"}}';
    expect(safeParseJSON(input, {}).theme.primary).toBe('#39ff14');
  });
});

/* ── lev — Levenshtein distance (copied verbatim — pure) ────────── */
function lev(a, b) {
  const m = a.length, n = b.length,
    dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i ? j ? 0 : i : j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

describe('lev (Levenshtein distance)', () => {
  test('identical strings = 0', () => {
    expect(lev('REECE', 'REECE')).toBe(0);
  });
  test('one insertion', () => {
    expect(lev('RECE', 'REECE')).toBe(1);
  });
  test('one substitution', () => {
    expect(lev('REECE', 'REICE')).toBe(1);
  });
  test('one deletion', () => {
    expect(lev('REECES', 'REECE')).toBe(1);
  });
  test('completely different strings', () => {
    expect(lev('ABC', 'XYZ')).toBe(3);
  });
  test('empty string to non-empty', () => {
    expect(lev('', 'ALEX')).toBe(4);
  });
  test('both empty', () => {
    expect(lev('', '')).toBe(0);
  });
});

/* ── matchName (copied verbatim — pure once lev is in scope) ────── */
function matchName(rawName, rosterMap, fullRoster) {
  if (!rawName) return rawName;
  const up = rawName.toUpperCase().trim();
  if (rosterMap[up]) return rosterMap[up];
  const full = fullRoster || Object.values(rosterMap);
  const pref = full.find(n => n.toUpperCase().startsWith(up) || up.startsWith(n.toUpperCase().substring(0,4)));
  if (pref) return pref;
  let best = null, bestD = Infinity;
  for (const n of full) {
    const d = lev(up, n.toUpperCase().substring(0, up.length + 2));
    if (d < bestD) { bestD = d; best = n; }
  }
  if (bestD <= 2 && best) return best;
  return rawName;
}

const ROSTER_MAP = {
  'REECE': 'Reece',
  'ALEX':  'Alex',
  'JESS':  'Jess',
  'MARK':  'Mark',
  'STEVE': 'Steve',
  'WAYNE': 'Wayne',
};
const FULL_ROSTER = Object.values(ROSTER_MAP);

describe('matchName', () => {
  test('exact match (uppercase key) returns mapped name', () => {
    expect(matchName('REECE', ROSTER_MAP, FULL_ROSTER)).toBe('Reece');
  });
  test('case-insensitive via toUpperCase normalisation', () => {
    expect(matchName('reece', ROSTER_MAP, FULL_ROSTER)).toBe('Reece');
  });
  test('prefix match — short first name', () => {
    expect(matchName('WA', ROSTER_MAP, FULL_ROSTER)).toBe('Wayne');
  });
  test('fuzzy match within edit distance 2', () => {
    // "RECCE" is 1 edit away from "REECE"
    expect(matchName('RECCE', ROSTER_MAP, FULL_ROSTER)).toBe('Reece');
  });
  test('returns rawName unchanged when no match found', () => {
    expect(matchName('ZZZZZ', ROSTER_MAP, FULL_ROSTER)).toBe('ZZZZZ');
  });
  test('returns rawName for null/empty input', () => {
    expect(matchName(null, ROSTER_MAP, FULL_ROSTER)).toBeNull();
    expect(matchName('', ROSTER_MAP, FULL_ROSTER)).toBe('');
  });
});

/* ── getWeekKey logic (mocking GAS globals) ─────────────────────── */
// Re-implement without Utilities.formatDate / Session deps
function getWeekKeyJS(date) {
  const d = new Date(date);
  const day = d.getDay();
  const daysToMonday = (day === 0) ? 6 : day - 1;
  d.setDate(d.getDate() - daysToMonday);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

// Use T12:00:00 to avoid UTC-midnight shifting the date to the previous day
// in timezones behind UTC (e.g. US/Central).
const d = iso => new Date(`${iso}T12:00:00`);

describe('getWeekKey (JS re-implementation)', () => {
  test('Sunday maps back to the previous Monday', () => {
    // 2025-05-18 is a Sunday → week key should be Mon 2025-05-12
    expect(getWeekKeyJS(d('2025-05-18'))).toBe('05/12/2025');
  });
  test('Monday stays on itself', () => {
    // 2025-05-19 is a Monday
    expect(getWeekKeyJS(d('2025-05-19'))).toBe('05/19/2025');
  });
  test('Saturday maps back to Monday', () => {
    // 2025-05-17 is a Saturday → Mon 2025-05-12
    expect(getWeekKeyJS(d('2025-05-17'))).toBe('05/12/2025');
  });
  test('Wednesday maps back to Monday', () => {
    // 2025-05-21 is a Wednesday → Mon 2025-05-19
    expect(getWeekKeyJS(d('2025-05-21'))).toBe('05/19/2025');
  });
  test('all days in the same Mon-Sun week return the same key', () => {
    // Week of 2025-05-19 (Mon) through 2025-05-25 (Sun)
    const keys = ['2025-05-19','2025-05-20','2025-05-21','2025-05-22','2025-05-23','2025-05-24','2025-05-25']
      .map(iso => getWeekKeyJS(d(iso)));
    expect(new Set(keys).size).toBe(1);
  });
});

/* ── buildNewGameRow logic ──────────────────────────────────────── */
// Pure subset: series calculation and blind-bowler zeroing
function calcSeries(games) {
  return games.reduce((a, c) => a + (Number(c) || 0), 0) || '';
}

describe('calcSeries', () => {
  test('sums three games', () => {
    expect(calcSeries([180, 200, 165])).toBe(545);
  });
  test('handles empty array', () => {
    expect(calcSeries([])).toBe('');
  });
  test('ignores non-numeric entries', () => {
    expect(calcSeries([180, '', 165])).toBe(345);
  });
  test('handles a single game', () => {
    expect(calcSeries([220])).toBe(220);
  });
});

/* ── leagueId slug generation (from createNewLeague) ────────────── */
function generateLeagueId(leagueName) {
  return leagueName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Note: real fn appends Date.now().toString(36) — omitted here for determinism
}

describe('generateLeagueId', () => {
  test('lowercases and hyphenates spaces', () => {
    expect(generateLeagueId('Blame It On The Lane')).toBe('blame-it-on-the-lane');
  });
  test('strips leading and trailing hyphens', () => {
    expect(generateLeagueId('  Youth League  ')).toBe('youth-league');
  });
  test('removes special characters', () => {
    expect(generateLeagueId('Friday Night Crew!')).toBe('friday-night-crew');
  });
  test('collapses multiple spaces/punctuation into one hyphen', () => {
    expect(generateLeagueId('Bowl -- O -- Rama')).toBe('bowl-o-rama');
  });
  test('preserves numbers', () => {
    expect(generateLeagueId('League 2025')).toBe('league-2025');
  });
});
