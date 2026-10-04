import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // База пути к ассетам: '/' по умолчанию (VPS, dev), '/CRYPTORA/' для GitHub Pages —
  // задаётся переменной GITHUB_BASE_PATH в .github/workflows/deploy.yml.
  // Не менять на './' permanent: абсолютные пути нужны production-серверу и e2e.
  base: process.env.GITHUB_BASE_PATH || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(command === 'build'
        ? {
            [path.resolve(__dirname, './src/services/data/DemoMarketDataProvider.ts')]:
              path.resolve(__dirname, './src/services/data/ProductionDemoProviderStub.ts'),
          }
        : {}),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Allow e2b proxy hosts
    // Н9: /api/* есть только у productionServer (:3000) — проксируем, чтобы в dev
    // /api/ai/explain и /api/health не падали 404 и не засоряли консоль.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep heavy application domains out of the entry chunk as well as
          // third-party libraries. These modules are already behind the app's
          // provider/page boundaries and remain independently cacheable.
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
            if (id.includes('lightweight-charts')) return 'vendor-charts';
            if (id.includes('lucide-react') || id.includes('clsx')) return 'vendor-ui';
            return 'vendor-other';
          }
          if (id.includes('/src/services/strategyLab/')) return 'services-strategy-lab';
          // Keep tightly coupled strategy/liquidation modules in Rollup's
          // normal graph. Forcing them into separate manual chunks creates
          // circular ESM chunk dependencies and TDZ failures at runtime.
          // Research result JSON is leaf data, so it is safe to split by
          // version without moving executable strategy modules.
          if (id.includes('/src/services/strategyArchive/results/')) {
            const match = id.match(/\/results\/([^/]+)/);
            return `strategy-results-${match?.[1] ?? 'other'}`;
          }
          if (id.includes('/src/services/derivatives/')) return 'services-derivatives';
          if (id.endsWith('/src/services/signals/live/LiveSignalEngine.ts')) return 'services-live-engine';
          if (id.includes('/src/services/strategyArchive/legacy/v2/')) return 'services-strategy-legacy-v2';
          if (id.includes('/src/services/data/')) return 'services-market-data';
          if (id.includes('/src/services/alerts/')) return 'services-alerts';
        },
      },
    },
  },
}))
