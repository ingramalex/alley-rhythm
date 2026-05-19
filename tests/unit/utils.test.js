'use strict';

const {
  COLORS,
  MILESTONES,
  CACHE_KEY_PREFIX,
  CACHE_TTL_MS,
  pColor,
  ini2,
  buildMarquee,
  emptyState,
  loadingState,
  getCached,
  setCache,
  getMilestoneForScore,
  computeFilteredBowlers,
} = require('../../js/utils');

/* ── pColor ─────────────────────────────────────────────────────── */
describe('pColor', () => {
  test('returns a hex color string', () => {
    expect(pColor('Alex')).toMatch(/^#[0-9a-f]{6}$/i);
  });
  test('returns the neon-green default for falsy input', () => {
    expect(pColor('')).toBe('#39ff14');
    expect(pColor(null)).toBe('#39ff14');
    expect(pColor(undefined)).toBe('#39ff14');
  });
  test('is deterministic — same name always returns same color', () => {
    expect(pColor('Reece')).toBe(pColor('Reece'));
    expect(pColor('Wayne')).toBe(pColor('Wayne'));
  });
  test('returns different colors for different names (most of the time)', () => {
    const colors = ['Alex','Reece','Jess','Mark','Steve','Darnell','Nikki','Wayne'].map(pColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
  test('returned color is always one of the COLORS palette', () => {
    ['Alex','Reece','Jess','Mark','Steve','Darnell','Nikki','Wayne'].forEach(name => {
      expect(COLORS).toContain(pColor(name));
    });
  });
});

/* ── ini2 ───────────────────────────────────────────────────────── */
describe('ini2', () => {
  test('returns first two chars uppercased', () => {
    expect(ini2('alex')).toBe('AL');
    expect(ini2('Reece')).toBe('RE');
  });
  test('handles single-char name', () => {
    expect(ini2('X')).toBe('X');
  });
  test('falls back to ?? for falsy input', () => {
    expect(ini2(null)).toBe('??');
    expect(ini2('')).toBe('??');
    expect(ini2(undefined)).toBe('??');
  });
  test('handles exactly two chars', () => {
    expect(ini2('JD')).toBe('JD');
  });
});

/* ── buildMarquee ───────────────────────────────────────────────── */
describe('buildMarquee', () => {
  test('doubles the items', () => {
    const html = buildMarquee(['A', 'B', 'C']);
    const matches = html.match(/marquee-item/g);
    expect(matches).toHaveLength(6);
  });
  test('wraps each item in a span.marquee-item', () => {
    const html = buildMarquee(['HELLO']);
    expect(html).toContain('<span class="marquee-item">HELLO</span>');
  });
  test('handles empty array', () => {
    expect(buildMarquee([])).toBe('');
  });
  test('preserves item content exactly', () => {
    const html = buildMarquee(['REECE LEADS · 185 AVG']);
    expect(html).toContain('REECE LEADS · 185 AVG');
  });
});

/* ── emptyState ─────────────────────────────────────────────────── */
describe('emptyState', () => {
  test('returns a non-empty HTML string', () => {
    expect(emptyState('NO DATA').length).toBeGreaterThan(0);
  });
  test('includes the message', () => {
    expect(emptyState('NO GAMES YET')).toContain('NO GAMES YET');
  });
  test('includes the bowling ball emoji', () => {
    expect(emptyState('test')).toContain('🎳');
  });
  test('includes upload button', () => {
    expect(emptyState('test')).toContain('upload.html');
  });
});

/* ── loadingState ───────────────────────────────────────────────── */
describe('loadingState', () => {
  test('returns a non-empty HTML string', () => {
    expect(loadingState().length).toBeGreaterThan(0);
  });
  test('contains LOADING text', () => {
    expect(loadingState()).toContain('LOADING');
  });
  test('contains a spinner element', () => {
    expect(loadingState()).toContain('animation:spin');
  });
});

/* ── getCached / setCache ───────────────────────────────────────── */
describe('cache helpers', () => {
  beforeEach(() => localStorage.clear());

  test('getCached returns null when nothing stored', () => {
    expect(getCached('TestLeague')).toBeNull();
  });

  test('setCache then getCached round-trips data', () => {
    const data = { bowlers: [{ name: 'Reece', avg: 180 }] };
    setCache('TestLeague', data);
    expect(getCached('TestLeague')).toEqual(data);
  });

  test('getCached returns null after TTL expires', () => {
    const data = { bowlers: [] };
    const stale = JSON.stringify({ ts: Date.now() - CACHE_TTL_MS - 1000, data });
    localStorage.setItem(CACHE_KEY_PREFIX + 'TestLeague', stale);
    expect(getCached('TestLeague')).toBeNull();
  });

  test('different leagueIds are stored independently', () => {
    setCache('LeagueA', { x: 1 });
    setCache('LeagueB', { x: 2 });
    expect(getCached('LeagueA')).toEqual({ x: 1 });
    expect(getCached('LeagueB')).toEqual({ x: 2 });
  });

  test('getCached returns null for corrupted cache entry', () => {
    localStorage.setItem(CACHE_KEY_PREFIX + 'Bad', 'not-json{{{');
    expect(getCached('Bad')).toBeNull();
  });
});

/* ── MILESTONES ─────────────────────────────────────────────────── */
describe('MILESTONES', () => {
  test('has 7 milestone tiers', () => {
    expect(MILESTONES).toHaveLength(7);
  });
  test('300 milestone is legendary', () => {
    const m = MILESTONES.find(m => m.key === '300');
    expect(m.rarity).toBe('legendary');
    expect(m.emoji).toBe('🏆');
  });
  test('all milestones have required fields', () => {
    MILESTONES.forEach(m => {
      expect(m).toHaveProperty('min');
      expect(m).toHaveProperty('max');
      expect(m).toHaveProperty('key');
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('emoji');
      expect(m).toHaveProperty('rarity');
    });
  });
  test('milestone ranges are ordered highest first', () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].min).toBeLessThan(MILESTONES[i - 1].min);
    }
  });
  test('milestone ranges do not overlap', () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].max).toBeLessThan(MILESTONES[i - 1].min);
    }
  });
});

/* ── getMilestoneForScore ───────────────────────────────────────── */
describe('getMilestoneForScore', () => {
  test('returns 300 milestone for a perfect game', () => {
    expect(getMilestoneForScore(300).key).toBe('300');
  });
  test('returns correct tier for 250', () => {
    expect(getMilestoneForScore(250).key).toBe('250');
  });
  test('returns correct tier for 200', () => {
    expect(getMilestoneForScore(200).key).toBe('200');
  });
  test('returns null for score below lowest milestone', () => {
    expect(getMilestoneForScore(174)).toBeNull();
    expect(getMilestoneForScore(0)).toBeNull();
  });
  test('returns correct tier boundary — 175', () => {
    expect(getMilestoneForScore(175).key).toBe('175');
  });
  test('returns correct tier boundary — 199', () => {
    expect(getMilestoneForScore(199).key).toBe('175');
  });
});

/* ── computeFilteredBowlers ─────────────────────────────────────── */
describe('computeFilteredBowlers', () => {
  const weeks = [
    { bowlers: [{ name: 'Reece', games: [180, 200, 165] }, { name: 'Alex', games: [150, 160] }] },
    { bowlers: [{ name: 'Reece', games: [190, 175] }] },
    { bowlers: [{ name: 'Alex', games: [170, 180] }] },
  ];
  const allBowlers = [
    { name: 'Reece', avg: 185, highGame: 210, highSeries: 550, gamesCount: 10 },
    { name: 'Alex',  avg: 160, highGame: 190, highSeries: 490, gamesCount: 8  },
  ];

  test('returns allBowlers when numWeeks is 0', () => {
    expect(computeFilteredBowlers(weeks, 0, allBowlers)).toBe(allBowlers);
  });

  test('uses only the first N weeks', () => {
    const result = computeFilteredBowlers(weeks, 1, allBowlers);
    // Only week 0: Reece has 3 games, Alex has 2
    const reece = result.find(b => b.name === 'Reece');
    expect(reece.gamesCount).toBe(3);
  });

  test('calculates average correctly', () => {
    const result = computeFilteredBowlers(weeks, 1, allBowlers);
    const reece = result.find(b => b.name === 'Reece');
    expect(reece.avg).toBe(Math.round((180 + 200 + 165) / 3));
  });

  test('calculates highGame correctly', () => {
    const result = computeFilteredBowlers(weeks, 1, allBowlers);
    const reece = result.find(b => b.name === 'Reece');
    expect(reece.highGame).toBe(200);
  });

  test('merges original bowler properties', () => {
    const result = computeFilteredBowlers(weeks, 1, allBowlers);
    const reece = result.find(b => b.name === 'Reece');
    // highGame from original should be overwritten; highSeries from orig still present via spread
    expect(reece).toHaveProperty('highSeries');
  });

  test('excludes bowlers with no games in the slice', () => {
    const limitedWeeks = [{ bowlers: [{ name: 'Reece', games: [180] }] }];
    const result = computeFilteredBowlers(limitedWeeks, 1, allBowlers);
    expect(result.find(b => b.name === 'Alex')).toBeUndefined();
  });

  test('returns allBowlers when weeks slice is empty', () => {
    expect(computeFilteredBowlers([], 5, allBowlers)).toBe(allBowlers);
  });
});
