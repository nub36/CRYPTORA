import React from 'react';

/**
 * Палитра фонов иконок: детерминированный выбор по хэшу символа (без random).
 * Д2 (v0.8.52): прежняя палитра содержала светлые цвета (#F7931A, #D4A017, #EA580C…),
 * дающие 1.8–3.3:1 с белым текстом буквы — ниже порога WCAG AA (4.5:1).
 * Каждый цвет здесь проверен юнит-тестом на >= 4.5:1 с белым.
 */
export const COIN_ICON_PALETTE = [
  '#B45309', '#4F46E5', '#047857', '#92400E', '#2563EB',
  '#1D4ED8', '#854D0E', '#DC2626', '#4338CA', '#BE185D',
  '#7C3AED', '#E11D48', '#0E7490', '#C2410C', '#065F46',
  '#6D28D9', '#9F1239', '#A16207', '#1E40AF', '#86198F',
] as const;

function symbolColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  return COIN_ICON_PALETTE[Math.abs(hash) % COIN_ICON_PALETTE.length];
}

interface CoinIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

/**
 * Coin icon: deterministic colored circle with first letter of ticker (AA-контраст буквы, Д2).
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
