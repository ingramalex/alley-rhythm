'use strict';

/**
 * Tests for the season archive in apps-script/Code.gs.
 *
 * startNewSeason() empties the live Sessions and Games tabs, so unlike the
 * other GAS tests this one runs the REAL source (sliced out of Code.gs)
 * against an in-memory fake spreadsheet rather than a re-declared copy.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const src   = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8');
const start = src.indexOf("const SEASONS_SHEET = 'Seasons';");
const end   = src.indexOf('function exportAllData(ss) {');
if (start < 0 || end < 0) throw new Error('Could not locate the SEASONS block in Code.gs');
const seasonSrc = src.slice(start, end);

/* ── Fake spreadsheet ───────────────────────────────────────────── */
class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map(r => r.slice()); this.failCopy = false; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(c => c !== '' && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getDataRange() { return { getValues: () => this.rows.slice(0, this.getLastRow()).map(r => r.slice()) }; }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    return {
      getValues: () => sheet.rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
      clearContent: () => {
        for (let r = row - 1; r < row - 1 + numRows; r++) {
          for (let c = col - 1; c < col - 1 + numCols; c++) if (sheet.rows[r]) sheet.rows[r][c] = '';
        }
      },
    };
  }
  appendRow(r) { this.rows.length = this.getLastRow(); this.rows.push(r.slice()); }
  setFrozenRows() {}
  setName(n) { this.name = n; return this; }
  copyTo(ss) {
    // failCopy simulates a truncated copy so the verification step can be exercised
    const copy = new FakeSheet('Copy of ' + this.name, this.failCopy ? this.rows.slice(0, 2) : this.rows);
    ss.sheets.push(copy);
    return copy;
  }
}
class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n, []); this.sheets.push(s); return s; }
}

function makeSS() {
  return new FakeSpreadsheet([
    new FakeSheet('Sessions', [
      ['SessionID', 'Date', 'WeekKey'],
      ['S1', '05/04/2026', 'w1'],
      ['S2', '10/12/2026', 'w2'],
    ]),
    new FakeSheet('Games', [
      ['GameKey', 'BowlerName', 'Date', 'Game1'],
      ['alex|05/04/2026',  'Alex',  '05/04/2026', 200],
      ['wayne|05/04/2026', 'Wayne', '05/04/2026', 190],
      ['alex|10/12/2026',  'Alex',  '10/12/2026', 210],
    ]),
    new FakeSheet('Roster',  [['RawName', 'MappedName'], ['ALEX', 'Alex']]),
    new FakeSheet('Bowlers', [['BowlerID', 'FullName'], ['B0001', 'Alex']]),
    new FakeSheet('Users',   [['Email', 'Role'], ['a@example.com', 'admin']]),
  ]);
}

function load() {
  const locks = { acquired: 0, released: 0 };
  const sandbox = {
    CONFIG: { SHEETS: { SESSIONS: 'Sessions', GAMES: 'Games', ROSTER: 'Roster', BOWLERS: 'Bowlers', USERS: 'Users' } },
    LockService: { getScriptLock: () => ({ waitLock: () => { locks.acquired++; }, releaseLock: () => { locks.released++; } }) },
    SpreadsheetApp: { flush: () => {} },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    Utilities: {
      formatDate: d => String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear(),
    },
  };
  vm.runInNewContext(seasonSrc + '\n;this.api = { startNewSeason, listArchivedSeasons, seasonIdFrom };', sandbox);
  return { ...sandbox.api, locks };
}

const user = { email: 'admin@example.com' };
const dataRows = sh => sh.getDataRange().getValues().slice(1);

/* ── Tests ──────────────────────────────────────────────────────── */
describe('seasonIdFrom', () => {
  const { seasonIdFrom } = load();
  test.each([
    ['2026', '2026'],
    ['  Spring 2026! ', 'Spring-2026'],
    ['a/b\\c', 'a-b-c'],
    ['', ''],
    [null, ''],
    ['---', ''],
  ])('%p -> %p', (raw, id) => expect(seasonIdFrom(raw)).toBe(id));
});

describe('startNewSeason', () => {
  test('copies Sessions and Games to archive tabs, then empties the live tabs', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    const before = { sessions: dataRows(ss.getSheetByName('Sessions')), games: dataRows(ss.getSheetByName('Games')) };

    const r = startNewSeason(ss, '2026', '2026 Season', user);

    expect(r).toMatchObject({ success: true, seasonId: '2026', sessions: 2, gameRows: 3,
                              archivedTabs: ['Sessions_2026', 'Games_2026'] });
    // Archive holds exactly what was live
    expect(dataRows(ss.getSheetByName('Sessions_2026'))).toEqual(before.sessions);
    expect(dataRows(ss.getSheetByName('Games_2026'))).toEqual(before.games);
    // Live tabs: header kept, data gone
    expect(ss.getSheetByName('Sessions').getLastRow()).toBe(1);
    expect(ss.getSheetByName('Games').getLastRow()).toBe(1);
    expect(ss.getSheetByName('Games').rows[0]).toEqual(['GameKey', 'BowlerName', 'Date', 'Game1']);
  });

  test('leaves Roster, Bowlers and Users untouched', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    const snap = n => JSON.stringify(ss.getSheetByName(n).rows);
    const before = ['Roster', 'Bowlers', 'Users'].map(snap);
    startNewSeason(ss, '2026', '2026 Season', user);
    expect(['Roster', 'Bowlers', 'Users'].map(snap)).toEqual(before);
  });

  test('logs the season with counts, date range and who ran it', () => {
    const { startNewSeason, listArchivedSeasons } = load();
    const ss = makeSS();
    startNewSeason(ss, '2026', '2026 Season', user);
    const { seasons } = listArchivedSeasons(ss);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({ SeasonID: '2026', Label: '2026 Season', ArchivedBy: 'admin@example.com',
                                       Sessions: 2, GameRows: 3, FirstDate: '05/04/2026', LastDate: '10/12/2026' });
  });

  test('refuses a season name that is already archived, and changes nothing', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    ss.sheets.push(new FakeSheet('Games_2026', [['GameKey']]));
    expect(() => startNewSeason(ss, '2026', '', user)).toThrow(/already archived/);
    expect(ss.getSheetByName('Games').getLastRow()).toBe(4);
    expect(ss.getSheetByName('Sessions').getLastRow()).toBe(3);
    expect(ss.getSheetByName('Sessions_2026')).toBeNull();
  });

  test('refuses an empty name', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    expect(() => startNewSeason(ss, '  ', '', user)).toThrow(/season name is required/);
    expect(ss.getSheetByName('Games').getLastRow()).toBe(4);
  });

  test('refuses when there is nothing to archive', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    startNewSeason(ss, '2026', '', user);
    expect(() => startNewSeason(ss, '2027', '', user)).toThrow(/no scores to archive/);
    expect(ss.getSheetByName('Games_2027')).toBeNull();
  });

  test('does NOT clear the live tabs if a copy comes back short', () => {
    const { startNewSeason } = load();
    const ss = makeSS();
    ss.getSheetByName('Games').failCopy = true;
    expect(() => startNewSeason(ss, '2026', '', user)).toThrow(/Archive check failed for Games/);
    expect(ss.getSheetByName('Games').getLastRow()).toBe(4);
    expect(ss.getSheetByName('Sessions').getLastRow()).toBe(3);
  });

  test('always releases the lock, including on failure', () => {
    const ok = load();
    ok.startNewSeason(makeSS(), '2026', '', user);
    expect(ok.locks).toEqual({ acquired: 1, released: 1 });

    const bad = load();
    expect(() => bad.startNewSeason(makeSS(), '', '', user)).toThrow();
    expect(bad.locks.acquired).toBe(bad.locks.released);
  });
});

describe('listArchivedSeasons', () => {
  test('returns an empty list when no season has been archived', () => {
    const { listArchivedSeasons } = load();
    expect(listArchivedSeasons(makeSS())).toEqual({ seasons: [] });
  });
});
