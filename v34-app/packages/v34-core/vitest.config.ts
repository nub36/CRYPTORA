/**
 * Тесты изолированного ядра V3.4.
 *
 * Алиас `@` намеренно указывает на ИСХОДНЫЙ `src/` CRYPTORA: parity-тесты
 * импортируют настоящие модули стратегии и сравнивают их с копиями. Пакет
 * собственных алиасов не использует — его исходники связаны относительными
 * путями, поэтому сравнение «копия ↔ источник» возможно в одном процессе.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const CRYPTORA_SRC = path.resolve(__dirname, '../../../src');

export default defineConfig({
  // Корневой postcss.config.js CRYPTORA (tailwind) к этому пакету отношения не
  // имеет: отключаем поиск PostCSS-конфига, чтобы тесты не зависели от него.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [{ find: /^@\//, replacement: `${CRYPTORA_SRC}/` }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
