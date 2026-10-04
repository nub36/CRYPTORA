import { defineConfig } from '@playwright/test';

const e2ePort = 4173;
const webServerMode = process.env.PLAYWRIGHT_WEB_SERVER === 'dev' ? 'dev' : 'preview';
const webServerCommand = webServerMode === 'dev'
  ? `npm run dev -- --port ${e2ePort}`
  : 'npm run preview';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    testIdAttribute: 'data-qa',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  // В CI одна ретрая попытка — страховка от сетевого флака браузерных тестов.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Exclude screenshot QA tests from regular run — run on CI with --grep-invert '' to include
  testIgnore: process.env.CI_SCREENSHOTS ? [] : ['**/screenshotQA*'],
  webServer: {
    command: webServerCommand,
    url: `http://localhost:${e2ePort}`,
    reuseExistingServer: webServerMode === 'dev' && !process.env.CI,
    // Полный browser e2e использует dev-сервер для QA fixtures; production smoke
    // запускается через vite preview. Оба режима намеренно согласованы на 4173.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
