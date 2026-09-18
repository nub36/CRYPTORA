import React from 'react';

/** Deterministic color from symbol string (no randomness). */
function symbolColor(symbol: string): string {
  const COLORS = [
    '#F7931A', '#627EEA', '#00D4AA', '#F0B90B', '#23292F',
    '#0033AD', '#C2A633', '#E84142', '#2A5ADA', '#E6007A',
    '#2775CA', '#8247E5', '#E4405F', '#00BFFF', '#FF6600',
    '#26A17B', '#1A1A2E', '#FF4081', '#7B61FF', '#00BCD4',
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
  const fontSize = Math.max(10, size * 0.45);
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
