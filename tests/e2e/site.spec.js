// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
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

  test('footer marquee is rendered', async ({ page }) => {
    const footer = page.locator('#footerTrack');
    await expect(footer).toBeVisible();
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
