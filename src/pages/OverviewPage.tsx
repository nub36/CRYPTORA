import React, { useEffect, useState } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import {
  MarketOverviewData,
  AssetSummary,
  OHLCV,
  Timeframe,
  FuturesAsset,
  LiquidationData,
  RadarEvent,
} from '@/types/market';
import { formatCurrency, formatPercent, formatTimestamp } from '@/utils/formatters';
import { CandleChart } from '@/components/common/CandleChart';
import { HeatmapGrid } from '@/components/common/HeatmapGrid';
import { Badge } from '@/components/common/Badge';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Activity,
  Layers,
  Flame,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Zap,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { provider, openDemoModal } = useMarketData();

  const [overview, setOverview] = useState<MarketOverviewData | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [btcCandles, setBtcCandles] = useState<OHLCV[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1h');
  const [futures, setFutures] = useState<FuturesAsset[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [ov, assts, ftrs, liqs, rdr] = await Promise.all([
          provider.getMarketOverview(),
          provider.getAssets(),
          provider.getFuturesList(),
          provider.getLiquidations(),
          provider.getRadarEvents(),
        ]);
        setOverview(ov);
        setAssets(assts);
        setFutures(ftrs);
        setLiquidations(liqs);
        setRadarEvents(rdr);

        const candles = await provider.getCandles('BTC', selectedTimeframe);
        setBtcCandles(candles);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [provider]);

  // When timeframe changes for BTC chart
  useEffect(() => {
    provider.getCandles('BTC', selectedTimeframe).then(setBtcCandles);
  }, [selectedTimeframe, provider]);

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-mono text-sm">
        <Activity className="w-5 h-5 animate-spin mr-2 text-brand-cyan" />
        Загрузка командного центра CRYPTORA...
      </div>
    );
  }

  // Top gainers and losers
  const sortedByChange = [...assets].sort((a, b) => b.change24h - a.change24h);
  const topGainers = sortedByChange.slice(0, 4);
  const topLosers = sortedByChange.slice(-4).reverse();

  // Aggregate futures stats
  const totalFuturesVolume = futures.reduce((acc, f) => acc + f.futuresVolume24h, 0);
  const totalOpenInterest = futures.reduce((acc, f) => acc + f.openInterest, 0);

  // Funding extremes
  const sortedFunding = [...futures].sort((a, b) => b.fundingRate - a.fundingRate);
  const highestFunding = sortedFunding[0];
  const lowestFunding = sortedFunding[sortedFunding.length - 1];

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Top Demo Notification Strip */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs font-mono text-amber-300 gap-2">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span>
            <strong>КОМАНДНЫЙ ЦЕНТР: ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ.</strong> Все цены, объемы, открытый интерес, ликвидации и события зафиксированы для оценки интерфейса (Этап 1).
          </span>
        </div>
        <button
          onClick={openDemoModal}
          className="text-amber-400 hover:underline flex items-center space-x-1 flex-shrink-0 text-[11px]"
        >
          <span>Ограничения этапа</span>
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* SECTION A: Market Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {/* Total Market Cap */}
        <div className="bg-surface border border-surface-border rounded-md p-3 relative overflow-hidden">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Капитализация рынка</span>
            <span
              className={`text-[10px] font-bold ${
                overview.marketCapChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
              }`}
            >
              {formatPercent(overview.marketCapChange24h)}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-white mt-1">
            {formatCurrency(overview.totalMarketCap, { compact: true })}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            24h дельта: +$64.8B
          </div>
        </div>

        {/* 24h Volume */}
        <div className="bg-surface border border-surface-border rounded-md p-3 relative overflow-hidden">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>24h Спот Объем</span>
            <span
              className={`text-[10px] font-bold ${
                overview.volumeChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
              }`}
            >
              {formatPercent(overview.volumeChange24h)}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-white mt-1">
            {formatCurrency(overview.totalVolume24h, { compact: true })}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Активность выше нормы
          </div>
        </div>

        {/* BTC Dominance */}
        <div className="bg-surface border border-surface-border rounded-md p-3">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Доминация BTC</span>
            <span className="text-[10px] text-brand-cyan font-mono font-bold">ETH: {overview.ethDominance}%</span>
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-white mt-1">
            {overview.btcDominance}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden flex">
            <div
              className="bg-brand-cyan h-full"
              style={{ width: `${overview.btcDominance}%` }}
            />
            <div
              className="bg-brand-purple h-full"
              style={{ width: `${overview.ethDominance}%` }}
            />
          </div>
        </div>

        {/* Fear & Greed Index */}
        <div className="bg-surface border border-surface-border rounded-md p-3">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Индекс жадности</span>
            <span className="text-[10px] text-amber-400 font-mono">DEMO</span>
          </div>
          <div className="flex items-baseline space-x-2 mt-1">
            <span className="text-lg sm:text-xl font-bold font-mono text-amber-400">
              {overview.fearAndGreed.value}
            </span>
            <span className="text-xs text-slate-300 font-medium">
              {overview.fearAndGreed.sentiment}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Умеренный оптимизм
          </div>
        </div>

        {/* Market Breadth */}
        <div className="bg-surface border border-surface-border rounded-md p-3">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Широта рынка (Breadth)</span>
            <span className="text-[10px] text-brand-green font-mono">80% UP</span>
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono text-white mt-1 flex items-center space-x-2">
            <span className="text-brand-green">{overview.marketBreadth.advancing}▲</span>
            <span className="text-slate-600">/</span>
            <span className="text-brand-red">{overview.marketBreadth.declining}▼</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Преобладание покупок
          </div>
        </div>

        {/* Demo Status Card */}
        <div
          onClick={openDemoModal}
          className="bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15 transition-all cursor-pointer rounded-md p-3"
        >
          <div className="text-[11px] font-mono text-amber-400 flex items-center justify-between font-bold">
            <span>РЕЖИМ СИСТЕМЫ</span>
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div className="text-sm font-bold font-mono text-amber-300 mt-1">
            Демонстрационный
          </div>
          <div className="text-[10px] text-amber-400/80 font-mono mt-0.5 hover:underline flex items-center space-x-1">
            <span>Спецификация этапа</span>
            <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* SECTION B & C: Main Chart & Futures/Liquidations Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main BTC Chart Column (7 cols) */}
        <div className="lg:col-span-7 bg-surface border border-surface-border rounded-lg p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
            <div className="flex items-center space-x-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold text-base text-white">BTC / USDT</span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                    Spot & Perp Demo
                  </span>
                </div>
                <div className="flex items-center space-x-2 mt-0.5 font-mono">
                  <span className="text-lg font-bold text-white">$64,850.25</span>
                  <span className="text-xs font-semibold text-brand-green">+3.18% 24h</span>
                </div>
              </div>
            </div>

            {/* Timeframe Selector */}
            <div className="flex items-center space-x-1 font-mono text-xs bg-surface-elevated p-1 rounded border border-surface-border self-start sm:self-auto">
              {(['15m', '1h', '4h', '1D', '1W'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-2 py-1 rounded transition-colors ${
                    selectedTimeframe === tf
                      ? 'bg-brand-cyan text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Candle Chart */}
          <CandleChart data={btcCandles} symbol="BTC/USDT" height={320} />

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
            <div className="flex items-center space-x-3">
              <span>SMA20: <strong className="text-slate-200">$63,877</strong></span>
              <span>SMA50: <strong className="text-slate-200">$62,386</strong></span>
              <span>RSI-14: <strong className="text-brand-green">68.4</strong></span>
            </div>
            <Link
              to="/coin/BTC"
              className="text-brand-sky hover:underline flex items-center space-x-1"
            >
              <span>Полный анализ BTC</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Snapshot Panels Column (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Futures Snapshot */}
          <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-surface-border">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-brand-purple" />
                <span className="font-bold text-sm text-white font-mono">
                  ФЬЮЧЕРСНЫЙ СРЕЗ (DERIVATIVES)
                </span>
              </div>
              <Link
                to="/futures"
                className="text-xs text-brand-sky hover:underline flex items-center space-x-1 font-mono"
              >
                <span>Все деривативы</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-surface-elevated/70 p-2.5 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400 font-mono">Агрегированный OI</div>
                <div className="text-base font-bold text-white font-mono mt-0.5">
                  {formatCurrency(totalOpenInterest, { compact: true })}
                </div>
                <div className="text-[10px] text-brand-green font-mono mt-0.5">+6.8% за 24h</div>
              </div>

              <div className="bg-surface-elevated/70 p-2.5 rounded border border-surface-border">
                <div className="text-[11px] text-slate-400 font-mono">Суточный объем Perp</div>
                <div className="text-base font-bold text-white font-mono mt-0.5">
                  {formatCurrency(totalFuturesVolume, { compact: true })}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Базис BTC: +0.048%</div>
              </div>
            </div>

            {/* Key Futures Assets snippet */}
            <div className="space-y-1.5 font-mono text-xs">
              {futures.slice(0, 3).map((f) => (
                <div
                  key={f.symbol}
                  className="flex items-center justify-between p-1.5 rounded bg-surface-elevated/40 hover:bg-surface-hover"
                >
                  <span className="font-bold text-slate-200">{f.symbol}</span>
                  <span className="text-slate-400">
                    OI: {formatCurrency(f.openInterest, { compact: true })}
                  </span>
                  <span
                    className={`font-semibold ${
                      f.fundingRate >= 0 ? 'text-brand-green' : 'text-brand-red'
                    }`}
                  >
                    F: {(f.fundingRate).toFixed(4)}%
                  </span>
                  <span
                    className={`text-[11px] ${
                      f.openInterestChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                    }`}
                  >
                    {formatPercent(f.openInterestChange24h)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Liquidations Snapshot */}
          <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-surface-border">
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-brand-red" />
                <span className="font-bold text-sm text-white font-mono">
                  ЛИКВИДАЦИИ ЗА 24H
                </span>
              </div>
              <Link
                to="/liquidations"
                className="text-xs text-brand-sky hover:underline flex items-center space-x-1 font-mono"
              >
                <span>Детализация</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {liquidations && (
              <div>
                <div className="flex items-center justify-between mb-2 font-mono text-xs">
                  <span className="text-brand-green font-semibold">
                    Longs: {formatCurrency(liquidations.totalLong24h, { compact: true })} (25.4%)
                  </span>
                  <span className="text-brand-red font-semibold">
                    Shorts: {formatCurrency(liquidations.totalShort24h, { compact: true })} (74.6%)
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-800 mb-3">
                  <div
                    className="bg-brand-green h-full"
                    style={{
                      width: `${(liquidations.totalLong24h / liquidations.total24h) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-brand-red h-full"
                    style={{
                      width: `${(liquidations.totalShort24h / liquidations.total24h) * 100}%`,
                    }}
                  />
                </div>

                {/* Largest Whale Event */}
                <div className="p-2.5 rounded bg-rose-950/30 border border-rose-500/20 text-xs font-mono flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span className="text-slate-300">
                      Whale Short Liq: <strong className="text-white">{liquidations.largestEvent.symbol}</strong>
                    </span>
                  </div>
                  <span className="font-bold text-rose-400">
                    {formatCurrency(liquidations.largestEvent.amountUsd, { compact: true })}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION C: Heatmap Grid Preview */}
      <HeatmapGrid assets={assets} limit={18} compact={true} />

      {/* SECTION D: Radar Feed, Top Movers, Signals Demo */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Column 1: Market Radar Stream */}
        <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4 flex flex-col">
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-surface-border">
            <div className="flex items-center space-x-2">
              <Radio className="w-4 h-4 text-brand-cyan animate-pulse" />
              <span className="font-bold text-sm text-white font-mono">
                MARKET RADAR (LATEST)
              </span>
            </div>
            <Link
              to="/radar"
              className="text-xs text-brand-sky hover:underline flex items-center space-x-1 font-mono"
            >
              <span>Все события</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-2.5 flex-1 overflow-y-auto max-h-96 pr-1 font-sans">
            {radarEvents.slice(0, 4).map((event) => (
              <div
                key={event.id}
                className="p-2.5 rounded bg-surface-elevated/70 border border-surface-border text-xs space-y-1 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between font-mono">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{event.symbol}</span>
                    <Badge
                      variant={
                        event.severity === 'HIGH'
                          ? 'red'
                          : event.severity === 'MEDIUM'
                          ? 'amber'
                          : 'cyan'
                      }
                      size="xs"
                    >
                      {event.type.replace('_', ' ')}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                <div className="font-mono text-[11px] font-semibold text-brand-cyan">
                  {event.metricValue}
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">
                  {event.observation}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Top Movers & Funding Extremes */}
        <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-surface-border">
              <span className="font-bold text-xs text-white font-mono uppercase tracking-wider flex items-center space-x-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-brand-green" />
                <span>Лидеры роста (24h)</span>
              </span>
              <Link to="/market" className="text-[11px] text-brand-sky hover:underline font-mono">
                Рынок →
              </Link>
            </div>

            <div className="space-y-1.5 font-mono text-xs">
              {topGainers.map((asset) => (
                <Link
                  key={asset.id}
                  to={`/coin/${asset.symbol}`}
                  className="flex items-center justify-between p-1.5 rounded hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{asset.symbol}</span>
                    <span className="text-slate-400 text-[11px]">{asset.name}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-slate-300">{formatCurrency(asset.price)}</span>
                    <span className="font-semibold text-brand-green flex items-center">
                      <ArrowUpRight className="w-3 h-3 mr-0.5" />
                      {formatPercent(asset.change24h)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-surface-border">
              <span className="font-bold text-xs text-white font-mono uppercase tracking-wider flex items-center space-x-1.5">
                <ArrowDownRight className="w-3.5 h-3.5 text-brand-red" />
                <span>Лидеры снижения (24h)</span>
              </span>
            </div>

            <div className="space-y-1.5 font-mono text-xs">
              {topLosers.map((asset) => (
                <Link
                  key={asset.id}
                  to={`/coin/${asset.symbol}`}
                  className="flex items-center justify-between p-1.5 rounded hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{asset.symbol}</span>
                    <span className="text-slate-400 text-[11px]">{asset.name}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-slate-300">{formatCurrency(asset.price)}</span>
                    <span className="font-semibold text-brand-red flex items-center">
                      <ArrowDownRight className="w-3 h-3 mr-0.5" />
                      {formatPercent(asset.change24h)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Funding Extremes widget */}
          {highestFunding && lowestFunding && (
            <div className="pt-2 border-t border-surface-border grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-emerald-950/30 border border-emerald-500/20 p-2 rounded">
                <div className="text-[10px] text-emerald-400">Макс фандинг:</div>
                <div className="font-bold text-white">{highestFunding.symbol}</div>
                <div className="text-emerald-300 font-semibold">+{(highestFunding.fundingRate).toFixed(4)}%</div>
              </div>
              <div className="bg-purple-950/30 border border-purple-500/20 p-2 rounded">
                <div className="text-[10px] text-purple-400">Мин фандинг (Shorts):</div>
                <div className="font-bold text-white">{lowestFunding.symbol}</div>
                <div className="text-purple-300 font-semibold">{(lowestFunding.fundingRate).toFixed(4)}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Signals Architecture Preview (NOT fake signals!) */}
        <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-surface-border">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-brand-amber" />
                <span className="font-bold text-sm text-white font-mono">
                  АНАЛИТИЧЕСКИЕ СЕТАПЫ (PREVIEW)
                </span>
              </div>
              <Badge variant="amber" size="xs">
                ПРОТОТИП
              </Badge>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs space-y-2 mb-3">
              <div className="font-bold text-amber-300 flex items-center space-x-1.5">
                <span>Демонстрация будущей методологии</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                CRYPTORA не публикует слепые кнопки «BUY/SELL». Сетапы будут создаваться строго алгоритмическим движком с открытыми аргументами, точным уровнем инвалидации и неизменяемым журналом аудита.
              </p>
            </div>

            {/* Structured Setup Mock Card */}
            <div className="p-3 bg-surface-elevated/80 border border-surface-border rounded-md text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">BTC/USDT 4H Breakout</span>
                <span className="text-[10px] text-brand-green bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-500/30 font-semibold">
                  LONG SETUP DEMO
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                <div>Вход: <strong className="text-white">$64,200 – $64,800</strong></div>
                <div>Инвалидация: <strong className="text-rose-400">&lt; $62,900</strong></div>
              </div>

              <div className="text-[11px] text-slate-400 space-y-1 pt-1 border-t border-surface-border">
                <div className="text-emerald-400 text-[10px]">✓ Подтверждение: OI Surge +7.2%, Funding &gt; 0</div>
                <div className="text-rose-400 text-[10px]">⚠ Опровергающие: RSI-14 перегрет (68.4)</div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-surface-border mt-3">
            <Link
              to="/signals"
              className="w-full py-2 bg-surface-elevated hover:bg-surface-hover text-brand-cyan text-xs font-mono font-semibold rounded flex items-center justify-center space-x-1.5 transition-colors border border-surface-border"
            >
              <span>Спецификация сигналов и бэктестинга</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
