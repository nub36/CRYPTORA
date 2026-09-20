import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // База пути к ассетам: '/' по умолчанию (VPS, dev), '/CRYPTORA/' для GitHub Pages —
  // задаётся переменной GITHUB_BASE_PATH в .github/workflows/deploy.yml.
  // Не менять на './' permanent: абсолютные пути нужны production-серверу и e2e.
  base: process.env.GITHUB_BASE_PATH || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Allow e2b proxy hosts
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy shared libs split from main bundle
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['lightweight-charts'],
          'vendor-ui': ['lucide-react', 'clsx'],
        },
      },
    },
  },
})
