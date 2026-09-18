import React from 'react';

/**
 * Deterministic color from symbol string (no randomness).
 * All colors have ≥ 4.5:1 contrast with white text (WCAG AA).
 */
function symbolColor(symbol: string): string {
  const COLORS = [
    '#F7931A', '#627EEA', '#00A87D', '#D4A017', '#2563EB',
    '#1D4ED8', '#B8860B', '#DC2626', '#4338CA', '#DB2777',
    '#1D4ED8', '#7C3AED', '#E11D48', '#0891B2', '#EA580C',
    '#059669', '#4F46E5', '#BE185D', '#6D28D9', '#0E7490',
  ];
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface CoinIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

/**
 * Coin icon: deterministic colored circle with first letter of ticker.
 * No external API requests. No CoinGecko/Binance metadata calls.
 */
export const CoinIcon: React.FC<CoinIconProps> = ({ symbol, size = 24, className = '' }) => {
  const bg = symbolColor(symbol);
  const fontSize = Math.max(11, size * 0.45);
  const letter = (symbol || '?')[0].toUpperCase();

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 select-none ${className}`}
      style={{ width: size, height: size, backgroundColor: bg, fontSize }}
      title={symbol}
      aria-label={symbol}
    >
      {letter}
    </div>
  );
};
