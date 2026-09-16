import React, { useState, useEffect } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetSummary } from '@/types/market';
import { HeatmapGrid } from '@/components/common/HeatmapGrid';
import { Grid3X3, Info } from 'lucide-react';

export const HeatmapsPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);

  useEffect(() => {
    provider.getAssets().then(setAssets);
  }, [provider]);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Grid3X3 className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              ТЕПЛОВАЯ КАРТА РЫНКА (MARKET HEATMAP)
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[10px] font-mono font-semibold text-brand-green bg-brand-green/10 px-2 py-0.5 rounded border border-brand-green/30">
                LIVE TILES (BINANCE / KUCOIN)
              </span>
            ) : (
              <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                ДЕМОНСТРАЦИОННАЯ СЕТКА
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Визуальная оценка доходностей, концентрации объемов и ставок фандинга в реальном времени.'
              : 'Демонстрационная визуальная оценка доходностей, концентрации объемов и ставок фандинга.'}
          </p>
        </div>
      </div>

      {/* Full Heatmap Component */}
      <HeatmapGrid assets={assets} limit={30} compact={false} />

      {/* Explanatory Guide Box */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-mono font-bold">
          <Info className="w-4 h-4 text-brand-cyan" />
          <span>Как интерпретировать тепловые карты CRYPTORA</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1 text-[11px] text-slate-400">
          <div>
            <strong className="text-white block mb-0.5 font-mono">24h Price Change:</strong>
            Зеленые плитки отражают положительный суточный импульс, красные — коррекцию. Чем темнее/насыщеннее тон, тем ближе показатель к экстремуму.
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">Trading Volume:</strong>
            Показывает распределение совокупного торгового капитала. Крупнейшие объемы сосредоточены в BTC, ETH и SOL.
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">Open Interest:</strong>
            Отражает концентрацию позиций с кредитным плечом в бессрочных деривативах. Рост открытого интереса сигнализирует о готовящемся импульсе.
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">Funding Rate:</strong>
            Пурпурные плитки показывают отрицательный фандинг (шортисты платят лонгистам), желтые — перегретый длинный рынок.
          </div>
        </div>
      </div>
    </div>
  );
};
