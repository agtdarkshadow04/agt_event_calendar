import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { ADMIN_STATE, E2E_ADMIN, expect, test } from './fixtures';

// Both entries load cleanly, sign-in works through the UI, controls have accessible names, and axe finds no
// WCAG 2.2 AA violations (TEST-6, A11Y-1, A11Y-3, A11Y-5). Console errors and CSP violations fail every test.

async function expectNoAxeViolations(page: Page, label: string) {
  // Measure the settled page: a dialog fading in is semi-transparent, which axe would report as low contrast.
  await page.waitForFunction(() => document.getAnimations()
    .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test.describe('public calendar', () => {
  test('loads, names its controls and passes axe', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grand Expedition Meetup' }).first()).toBeVisible();
    for (const name of ['Open settings', 'Bookmarks', 'AGT National Holidays', 'Add an Event']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Event calendar' })).toBeVisible();
    await expectNoAxeViolations(page, '/');
  });

  test('passes axe with each dialog open', async ({ page }) => {
    await page.goto('/');
    const dialogs: [string, () => Promise<void>][] = [
      ['event details', () => page.getByRole('button', { name: 'Grand Expedition Meetup' }).first().click()],
      ['settings', () => page.getByRole('button', { name: 'Open settings' }).click()],
      ['bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click()],
      ['national holidays', () => page.getByRole('button', { name: 'AGT National Holidays', exact: true }).click()],
      ['submit an event', () => page.getByRole('button', { name: 'Add an Event', exact: true }).click()],
    ];
    for (const [label, open] of dialogs) {
      await open();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoAxeViolations(page, `the ${label} dialog`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
});

test.describe('admin dashboard', () => {
  test('signs in and out through the UI', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectNoAxeViolations(page, 'the sign-in screen');
    await page.getByLabel('Username').fill(E2E_ADMIN.username);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('The username or password is incorrect.');
    await page.getByLabel('Password').fill(E2E_ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test.describe('signed in', () => {
    test.use({ storageState: ADMIN_STATE });

    test('every tab loads, names its controls and passes axe', async ({ page }) => {
      await page.goto('/admin');
      const tabs = page.getByRole('tab');
      await expect(tabs.first()).toBeVisible();
      const count = await tabs.count();
      expect(count).toBeGreaterThan(5);
      for (let index = 0; index < count; index += 1) {
        const tab = tabs.nth(index);
        const name = (await tab.textContent())?.trim() ?? '';
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectNoAxeViolations(page, `the ${name} tab`);
      }
    });
  });
});
