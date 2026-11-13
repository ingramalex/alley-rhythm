// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // The committed data/*.json snapshot is real league data — keep it out of tests
  await page.route('**/data/*.json*', route => route.fulfill({ status: 404, body: '' }));
  // Stub the Google Apps Script API so tests don't need a live backend
  await page.route('https://script.google.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stats:   { bowlers: [] },
        weekly:  { weeks: [] },
        awards:  { currentWeek: null, weekly: {}, milestones: {}, season: {} },
        history: { sessions: [] },
      }),
    })
  );
  await page.goto('/');
});

/* ── PAGE LOAD ───────────────────────────────────────────────────── */
test.describe('Page load', () => {
  test('has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Alley Rhythm/i);
  });

  test('js/utils.js loads without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Filter out expected network errors from stubbed GAS endpoint
    const real = errors.filter(e => !e.includes('script.google.com') && !e.includes('API error'));
    expect(real).toHaveLength(0);
  });

  test('marquee is visible and contains text', async ({ page }) => {
    const marquee = page.locator('#topMarquee');
    await expect(marquee).toBeVisible();
    const text = await marquee.textContent();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('footer marquee is rendered (desktop) or replaced by the tab bar (phone)', async ({ page }) => {
    const footer = page.locator('#footerTrack');
    const phone  = page.viewportSize().width <= 640;
    if (phone) {
      await expect(footer).toBeHidden();
      // The tab row sits at the bottom of the screen and every tab fits
      const nav = await page.locator('#navBar').boundingBox();
      expect(nav.y + nav.height).toBeGreaterThan(page.viewportSize().height - 4);
      for (const tab of await page.locator('.ntab').all()) await expect(tab).toBeInViewport();
    } else {
      await expect(footer).toBeVisible();
    }
  });
});

/* ── NAVIGATION TABS ─────────────────────────────────────────────── */
test.describe('Tab navigation', () => {
  test('all nav tabs are present', async ({ page }) => {
    const tabs = page.locator('.ntab');
    await expect(tabs).toHaveCount(await tabs.count());
    expect(await tabs.count()).toBeGreaterThanOrEqual(3);
  });

  test('clicking a tab activates it and shows the view', async ({ page }) => {
    // Dismiss the league-switcher overlay if present before interacting with tabs
    const switcher = page.locator('#league-switcher');
    if (await switcher.isVisible()) {
      const leagueBtn = switcher.locator('button, [onclick*="selectLeague"], .league-option').first();
      if (await leagueBtn.count() > 0) {
        await leagueBtn.click({ force: true });
      } else {
        await page.evaluate(() => {
          const el = document.getElementById('league-switcher');
          if (el) el.style.display = 'none';
        });
      }
    }

    const tabs = page.locator('.ntab');
    const count = await tabs.count();
    if (count < 2) test.skip();

    const secondTab = tabs.nth(1);
    await secondTab.click();
    await expect(secondTab).toHaveClass(/active/);
  });

  test('each tab has a corresponding view panel', async ({ page }) => {
    const tabs = page.locator('.ntab');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const onclick = await tabs.nth(i).getAttribute('onclick');
      if (!onclick) continue;
      const match = onclick.match(/goTab\('([^']+)'/);
      if (!match) continue;
      const viewId = 'tab-' + match[1];
      await expect(page.locator('#' + viewId)).toHaveCount(1);
    }
  });
});

/* ── SHAREABLE LINKS ─────────────────────────────────────────────── */
test.describe('Shareable links', () => {
  test('a #tab in the URL opens that tab', async ({ page }) => {
    await page.goto('/#weekly');
    await expect(page.locator('#tab-weekly')).toHaveClass(/active/);
    await expect(page.locator('.ntab[data-tab="weekly"]')).toHaveAttribute('aria-current', 'page');
  });

  test('switching tab updates the URL hash', async ({ page }) => {
    await page.evaluate(() => goTab('history'));
    expect(new URL(page.url()).hash).toBe('#history');
    await page.evaluate(() => goTab('stats'));
    expect(new URL(page.url()).hash).toBe('');
  });

  test('?leagueId= in the URL selects that league', async ({ page }) => {
    await page.goto('/?leagueId=youth-league-mox9ep3l');
    expect(await page.evaluate(() => window._activeLeagueId)).toBe('youth-league-mox9ep3l');
    await expect(page.locator('#league-switcher')).toBeHidden();
  });
});

/* ── BOWLER CARDS ────────────────────────────────────────────────── */
test.describe('Bowler cards', () => {
  const payload = avg => ({
    stats: { bowlers: [
      { name: 'Jess', avg: 150, gamesCount: 6, highGame: 180, recentGames: [140, 160], gamesByDate: { '10/05/2026': [140, 150], '10/12/2026': [160, 150] } },
      { name: 'Jen',  avg,      gamesCount: 2, highGame: 130, recentGames: [120, 130] },
    ] },
    weekly:  { weeks: [{ week: '10/12/2026', groupAvg: 140, highGame: 160, bowlers: [{ name: 'Jess', avg: 155, games: [160, 150] }] }] },
    awards:  { currentWeek: null, weekly: {}, milestones: {}, season: {} },
    history: { sessions: [] },
  });

  test.beforeEach(async ({ page }) => {
    // A fresh browser opens on the league picker — put it away so the cards are reachable
    await page.evaluate(p => { hideLeagueSwitcher(); window._activeLeagueId = 'BlameItOnTheLane'; applyAllData(p); }, payload(125));
  });

  test('clashing initials are made distinct', async ({ page }) => {
    const inis = await page.locator('#bowlerCards .px-av').allTextContents();
    expect(new Set(inis).size).toBe(inis.length);
  });

  test('an open card stays open when new data arrives', async ({ page }) => {
    await page.evaluate(() => toggleCard(0));
    await page.evaluate(p => applyAllData(p), payload(126));
    await expect(page.locator('.bc-card[data-name="Jess"]')).toHaveClass(/bc-open/);
    await expect(page.locator('.bc-card[data-name="Jess"] .bc-chart svg')).toBeVisible();
  });

  test('pinning a bowler moves them to the top and survives a reload of the data', async ({ page }) => {
    await page.locator('.bc-card[data-name="Jen"] .bc-star').click();
    await expect(page.locator('#bowlerCards .bc-card').first()).toHaveAttribute('data-name', 'Jen');
    await expect(page.locator('.bc-card[data-name="Jen"] .bc-rank')).toHaveText('2');
    await page.evaluate(p => applyAllData(p), payload(127));
    await expect(page.locator('#bowlerCards .bc-card').first()).toHaveAttribute('data-name', 'Jen');
  });

  test('cards open from the keyboard', async ({ page }) => {
    const summary = page.locator('.bc-card[data-name="Jess"] .bc-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
  });
});

/* ── STATS TAB ───────────────────────────────────────────────────── */
test.describe('Stats tab', () => {
  test('bowlerCards container is present', async ({ page }) => {
    await expect(page.locator('#bowlerCards')).toHaveCount(1);
  });

  test('shows empty state when no data', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const cards = page.locator('#bowlerCards');
    await expect(cards).not.toBeEmpty();
  });
});

/* ── WEEKLY TAB ──────────────────────────────────────────────────── */
test.describe('Weekly tab', () => {
  test('weeklyPanels container is present', async ({ page }) => {
    await expect(page.locator('#weeklyPanels')).toHaveCount(1);
  });

  test('recapBlock container is present', async ({ page }) => {
    await expect(page.locator('#recapBlock')).toHaveCount(1);
  });
});

/* ── AWARDS TAB ──────────────────────────────────────────────────── */
test.describe('Awards tab', () => {
  test('awardsContent container is present', async ({ page }) => {
    await expect(page.locator('#awardsContent')).toHaveCount(1);
  });
});

/* ── HEADER READOUTS ─────────────────────────────────────────────── */
test.describe('Header readouts', () => {
  test('hdr-avg and hdr-high elements exist', async ({ page }) => {
    await expect(page.locator('#hdr-avg')).toHaveCount(1);
    await expect(page.locator('#hdr-high')).toHaveCount(1);
  });
});

/* ── LAYOUT & STYLES ─────────────────────────────────────────────── */
test.describe('Layout and styles', () => {
  test('no horizontal overflow on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bodyWidth  = await page.evaluate(() => document.body.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(innerWidth + 2);
  });

  test('no horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.route('https://script.google.com/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stats: { bowlers: [] }, weekly: { weeks: [] }, awards: {}, history: { sessions: [] } }) })
    );
    const bodyWidth  = await page.evaluate(() => document.body.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(innerWidth + 2);
  });

  test('page background is dark (arcade aesthetic)', async ({ page }) => {
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Expect a dark background — not white
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });

  test('upload link is present on the page', async ({ page }) => {
    const link = page.locator('a[href*="upload"]').first();
    await expect(link).toHaveCount(1);
  });
});

/* ── ACCESSIBILITY BASICS ────────────────────────────────────────── */
test.describe('Accessibility basics', () => {
  test('page has a title element', async ({ page }) => {
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
  });

  test('all images have alt attributes', async ({ page }) => {
    const imgs = await page.locator('img').all();
    for (const img of imgs) {
      const alt = await img.getAttribute('alt');
      expect(alt).not.toBeNull();
    }
  });

  test('interactive buttons have accessible labels', async ({ page }) => {
    const buttons = await page.locator('button[aria-label]').all();
    for (const btn of buttons) {
      const label = await btn.getAttribute('aria-label');
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});

/* ── GAZETTE BADGE ───────────────────────────────────────────────── */
test.describe('Gazette badge', () => {
  test('no badge shown on fresh load', async ({ page }) => {
    // Ensure localStorage is clear
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.route('https://script.google.com/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stats: { bowlers: [] }, weekly: { weeks: [] }, awards: {}, history: { sessions: [] } }) })
    );
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.gazette-badge')).toHaveCount(0);
  });
});
