/** Тёмная тема приложения: высокий контраст, крупные тач-цели, без декораций. */
export const colors = {
  bg: '#07090d',
  surface: '#11161f',
  surfaceAlt: '#161d28',
  border: '#232c3a',
  text: '#e7edf5',
  muted: '#93a1b5',
  accent: '#4ade80',
  accentSoft: '#1f6f43',
  long: '#4ade80',
  short: '#f87171',
  warn: '#f0b429',
  warnSoft: 'rgba(240,180,41,0.12)',
  danger: '#f87171',
  dangerSoft: 'rgba(248,113,113,0.12)',
  okSoft: 'rgba(74,222,128,0.12)',
  warnText: '#f5d78a',
  warnBg: 'rgba(240,180,41,0.10)',
  warnBorder: 'rgba(240,180,41,0.35)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
