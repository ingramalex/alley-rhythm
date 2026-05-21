'use strict';

/**
 * Regression tests for configuration correctness.
 *
 * Bug history this suite guards against:
 *
 *  1. config.js used `const LANE_CONFIG` — `const` at top-level does NOT
 *     create a window property, so window.LANE_CONFIG was always undefined
 *     in HTML files, silently falling back to hardcoded (possibly wrong)
 *     client IDs.  Fix: use `var`.
 *
 *  2. admin.html and upload.html had different/typo'd Google OAuth client
 *     IDs in their fallbacks, causing "invalid_client" errors when the
 *     sign-in button was actually clicked (e.g. after token expiry).
 *
 *  3. admin.html referenced `_cfg` (an index.html-only alias) inside
 *     showAdmin(), causing a ReferenceError that left auth stuck forever.
 *
 *  4. `auto_select: true` in initGSI() caused GSI to double-fire alongside
 *     tryRestoreSession(), producing "initialize() called multiple times"
 *     and a destroyed sign-in button.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT      = path.join(__dirname, '..', '..');
const configSrc = fs.readFileSync(path.join(ROOT, 'config.js'),    'utf8');
const adminSrc  = fs.readFileSync(path.join(ROOT, 'admin.html'),   'utf8');
const uploadSrc = fs.readFileSync(path.join(ROOT, 'upload.html'),  'utf8');

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

/** Pull the first Google OAuth client ID (xxx.apps.googleusercontent.com) from a string. */
function extractClientId(src) {
  const m = src.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
  return m ? m[1] : null;
}

/** Return only the content inside <script>…</script> blocks (strips HTML comments first). */
function inlineJs(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  return (noComments.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi) || [])
    .map(s => s.replace(/<\/?script[^>]*>/gi, ''))
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────
//  1. config.js — var vs const
// ─────────────────────────────────────────────────────────────────
describe('config.js — window property accessibility', () => {
  test('LANE_CONFIG is declared with var (not const or let)', () => {
    // const/let at top-level do NOT create window properties.
    // var is required so window.LANE_CONFIG is reachable from inline scripts.
    expect(configSrc).toMatch(/^\s*var\s+LANE_CONFIG\s*=/m);
    expect(configSrc).not.toMatch(/^\s*const\s+LANE_CONFIG\s*=/m);
    expect(configSrc).not.toMatch(/^\s*let\s+LANE_CONFIG\s*=/m);
  });

  test('evaluating config.js sets a global LANE_CONFIG variable', () => {
    // vm.runInThisContext simulates a top-level <script> evaluation.
    // `var` in that context creates a property on the global (≈ window).
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(configSrc, ctx);
    expect(ctx.LANE_CONFIG).toBeDefined();
    expect(typeof ctx.LANE_CONFIG).toBe('object');
  });

  test('LANE_CONFIG has all required keys', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(configSrc, ctx);
    const cfg = ctx.LANE_CONFIG;
    expect(cfg).toHaveProperty('SCRIPT_URL');
    expect(cfg).toHaveProperty('GOOGLE_CLIENT_ID');
    expect(cfg).toHaveProperty('LEAGUES');
    expect(Array.isArray(cfg.LEAGUES)).toBe(true);
    expect(cfg.LEAGUES.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
//  2. config.js — field format validation
// ─────────────────────────────────────────────────────────────────
describe('config.js — required field formats', () => {
  const ctx = {};
  beforeAll(() => { vm.createContext(ctx); vm.runInContext(configSrc, ctx); });

  test('GOOGLE_CLIENT_ID matches Google OAuth format', () => {
    // Expected: <project-number>-<alphanumeric>.apps.googleusercontent.com
    expect(ctx.LANE_CONFIG.GOOGLE_CLIENT_ID)
      .toMatch(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  });

  test('SCRIPT_URL points to a Google Apps Script exec endpoint', () => {
    expect(ctx.LANE_CONFIG.SCRIPT_URL).toContain('script.google.com/macros/s/');
    expect(ctx.LANE_CONFIG.SCRIPT_URL).toContain('/exec');
  });

  test('every league entry has leagueId, name, and day', () => {
    ctx.LANE_CONFIG.LEAGUES.forEach(l => {
      expect(l).toHaveProperty('leagueId');
      expect(l).toHaveProperty('name');
      expect(l).toHaveProperty('day');
    });
  });

  test('leagueId values are non-empty strings without spaces', () => {
    ctx.LANE_CONFIG.LEAGUES.forEach(l => {
      expect(typeof l.leagueId).toBe('string');
      expect(l.leagueId.trim().length).toBeGreaterThan(0);
      expect(l.leagueId).not.toContain(' ');
    });
  });
});

// ─────────────────────────────────────────────────────────────────
//  3. Client ID consistency across all three files
// ─────────────────────────────────────────────────────────────────
describe('Google OAuth client ID — consistency', () => {
  const ctx = {};
  beforeAll(() => { vm.createContext(ctx); vm.runInContext(configSrc, ctx); });

  const configId  = () => ctx.LANE_CONFIG.GOOGLE_CLIENT_ID;
  const adminId   = extractClientId(adminSrc);
  const uploadId  = extractClientId(uploadSrc);

  test('admin.html fallback client ID matches config.js', () => {
    expect(adminId).toBe(configId());
  });

  test('upload.html fallback client ID matches config.js', () => {
    expect(uploadId).toBe(configId());
  });

  test('all three sources reference the same client ID', () => {
    const ids = new Set([configId(), adminId, uploadId]);
    expect(ids.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
//  4. Auth safety flags in HTML files
// ─────────────────────────────────────────────────────────────────
describe('admin.html — auth safety', () => {
  const js = inlineJs(adminSrc);

  test('uses auto_select: false (not true) to prevent double GSI callback', () => {
    expect(js).toContain('auto_select:false');
    expect(js).not.toMatch(/auto_select\s*:\s*true/);
  });

  test('_gsiInitialized guard is present to prevent multiple initialize() calls', () => {
    expect(js).toContain('_gsiInitialized');
  });

  test('does not reference _cfg (index.html-only alias)', () => {
    // _cfg is defined only in index.html via `const _cfg = window.LANE_CONFIG || {}`.
    // Using it in admin.html causes a ReferenceError that permanently breaks auth.
    expect(js).not.toMatch(/\b_cfg\b/);
  });

  test('uses window.LANE_CONFIG (not _cfg) for league config lookup', () => {
    expect(js).toMatch(/window\.LANE_CONFIG/);
  });
});

describe('upload.html — auth safety', () => {
  const js = inlineJs(uploadSrc);

  test('uses auto_select: false (not true) to prevent double GSI callback', () => {
    expect(js).toContain('auto_select:false');
    expect(js).not.toMatch(/auto_select\s*:\s*true/);
  });

  test('_gsiInitialized guard is present to prevent multiple initialize() calls', () => {
    expect(js).toContain('_gsiInitialized');
  });

  test('does not reference _cfg', () => {
    expect(js).not.toMatch(/\b_cfg\b/);
  });
});

// ─────────────────────────────────────────────────────────────────
//  5. Session persistence — localStorage (not sessionStorage)
// ─────────────────────────────────────────────────────────────────
describe('Session persistence', () => {
  test('admin.html uses localStorage (not sessionStorage) for token', () => {
    const js = inlineJs(adminSrc);
    expect(js).toContain("localStorage.setItem('ar_token'");
    expect(js).not.toContain("sessionStorage.setItem('ar_token'");
  });

  test('upload.html uses localStorage (not sessionStorage) for token', () => {
    const js = inlineJs(uploadSrc);
    expect(js).toContain("localStorage.setItem('ar_token'");
    expect(js).not.toContain("sessionStorage.setItem('ar_token'");
  });
});
