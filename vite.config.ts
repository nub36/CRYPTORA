import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
// GitHub Pages (Project Pages) публикуется по адресу https://<user>.github.io/<repo>/
// Для корректных путей к ассетам (/assets/*.js, *.css) нужен base = "/<repo>/".
// - Для репозитория nub36/CRYPTORA это "/CRYPTORA/".
// - Если подключишь кастомный домен (username.github.io -> корень), поменяй на "/".
//   Также можно переопределить через переменную окружения:  GITHUB_PAGES_BASE=/ npm run build
// dev-сервер остаётся на "/" (удобство локальной разработки), build — на "/CRYPTORA/" по умолчанию.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : process.env.GITHUB_PAGES_BASE || '/CRYPTORA/',
  plugins: [react()],
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
}))
