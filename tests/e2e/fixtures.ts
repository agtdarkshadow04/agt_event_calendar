import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Shared values of the browser tests (TEST-6). `playwright.config.ts` reads them too. */
export const E2E_PORT = 18080;
export const E2E_SETUP_PASSWORD = 'e2e-setup-password-0123';
export const E2E_ADMIN = { username: 'e2e-admin', password: 'correct horse battery staple' };
/** Signed-in browser state saved by the setup project. */
export const ADMIN_STATE = 'tests/e2e/.auth/admin.json';
export const WIDTHS = [300, 520, 640, 760, 1180];

/**
 * Collects console errors, uncaught page errors and CSP violations for every test, and fails the test if there are
 * any (TEST-6: no console errors and no CSP violations).
 */
export const test = base.extend<{ pageProblems: string[] }>({
  pageProblems: [async ({ page }, use) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      // The browser logs every 4xx response as "Failed to load resource"; a test that expects one (a wrong password,
      // the signed-out session check) checks it itself. Script errors and 5xx responses always count.
      if (message.type() !== 'error' || /^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) return;
      problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await use(problems);
    expect(problems, 'console errors or CSP violations').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** True if the page scrolls horizontally (UI-12). */
export function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}
