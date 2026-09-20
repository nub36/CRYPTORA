/// <reference types="vite/client" />

/**
 * Типы Vite для фронтенда (import.meta.env.BASE_URL и др.).
 * BASE_URL задаётся полем `base` в vite.config.ts: '/' (VPS/dev) или '/CRYPTORA/'
 * (GitHub Pages, переменная GITHUB_BASE_PATH в .github/workflows/deploy.yml).
 * Единственное использование — basename BrowserRouter в src/main.tsx.
 */
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
