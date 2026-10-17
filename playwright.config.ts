import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4178);
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/playwright',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // CI defaults to Playwright Chromium; local machines can opt into installed Chrome.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 480, height: 800 } }, testMatch: /(?:documents|design|publish)\.spec\.ts/ },
  ],
  webServer: {
    command: `node tests/ui/serve.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/ui/fixtures/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
