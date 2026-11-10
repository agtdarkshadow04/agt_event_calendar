import { ADMIN_STATE, WIDTHS, expect, hasHorizontalScroll, test } from './fixtures';

// No horizontal page scroll at the reference widths, and at 300 px with the 2× font scale (UI-12, A11Y-6).

const SETTINGS_KEY = 'agt_event_calendar_settings';

for (const width of WIDTHS) {
  test(`no horizontal scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Grand Expedition Meetup' }).first()).toBeVisible();
    expect(await hasHorizontalScroll(page), 'calendar').toBe(false);
    await page.getByRole('button', { name: 'Grand Expedition Meetup' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await hasHorizontalScroll(page), 'event dialog').toBe(false);
  });
}

test('no horizontal scroll at 300 px with the 2× font scale', async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 900 });
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({ fontScale: '2x', locale: 'en', timeZone: 'Auto', anthem: 'mute' }));
  }, SETTINGS_KEY);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Grand Expedition Meetup' }).first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).not.toBe('16px');
  expect(await hasHorizontalScroll(page), 'calendar at 2×').toBe(false);
  await page.getByRole('button', { name: 'Open settings' }).click();
  expect(await hasHorizontalScroll(page), 'settings dialog at 2×').toBe(false);
});

test.describe('admin dashboard', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const width of WIDTHS) {
    test(`no horizontal scroll at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin');
      await expect(page.getByRole('tab').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }
});
