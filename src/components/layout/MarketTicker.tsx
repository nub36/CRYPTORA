import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetSummary } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Sparkline } from '@/components/common/Sparkline';
import { TrendingUp, TrendingDown, RadioTower } from 'lucide-react';

/**
 * MarketTicker — бегущая строка рыночных котировок под шапкой.
 *
 * LIVE-FIRST (v0.8.5): котировки приходят только из активного провайдера данных.
 * Если фактический источник недоступен, полоса честно сообщает об этом и не
 * подставляет числа из другого датасета (инвариант: сбой LIVE ≠ подмена на QA-датасет).
 *
 * MARQUEE: это настоящая непрерывная бегущая строка, а не статичная полоса.
 *  - Один и тот же набор тикеров рендерится ДВАЖДЫ в одном треке; трек
 *    смещается на -50% (см. `.ticker-marquee` в index.css), поэтому стык
 *    невидим и цикл бесшовный.
 *  - Анимация — только CSS transform (композитинг на GPU), без JS-таймеров.
 *  - Данные берутся ОДИН раз тем же вызовом `provider.getAssets()`, что и
 *    раньше: дублирование чисто визуальное, дополнительных запросов к рынку нет.
 *  - Контейнер `overflow-hidden`, поэтому тикер не растягивает body по ширине.
 *  - Пауза при наведении/фокусе и полное отключение при prefers-reduced-motion.
 */
export const MarketTicker: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  const isLiveMode = dataMode === 'live';

  useEffect(() => {
    let isActive = true;
    setSourceUnavailable(false);
    provider
      .getAssets()
      .then((list) => {
        if (!isActive) return;
        setAssets(list.slice(0, 10));
      })
      .catch(() => {
        if (!isActive) return;
        setAssets([]);
        setSourceUnavailable(true);
      });
    return () => {
      isActive = false;
    };
  }, [provider]);

  const isEmpty = assets.length === 0;

  /** Один набор тикеров. `duplicate` — вторая копия для бесшовного цикла. */
  const renderTrack = (duplicate: boolean) => (
    <div
      className="flex shrink-0 items-center"
      aria-hidden={duplicate ? true : undefined}
      data-testid={duplicate ? 'ticker-track-duplicate' : 'ticker-track-primary'}
    >
      {assets.map((asset) => {
        const isPositive = asset.change24h >= 0;
        return (
          <Link
            key={`${asset.symbol}-${duplicate ? 'b' : 'a'}`}
            to={`/coin/${asset.symbol}`}
            // Копия не должна создавать вторые таб-стопы.
            tabIndex={duplicate ? -1 : undefined}
            className="group flex items-center space-x-2 whitespace-nowrap rounded-md border border-transparent px-3 py-1.5 font-sans transition-all duration-150 hover:border-white/[0.06] hover:bg-white/[0.05]"
          >
            <span className="text-[12px] font-extrabold tracking-tight text-white transition-colors group-hover:text-cyan-300">
              {asset.symbol}
            </span>

            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-200">
              {formatCurrency(asset.price, { decimals: asset.price > 10 ? 2 : 4 })}
            </span>

            <span
              className={`flex items-center space-x-0.5 font-mono text-[11px] font-bold tabular-nums ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? (
                <TrendingUp className="h-3 w-3 text-emerald-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-rose-400" />
              )}
              <span>{formatPercent(asset.change24h)}</span>
            </span>

            {asset.sparkline && asset.sparkline.length > 1 && (
              <div className="hidden pl-1 opacity-75 transition-opacity group-hover:opacity-100 sm:block">
                <Sparkline data={asset.sparkline} width={42} height={15} />
              </div>
            )}

            <span aria-hidden className="pl-2 font-normal text-white/[0.08]">
              /
            </span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="w-full overflow-hidden border-b border-white/[0.06] bg-surface/95 text-xs shadow-inner backdrop-blur-md">
      <div className="flex w-full items-center">
        {/* Метка фактического источника котировок — закреплена, не прокручивается */}
        <div className="flex shrink-0 items-center space-x-2 border-r border-white/[0.08] py-1.5 pl-3.5 pr-3">
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${
                isLiveMode ? 'bg-emerald-400' : 'bg-amber-400'
              } opacity-60`}
            ></span>
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isLiveMode ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            ></span>
          </span>
          <span
            data-testid="ticker-mode-label"
            className={`font-sans text-[11px] font-semibold uppercase tracking-[0.14em] ${
              isLiveMode ? 'text-emerald-400/90' : 'text-amber-300/90'
            }`}
          >
            {isLiveMode ? 'LIVE-ТИКЕР' : 'QA-ТИКЕР'}
          </span>
        </div>

        {isEmpty ? (
          <div
            className="flex min-w-0 flex-1 items-center space-x-2 px-3.5 py-1.5 font-sans text-[11px] text-slate-400"
            data-testid="ticker-source-state"
          >
            <RadioTower className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="truncate">
              {sourceUnavailable
                ? isLiveMode
                  ? 'Фактический рыночный поток недоступен — значения не подставляются.'
                  : 'Датасет источника недоступен.'
                : 'Ожидание данных от источника…'}
            </span>
          </div>
        ) : (
          /* Viewport бегущей строки: скрывает overflow, поэтому body не растягивается. */
          <div
            className="ticker-marquee-host group relative min-w-0 flex-1 overflow-hidden select-none"
            data-testid="ticker-marquee"
          >
            <div className="ticker-marquee flex w-max items-center">
              {renderTrack(false)}
              {renderTrack(true)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
