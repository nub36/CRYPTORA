/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    /**
     * Кастомные точки перехода терминала.
     * Порядок строго по возрастанию min-width: от него зависит порядок media-запросов
     * в сгенерированном CSS и, следовательно, корректность каскада.
     *
     *  lg    1024px — базовый desktop: полная навигация без иконок, компактные service controls
     *  navmd 1152px — вторичные controls «вырастают»: inline-поиск, плашка тарифа
     *  xl    1280px — иконки в primary navigation, текстовая плашка режима данных
     *  navxl 1440px — полная плашка LIVE SPOT + WS, широкий поиск
     *  2xl   1536px — крупнее кегль навигации, слоган, чип тарифа в шапке
     *  nav2xl 1700px — максимальная плотность без сжатия: полный текст чипа тарифа
     */
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      navmd: '1152px',
      xl: '1280px',
      navxl: '1440px',
      '2xl': '1536px',
      nav2xl: '1700px',
    },
    extend: {
      colors: {
        /**
         * Семантические токены темы (UX-цикл п. 4). Значения живут в src/index.css
         * (:root = DARK, html.light = LIGHT) как RGB-триплеты, чтобы работали alpha-модификаторы
         * (bg-surface-elevated/60, border-white/[0.08]). Палитры slate/white переопределены на
         * переменные: в светлой теме шкала инвертируется (slate-400 остаётся средне-серым,
         * slate-200 → тёмный текст, white → почти чёрный «контрастный» цвет).
         * ЗАФИКСИРОВАНЫ (одинаковы в обеих темах): black, slate-950 (текст на цветных кнопках),
         * brand/accent (финансовая семантика: рост/падение/предупреждение).
         */
        root: 'rgb(var(--c-root) / <alpha-value>)',
        white: 'rgb(var(--c-contrast) / <alpha-value>)',
        slate: {
          50: 'rgb(var(--c-slate-50) / <alpha-value>)',
          100: 'rgb(var(--c-slate-100) / <alpha-value>)',
          200: 'rgb(var(--c-slate-200) / <alpha-value>)',
          300: 'rgb(var(--c-slate-300) / <alpha-value>)',
          400: 'rgb(var(--c-slate-400) / <alpha-value>)',
          500: 'rgb(var(--c-slate-500) / <alpha-value>)',
          600: 'rgb(var(--c-slate-600) / <alpha-value>)',
          700: 'rgb(var(--c-slate-700) / <alpha-value>)',
          800: 'rgb(var(--c-slate-800) / <alpha-value>)',
          900: 'rgb(var(--c-slate-900) / <alpha-value>)',
          950: 'rgb(var(--c-on-accent) / <alpha-value>)',
        },
        rose: {
          50: 'rgb(var(--c-rose-50) / <alpha-value>)',
          100: 'rgb(var(--c-rose-100) / <alpha-value>)',
          200: 'rgb(var(--c-rose-200) / <alpha-value>)',
          300: 'rgb(var(--c-rose-300) / <alpha-value>)',
          400: 'rgb(var(--c-rose-400) / <alpha-value>)',
          500: 'rgb(var(--c-rose-500) / <alpha-value>)',
          600: 'rgb(var(--c-rose-600) / <alpha-value>)',
          700: 'rgb(var(--c-rose-700) / <alpha-value>)',
          800: 'rgb(var(--c-rose-800) / <alpha-value>)',
          900: 'rgb(var(--c-rose-900) / <alpha-value>)',
          950: 'rgb(var(--c-rose-950) / <alpha-value>)',
        },
        emerald: {
          50: 'rgb(var(--c-emerald-50) / <alpha-value>)',
          100: 'rgb(var(--c-emerald-100) / <alpha-value>)',
          200: 'rgb(var(--c-emerald-200) / <alpha-value>)',
          300: 'rgb(var(--c-emerald-300) / <alpha-value>)',
          400: 'rgb(var(--c-emerald-400) / <alpha-value>)',
          500: 'rgb(var(--c-emerald-500) / <alpha-value>)',
          600: 'rgb(var(--c-emerald-600) / <alpha-value>)',
          700: 'rgb(var(--c-emerald-700) / <alpha-value>)',
          800: 'rgb(var(--c-emerald-800) / <alpha-value>)',
          900: 'rgb(var(--c-emerald-900) / <alpha-value>)',
          950: 'rgb(var(--c-emerald-950) / <alpha-value>)',
        },
        cyan: {
          50: 'rgb(var(--c-cyan-50) / <alpha-value>)',
          100: 'rgb(var(--c-cyan-100) / <alpha-value>)',
          200: 'rgb(var(--c-cyan-200) / <alpha-value>)',
          300: 'rgb(var(--c-cyan-300) / <alpha-value>)',
          400: 'rgb(var(--c-cyan-400) / <alpha-value>)',
          500: 'rgb(var(--c-cyan-500) / <alpha-value>)',
          600: 'rgb(var(--c-cyan-600) / <alpha-value>)',
          700: 'rgb(var(--c-cyan-700) / <alpha-value>)',
          800: 'rgb(var(--c-cyan-800) / <alpha-value>)',
          900: 'rgb(var(--c-cyan-900) / <alpha-value>)',
          950: 'rgb(var(--c-cyan-950) / <alpha-value>)',
        },
        amber: {
          50: 'rgb(var(--c-amber-50) / <alpha-value>)',
          100: 'rgb(var(--c-amber-100) / <alpha-value>)',
          200: 'rgb(var(--c-amber-200) / <alpha-value>)',
          300: 'rgb(var(--c-amber-300) / <alpha-value>)',
          400: 'rgb(var(--c-amber-400) / <alpha-value>)',
          500: 'rgb(var(--c-amber-500) / <alpha-value>)',
          600: 'rgb(var(--c-amber-600) / <alpha-value>)',
          700: 'rgb(var(--c-amber-700) / <alpha-value>)',
          800: 'rgb(var(--c-amber-800) / <alpha-value>)',
          900: 'rgb(var(--c-amber-900) / <alpha-value>)',
          950: 'rgb(var(--c-amber-950) / <alpha-value>)',
        },
        violet: {
          50: 'rgb(var(--c-violet-50) / <alpha-value>)',
          100: 'rgb(var(--c-violet-100) / <alpha-value>)',
          200: 'rgb(var(--c-violet-200) / <alpha-value>)',
          300: 'rgb(var(--c-violet-300) / <alpha-value>)',
          400: 'rgb(var(--c-violet-400) / <alpha-value>)',
          500: 'rgb(var(--c-violet-500) / <alpha-value>)',
          600: 'rgb(var(--c-violet-600) / <alpha-value>)',
          700: 'rgb(var(--c-violet-700) / <alpha-value>)',
          800: 'rgb(var(--c-violet-800) / <alpha-value>)',
          900: 'rgb(var(--c-violet-900) / <alpha-value>)',
          950: 'rgb(var(--c-violet-950) / <alpha-value>)',
        },
        purple: {
          50: 'rgb(var(--c-purple-50) / <alpha-value>)',
          100: 'rgb(var(--c-purple-100) / <alpha-value>)',
          200: 'rgb(var(--c-purple-200) / <alpha-value>)',
          300: 'rgb(var(--c-purple-300) / <alpha-value>)',
          400: 'rgb(var(--c-purple-400) / <alpha-value>)',
          500: 'rgb(var(--c-purple-500) / <alpha-value>)',
          600: 'rgb(var(--c-purple-600) / <alpha-value>)',
          700: 'rgb(var(--c-purple-700) / <alpha-value>)',
          800: 'rgb(var(--c-purple-800) / <alpha-value>)',
          900: 'rgb(var(--c-purple-900) / <alpha-value>)',
          950: 'rgb(var(--c-purple-950) / <alpha-value>)',
        },
        sky: {
          50: 'rgb(var(--c-sky-50) / <alpha-value>)',
          100: 'rgb(var(--c-sky-100) / <alpha-value>)',
          200: 'rgb(var(--c-sky-200) / <alpha-value>)',
          300: 'rgb(var(--c-sky-300) / <alpha-value>)',
          400: 'rgb(var(--c-sky-400) / <alpha-value>)',
          500: 'rgb(var(--c-sky-500) / <alpha-value>)',
          600: 'rgb(var(--c-sky-600) / <alpha-value>)',
          700: 'rgb(var(--c-sky-700) / <alpha-value>)',
          800: 'rgb(var(--c-sky-800) / <alpha-value>)',
          900: 'rgb(var(--c-sky-900) / <alpha-value>)',
          950: 'rgb(var(--c-sky-950) / <alpha-value>)',
        },
        blue: {
          50: 'rgb(var(--c-blue-50) / <alpha-value>)',
          100: 'rgb(var(--c-blue-100) / <alpha-value>)',
          200: 'rgb(var(--c-blue-200) / <alpha-value>)',
          300: 'rgb(var(--c-blue-300) / <alpha-value>)',
          400: 'rgb(var(--c-blue-400) / <alpha-value>)',
          500: 'rgb(var(--c-blue-500) / <alpha-value>)',
          600: 'rgb(var(--c-blue-600) / <alpha-value>)',
          700: 'rgb(var(--c-blue-700) / <alpha-value>)',
          800: 'rgb(var(--c-blue-800) / <alpha-value>)',
          900: 'rgb(var(--c-blue-900) / <alpha-value>)',
          950: 'rgb(var(--c-blue-950) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--c-surface-1) / <alpha-value>)',
          1: 'rgb(var(--c-surface-1) / <alpha-value>)',
          2: 'rgb(var(--c-surface-2) / <alpha-value>)',
          3: 'rgb(var(--c-surface-3) / <alpha-value>)',
          elevated: 'rgb(var(--c-surface-elevated) / <alpha-value>)',
          hover: 'rgb(var(--c-surface-hover) / <alpha-value>)',
          border: 'rgb(var(--c-contrast) / 0.08)',
          'border-subtle': 'rgb(var(--c-contrast) / 0.05)',
          'border-active': 'rgba(34, 211, 238, 0.45)',
          inset: 'rgb(var(--c-surface-inset) / <alpha-value>)',
        },
        brand: {
          green: 'rgb(var(--c-brand-green) / <alpha-value>)',
          red: 'rgb(var(--c-brand-red) / <alpha-value>)',
          cyan: 'rgb(var(--c-brand-cyan) / <alpha-value>)',
          amber: 'rgb(var(--c-brand-amber) / <alpha-value>)',
          purple: 'rgb(var(--c-brand-purple) / <alpha-value>)',
          sky: 'rgb(var(--c-brand-sky) / <alpha-value>)',
          blue: 'rgb(var(--c-brand-blue) / <alpha-value>)',
        },
        accent: {
          cyan: 'rgb(var(--c-brand-cyan) / <alpha-value>)',
          blue: 'rgb(var(--c-brand-blue) / <alpha-value>)',
          violet: 'rgb(var(--c-brand-purple) / <alpha-value>)',
          emerald: 'rgb(var(--c-brand-green) / <alpha-value>)',
          rose: 'rgb(var(--c-brand-red) / <alpha-value>)',
          amber: 'rgb(var(--c-brand-amber) / <alpha-value>)',
        },
        /* Текст поверх акцентных заливок (bg-brand-*): тёмный в DARK, белый в LIGHT (акценты там темнее) */
      },
      boxShadow: {
        'glow-cyan': '0 0 24px -4px rgba(34, 211, 238, 0.25)',
        'glow-violet': '0 0 24px -4px rgba(139, 92, 246, 0.25)',
        'glow-subtle': '0 0 20px -5px rgba(34, 211, 238, 0.12)',
        'panel': '0 4px 20px -2px rgb(0 0 0 / var(--shadow-alpha)), 0 0 0 1px rgb(var(--c-contrast) / 0.06)',
        'panel-elevated': '0 8px 30px -4px rgb(0 0 0 / var(--shadow-alpha-strong)), 0 0 0 1px rgb(var(--c-contrast) / 0.09)',
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
