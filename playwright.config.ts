import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  // Exclude screenshot QA tests from regular run — run on CI with --grep-invert '' to include
  testIgnore: process.env.CI_SCREENSHOTS ? [] : ['**/screenshotQA*'],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
