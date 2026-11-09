import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: '@v34/core', replacement: path.resolve(__dirname, '../packages/v34-core/src/index.ts') },
      { find: /^node:sqlite$/, replacement: path.resolve(__dirname, 'test/support/sqliteShim.ts') },
    ],
  },
  ssr: { external: ['node:sqlite'] },
  test: {
    // Vite не знает про node:sqlite (встроенный модуль Node 22) и пытается
    // резолвить его как пакет. Тестам нужен именно встроенный модуль.
    server: { deps: { external: [/node:sqlite/] } },
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
