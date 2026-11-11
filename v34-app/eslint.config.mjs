/**
 * Линт продукта V3.4. Покрывает ядро, сервер и мобильный код.
 * Правила намеренно прагматичные: ошибки — только то, что ломает поведение
 * или типы; стилистика не является целью.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/android/**',
      '**/*.config.js',
      'landing/**',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['mobile/jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  {
    // Node-скрипты проверки APK: CommonJS и встроенные модули Node, не браузер.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', process: 'readonly', console: 'readonly',
        Buffer: 'readonly', __dirname: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['mobile/**/*.ts', 'mobile/**/*.tsx'],
    languageOptions: {
      globals: {
        fetch: 'readonly', AbortController: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', console: 'readonly', process: 'readonly',
        URLSearchParams: 'readonly', RequestInit: 'readonly', Response: 'readonly',
      },
    },
  },
);
