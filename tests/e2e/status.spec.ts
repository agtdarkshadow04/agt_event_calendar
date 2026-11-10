import { expect, test } from './fixtures';

// Status messages appear in a live region (A11Y-4).

test('the calendar summary is a live region that follows the filters', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('.calendar-summary');
  await expect(summary).toHaveAttribute('aria-live', 'polite');
  const before = await summary.textContent();
  await page.getByRole('searchbox', { name: 'Search' }).fill('Portal Hunt');
  await expect(summary).not.toHaveText(before ?? '');
});

test('form errors are announced', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an Event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Submit' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Please check the highlighted fields.');
});
