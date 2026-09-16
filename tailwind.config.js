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
        root: '#06080e',
        surface: {
          DEFAULT: '#0a0f1d',
          1: '#0a0f1d',
          2: '#0f172a',
          3: '#141e36',
          elevated: '#111a30',
          hover: '#17233f',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-subtle': 'rgba(255, 255, 255, 0.05)',
          'border-active': 'rgba(34, 211, 238, 0.45)',
          inset: '#070b14',
        },
        brand: {
          green: '#10b981',
          red: '#f43f5e',
          cyan: '#22d3ee',
          amber: '#f59e0b',
          purple: '#8b5cf6',
          sky: '#38bdf8',
          blue: '#3b82f6',
        },
        accent: {
          cyan: '#22d3ee',
          blue: '#3b82f6',
          violet: '#8b5cf6',
          emerald: '#10b981',
          rose: '#f43f5e',
          amber: '#f59e0b',
        }
      },
      boxShadow: {
        'glow-cyan': '0 0 24px -4px rgba(34, 211, 238, 0.25)',
        'glow-violet': '0 0 24px -4px rgba(139, 92, 246, 0.25)',
        'glow-subtle': '0 0 20px -5px rgba(34, 211, 238, 0.12)',
        'panel': '0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        'panel-elevated': '0 8px 30px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09)',
        'panel-active': '0 0 0 1px rgba(34, 211, 238, 0.4), 0 8px 30px -4px rgba(6, 182, 212, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'gradient-shift': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        'sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },
      animation: {
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'sweep': 'sweep 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
