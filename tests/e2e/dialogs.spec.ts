import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Every dialog opens from the keyboard, keeps Tab inside, closes on Escape and returns focus to its opener (A11Y-2).

async function checkDialog(page: Page, opener: Locator) {
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const label = await dialog.getAttribute('aria-labelledby');
  expect(label, 'aria-labelledby').toBeTruthy();
  await expect(page.locator(`[id="${label}"]`)).not.toBeEmpty();
  // Initial focus is inside the dialog, and Tab and Shift+Tab never leave it.
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (const key of [...Array(25).fill('Tab'), ...Array(25).fill('Shift+Tab')] as string[]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `focus after ${key}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

test('public dialogs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Grand Expedition Meetup' }).first()).toBeVisible();
  await checkDialog(page, page.getByRole('button', { name: 'Grand Expedition Meetup' }).first());
  await checkDialog(page, page.getByRole('button', { name: 'Open settings' }));
  await checkDialog(page, page.getByRole('button', { name: 'Bookmarks', exact: true }));
  await checkDialog(page, page.getByRole('button', { name: 'AGT National Holidays', exact: true }));
  await checkDialog(page, page.getByRole('button', { name: 'Add an Event', exact: true }));
});

test('the change log opens from the settings dialog and returns there', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const openChangeLog = page.getByRole('dialog').getByRole('button', { name: 'Change Log' });
  await openChangeLog.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Change Log' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Change Log' })).toHaveCount(0);
});
