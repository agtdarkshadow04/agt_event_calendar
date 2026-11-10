import { ADMIN_STATE, E2E_ADMIN, E2E_SETUP_PASSWORD, expect, test } from './fixtures';

// First-run setup through the UI (AUTH-5), once, as the setup project the other tests depend on (TEST-6).

test('first-run setup creates the admin account and signs in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Create the admin account' })).toBeVisible();
  await page.getByLabel('Setup password').fill(E2E_SETUP_PASSWORD);
  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('New password').fill(E2E_ADMIN.password);
  await page.getByLabel('Confirm password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // Content for the dialogs and pages the other tests open, created through the API with this session.
  const headers = { 'x-agt-request': '1' };
  const now = new Date();
  const at = (day: number, hour: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour)).toISOString();
  for (const [name, day] of [['Grand Expedition Meetup', 5], ['Portal Hunt', 12], ['Racing Night', 21]] as const) {
    const response = await page.request.post('/api/admin/events', {
      headers,
      data: {
        name, start: at(day, 18), end: at(day, 20), civilization: 'AGT', type: 'Community',
        description: `**${name}** for every traveller.`, links: ['https://example.com/'], galaxy: 'Euclid',
        region: 'Ogatakor Fringe', system: 'Hadrez', planet: 'Alpha', portalCode: '0123ABCD4567', status: 'published',
      },
    });
    expect(response.status()).toBe(201);
  }
  expect((await page.request.post('/api/admin/holidays', {
    headers, data: { name: 'Founding Day', civilization: 'AGT', date: '2018-12-05', type: 'Anniversary' },
  })).status()).toBe(201);
  expect((await page.request.post('/api/admin/changelog', {
    headers, data: { date: '2026-11-10', changes: 'Browser tests, Translated errors' },
  })).status()).toBe(201);

  await page.context().storageState({ path: ADMIN_STATE });
});
