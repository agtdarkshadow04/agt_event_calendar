import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, E2E_SETUP_PASSWORD } from './tests/e2e/fixtures';

/**
 * Browser tests (AGT web app spec TEST-6). Playwright starts the built server with a fresh data directory, a test
 * config.yaml and a setup password, so every run starts from first run. Run with `npm run test:e2e`.
 */

// This file is also loaded by the worker processes; they inherit the directory made by the main process.
process.env.AGT_E2E_DIR ??= mkdtempSync(path.join(tmpdir(), 'agt-e2e-'));
const dir = process.env.AGT_E2E_DIR;
writeFileSync(path.join(dir, 'config.yaml'), [
  'server:',
  `  port: ${E2E_PORT}`,
  'storage:',
  `  dataDir: ${path.join(dir, 'data')}`,
  // Cheap captcha and generous limits: the suite signs in and submits more often than a person would.
  'altcha:',
  '  cost: 1000',
  'rateLimits:',
  '  login: { max: 1000 }',
  '  setup: { max: 1000 }',
  '',
].join('\n'));

export default defineConfig({
  testDir: 'tests/e2e',
  // One server and one data directory, changed by the tests (first-run setup, created content).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
    // Only for a machine whose Chromium does not match this Playwright version (not needed in CI).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [
    { name: 'setup', testMatch: /setup\.e2e\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node dist-server/index.mjs',
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AGT_CONFIG_FILE: path.join(dir, 'config.yaml'),
      AGT_SETUP_PASSWORD: E2E_SETUP_PASSWORD,
      NODE_ENV: 'production',
    },
  },
});
