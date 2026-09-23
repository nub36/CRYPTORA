import React, { useEffect, useState } from 'react';
import { getCoinLogoUrl } from '@/services/data/registry/coinLogoRegistry';

/**
 * Палитра letter-avatar fallback с контрастом AA; применяется только пока логотип
 * не найден, не загрузился, или у актива нет CoinGecko metadata.
 */
export const COIN_ICON_PALETTE = [
  '#B45309', '#4F46E5', '#047857', '#92400E', '#2563EB',
  '#1D4ED8', '#854D0E', '#DC2626', '#4338CA', '#BE185D',
  '#7C3AED', '#E11D48', '#0E7490', '#C2410C', '#065F46',
  '#6D28D9', '#9F1239', '#A16207', '#1E40AF', '#86198F',
] as const;

function symbolColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  return COIN_ICON_PALETTE[Math.abs(hash) % COIN_ICON_PALETTE.length];
}

interface CoinIconProps {
  symbol: string;
  size?: number;
  className?: string;
  /** Optional metadata override; normal use resolves CoinGecko's shared catalog cache. */
  logoUrl?: string | null;
}

export const CoinIcon: React.FC<CoinIconProps> = ({ symbol, size = 24, className = '', logoUrl }) => {
  const [metadataLogoUrl, setMetadataLogoUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const normalizedSymbol = (symbol || '?').split('/')[0].toUpperCase().replace(/USDT$/, '');
  const resolvedLogoUrl = logoUrl === undefined ? metadataLogoUrl : logoUrl;
  const imageFailed = resolvedLogoUrl != null && failedUrl === resolvedLogoUrl;

  useEffect(() => {
    let active = true;
    if (logoUrl !== undefined) {
      setMetadataLogoUrl(logoUrl);
      return () => { active = false; };
    }
    setMetadataLogoUrl(null);
    void getCoinLogoUrl(normalizedSymbol).then((url) => {
      if (active) setMetadataLogoUrl(url);
    });
    return () => { active = false; };
  }, [normalizedSymbol, logoUrl]);

  const fontSize = Math.max(11, size * 0.45);
  const commonStyle: React.CSSProperties = { width: size, height: size };

  if (resolvedLogoUrl && !imageFailed) {
    return (
      <img
        src={resolvedLogoUrl}
        alt={`${normalizedSymbol} logo`}
        title={normalizedSymbol}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(resolvedLogoUrl)}
        className={`rounded-full object-contain flex-shrink-0 bg-white ${className}`}
        style={commonStyle}
        data-testid="coin-logo-image"
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 select-none ${className}`}
      style={{ ...commonStyle, backgroundColor: symbolColor(normalizedSymbol), fontSize }}
      title={normalizedSymbol}
      aria-label={normalizedSymbol}
      role="img"
      data-testid="coin-logo-fallback"
    >
      {normalizedSymbol[0] || '?'}
    </div>
  );
};
