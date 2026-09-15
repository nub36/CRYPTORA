/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        root: '#080b11',
        surface: {
          DEFAULT: '#0f1420',
          elevated: '#151c2c',
          hover: '#1b2438',
          border: '#1f2b42',
        },
        brand: {
          green: '#10b981',
          red: '#f43f5e',
          cyan: '#06b6d4',
          amber: '#f59e0b',
          purple: '#8b5cf6',
          sky: '#38bdf8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      }
    },
  },
  plugins: [],
}
