import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // baseURL: без него page.goto('/') = «Cannot navigate to invalid URL»
  // (routes.spec не пострадал — там абсолютные URL).
  use: { baseURL: 'http://localhost:5173' },
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  // В CI одна ретрая попытка — страховка от сетевого флака браузерных тестов.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Exclude screenshot QA tests from regular run — run on CI with --grep-invert '' to include
  testIgnore: process.env.CI_SCREENSHOTS ? [] : ['**/screenshotQA*'],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // Холодный старт vite dev на CI (optimizeDeps lucide-react и др.) может
    // занимать заметно больше 15с — раньше из-за этого падали ВСЕ e2e разом.
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
