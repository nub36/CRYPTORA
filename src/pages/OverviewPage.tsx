import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import {
  MarketOverviewData,
  AssetSummary,
  OHLCV,
  Timeframe,
  FuturesAsset,
  LiquidationData,
  RadarEvent,
} from '@/types/market';
import { formatDuration, formatCurrency, formatPercent } from '@/utils/formatters';
import { CandleChart } from '@/components/common/CandleChart';
import type { ChartIndicatorData } from '@/components/common/CandleChart';
import { HeatmapGrid } from '@/components/common/HeatmapGrid';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { MarketRadarPreview } from '@/components/market/MarketRadarPreview';
import { AnalyticsSetupsPreview } from '@/components/market/AnalyticsSetupsPreview';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { mergeRadarEvents } from '@/services/realtime/radarEventFeed';
import { Link } from 'react-router-dom';
import { SponsorSlot } from '@/components/ads/SponsorSlot';
import { Collapsible } from '@/components/common/Collapsible';
import {
  TrendingUp,
  Activity,
  Layers,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  Grid,
  Network,
  Calendar,
  BookOpen,
} from 'lucide-react';

const FEAR_GREED_RU: Record<string, string> = {
  'Extreme Fear': 'Экстремальный страх',
  Fear: 'Страх',
  Neutral: 'Нейтрально',
  Greed: 'Жадность',
  'Extreme Greed': 'Экстремальная жадность',
};
const fearGreedLabelRu = (s: string): string => FEAR_GREED_RU[s] ?? s;

/** Чип 24h-дельты; null — «база отсутствует», без подстановки числа. */
const DeltaChip: React.FC<{ value: number | null; qa: string; title: string }> = ({ value, qa, title }) =>
  value === null ? (
    <span data-qa={qa} data-state="unavailable" title={title} className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded text-slate-500 border border-white/[0.12]">
      Δ24ч —
    </span>
  ) : (
    <span
      data-qa={qa}
      data-state="actual"
      title={title}
      className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded font-mono ${value >= 0 ? 'text-emerald-400 bg-emerald-950/40' : 'text-rose-400 bg-rose-950/40'}`}
    >
      {formatPercent(value)}
    </span>
  );

export const OverviewPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();

  const [overview, setOverview] = useState<MarketOverviewData | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [btcCandles, setBtcCandles] = useState<OHLCV[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1h');
  const [futures, setFutures] = useState<FuturesAsset[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [radarUnavailable, setRadarUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  // Б1: Обзор обновляется сам. silent-режим (автоцикл) не мигает спиннером,
  // но честно выставляет sourceUnavailable при отказе источника. Свечи BTC
  // грузит отдельный эффект по timeframe (ниже) — здесь они не нужны.
  const OVERVIEW_REFRESH_MS = 30_000;

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setSourceUnavailable(false);
      try {
        const [ov, assts] = await Promise.all([provider.getMarketOverview(), provider.getAssets()]);
        // Вспомогательные блоки: отказ источника деривативов не должен прятать Обзор целиком;
        // демо-значения вместо фактических не подставляются — блок остаётся пустым.
        const [ftrsR, liqsR, rdrR] = await Promise.allSettled([
          provider.getFuturesList(),
          provider.getLiquidations(),
          provider.getRadarEvents(),
        ]);
        setOverview(ov);
        setAssets(assts);
        setFutures(ftrsR.status === 'fulfilled' ? ftrsR.value : []);
        if (liqsR.status === 'fulfilled') setLiquidations(liqsR.value);
        const radarSnapshot = rdrR.status === 'fulfilled' ? rdrR.value : [];
        setRadarEvents((current) => mergeRadarEvents(current, radarSnapshot, { includeDemo: dataMode === 'demo' }));
        setRadarUnavailable(rdrR.status === 'rejected');
      } catch {
        // LIVE-FIRST: источник не ответил — показываем честное состояние,
        // значения из другого датасета вместо фактических не подставляются.
        setSourceUnavailable(true);
      } finally {
        setLoading(false);
      }
    },
    [provider, dataMode]
  );

  // Provider snapshot is the REST-like fallback; this subscription catches
  // fresh real anomalies immediately instead of waiting for the 30s overview poll.
  useEffect(() => {
    if (dataMode !== 'live') return;
    const feed = RealtimeFeedManager.getInstance();
    const unsubscribe = feed.eventBus.subscribe<RadarEvent>('radar', (event) => {
      if (event.isDemo) return;
      setRadarEvents((current) => mergeRadarEvents(current, [event]));
      setRadarUnavailable(false);
    });
    return unsubscribe;
  }, [dataMode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Автоцикл: 30с (провайдер кэширует списки 10с — цикл почти не создаёт запросов);
  // пауза в фоновой вкладке, внеочередной рефреш при возврате видимости/сети.
  useAutoRefresh(() => loadData(true), OVERVIEW_REFRESH_MS, { skipImmediate: true });

  // When timeframe changes for BTC chart
  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    setBtcCandles([]);
    const loadCandles = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const candles = await provider.getCandles('BTC', selectedTimeframe);
        if (active) setBtcCandles(candles);
      } catch {
        if (active) setBtcCandles([]);
      } finally {
        requestInFlight = false;
      }
    };
    void loadCandles();
    const timer = window.setInterval(() => void loadCandles(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedTimeframe, provider]);

  // Chart indicator overlays for BTC chart — MUST be before early returns (hooks rule)
  const btcChartIndicators = useMemo<ChartIndicatorData | undefined>(() => {
    if (btcCandles.length < 20) return undefined;
    const closes = btcCandles.map((c) => c.close);
    const pad = (series: number[], offset: number): number[] => {
      const padded = new Array<number>(offset).fill(NaN);
      return padded.concat(series);
    };
    const sma20 = IndicatorEngine.calculateSMA(closes, 20);
    const sma50 = IndicatorEngine.calculateSMA(closes, 50);
    return {
      sma20: pad(sma20, closes.length - sma20.length),
      sma50: btcCandles.length >= 50 ? pad(sma50, closes.length - sma50.length) : undefined,
    };
  }, [btcCandles]);

  if (!loading && sourceUnavailable && !overview) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <DataSourceUnavailable subject="рыночная сводка командного центра" />
      </div>
    );
  }

  if (loading || !overview) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] text-slate-400 font-sans text-sm space-y-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
          <Activity className="w-5 h-5 text-cyan-400 absolute inset-0 m-auto" />
        </div>
        <span className="text-slate-300 tracking-wide text-xs">
          Загрузка командного центра CRYPTORA...
        </span>
      </div>
    );
  }

  // Top gainers and losers
  const sortedByChange = [...assets].sort((a, b) => b.change24h - a.change24h);
  const topGainers = sortedByChange.slice(0, 4);
  const topLosers = sortedByChange.slice(-4).reverse();

  // LIVE-FIRST: значения карточки BTC берутся из фактических данных, без подстановки демо-чисел
  const btcAsset = assets.find((a) => a.symbol === 'BTC');
  const btcIndicators = btcCandles.length > 0 ? IndicatorEngine.computeCompleteIndicators(btcCandles) : null;

  const btcPriceFromTicker = Boolean(btcAsset && Number.isFinite(btcAsset.price) && btcAsset.price > 0);
  const btcPrice =
    btcPriceFromTicker && btcAsset
      ? btcAsset.price
      : btcCandles.length > 0
        ? btcCandles[btcCandles.length - 1].close
        : null;
  const btcPriceSource = dataMode === 'demo'
    ? 'DemoMarketDataProvider · явный QA fixture'
    : btcPriceFromTicker && btcAsset?.provenance?.exchange === 'binance'
      ? 'Binance Spot /api/v3/ticker/24hr через getAssets()'
      : btcPriceFromTicker && btcAsset?.provenance?.exchange === 'kucoin'
        ? 'KuCoin /api/v1/market/stats через getAssets()'
        : btcPriceFromTicker
          ? 'MarketDataProvider.getAssets() · provenance источника не указан'
          : btcCandles.length > 0
            ? `${btcCandles[btcCandles.length - 1].provenance?.exchange?.toUpperCase() ?? 'Exchange'} ${selectedTimeframe} OHLCV · close`
            : null;
  const btcFutures = futures.find((f) => f.symbol.split('/')[0].toUpperCase() === 'BTC');
  const btcOpenInterestUsd = typeof btcFutures?.openInterest === 'number' && Number.isFinite(btcFutures.openInterest)
    ? btcFutures.openInterest
    : null;
  const btcOpenInterestSource = !btcFutures
    ? null
    : dataMode === 'demo' || btcFutures.isDemo
      ? 'DemoMarketDataProvider · QA fixture'
      : btcOpenInterestUsd == null
        ? 'OI недоступен: /fapi/v1/openInterest и исторический fallback без ответа'
        : 'Binance USD-M /fapi/v1/openInterest × markPrice; fallback latest /futures/data/openInterestHist value';
  const btcOpenInterestDelta = btcFutures?.openInterestChangeSource === 'ACTUAL'
    ? btcFutures.openInterestChange24h
    : null;
  const btcOpenInterestDeltaSource = btcFutures?.openInterestChangeSource === 'ACTUAL'
    ? 'Binance /futures/data/openInterestHist · hourly series'
    : null;
  const btcFundingSource = !btcFutures
    ? null
    : dataMode === 'demo' || btcFutures.isDemo
      ? 'DemoMarketDataProvider · QA fixture'
      : 'Binance USD-M /fapi/v1/premiumIndex · lastFundingRate × 100 (% per 8h)';
  const btcRsi14 = btcCandles.length >= 15 ? btcIndicators?.rsi14 ?? null : null;
  const btcRsiSource = btcRsi14 == null
    ? null
    : `${btcCandles[0]?.provenance?.exchange?.toUpperCase() ?? (dataMode === 'demo' ? 'QA' : 'Exchange')} ${selectedTimeframe} closes · Wilder RSI-14`;
  const btcChange24h = btcAsset && Number.isFinite(btcAsset.change24h) ? btcAsset.change24h : null;

  // Aggregate futures stats
  const totalFuturesVolume = futures.reduce((acc, f) => acc + f.futuresVolume24h, 0);
  // null-OI (источник не ответил) в сумму не входит — суммируем только фактические значения
  const totalOpenInterest = futures.reduce((acc, f) => acc + (f.openInterest ?? 0), 0);

  // Funding extremes
  const sortedFunding = [...futures].sort((a, b) => b.fundingRate - a.fundingRate);
  const highestFunding = sortedFunding[0];
  const lowestFunding = sortedFunding[sortedFunding.length - 1];

  return (
    <div className="route-shell space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5" data-route="overview" data-layout="state-first">
      <TerminalSection label="MARKET PULSE" title="Regime at a glance" className="overview-pulse">
      {/* SECTION A: Market Summary Cards */}
      <div
        data-testid="overview-kpi-grid"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3"
      >
        {/* Total Market Cap */}
        <div className="bg-surface border border-white/[0.08] hover:border-cyan-500/30 rounded-xl p-3.5 relative overflow-hidden transition-all duration-200 shadow-panel group">
          <div className="text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="tracking-wide">{overview.globalMarketCapUsd != null ? 'Капитализация крипторынка' : 'Капитализация каталога'}</span>
            <DeltaChip value={overview.globalMarketCapChange24hPct ?? overview.marketCapChange24h} qa="mcap-delta" title={overview.globalMarketCapChange24hPct != null ? 'Фактическое значение CoinGecko (весь крипторынок)' : 'Производная из 24h-изменения цены каталога активов'} />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1.5 tabular-nums tracking-tight">
            {overview.globalMarketCapUsd != null
              ? formatCurrency(overview.globalMarketCapUsd, { compact: true })
              : formatCurrency(overview.totalMarketCap, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 font-sans mt-1">
            {overview.globalMarketCapUsd != null
              ? `CoinGecko · ${new Date(overview.globalMarketCapUpdatedAt ?? 0).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
              : dataMode === 'live'
                ? 'Сумма по каталогу активов; CoinGecko недоступен'
                : 'Капитализация QA-датасета'}
          </div>
        </div>

        {/* 24h Volume */}
        <div className="bg-surface border border-white/[0.08] hover:border-cyan-500/30 rounded-xl p-3.5 relative overflow-hidden transition-all duration-200 shadow-panel group">
          <div className="text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="tracking-wide">24h Спот Объем</span>
            <DeltaChip value={overview.volumeChange24h} qa="volume-delta" title="Против собственного снимка объёма ≥24ч давности (накапливается в этом браузере)" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1.5 tabular-nums tracking-tight">
            {formatCurrency(overview.totalVolume24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 font-sans mt-1">
            {dataMode !== 'live'
              ? 'Суммарный объём QA-датасета'
              : overview.volumeChange24h === null
                ? 'Δ24ч появится после 24ч наблюдений в этом браузере'
                : 'Суммарный объём доступных источников'}
          </div>
        </div>

        {/* BTC Dominance */}
        <div className="bg-surface border border-white/[0.08] hover:border-cyan-500/30 rounded-xl p-3.5 transition-all duration-200 shadow-panel group">
          <div className="text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="tracking-wide">
              {overview.globalBtcDominancePct != null ? 'Доминация BTC (CoinGecko)' : 'Доминация BTC (каталог)'}
            </span>
            <span className="text-[11px] text-cyan-300 font-mono font-bold">
              ETH: {(overview.globalEthDominancePct ?? overview.ethDominance)}%
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1.5 tabular-nums tracking-tight">
            {(overview.globalBtcDominancePct ?? overview.btcDominance)}%
          </div>
          <div className="w-full bg-surface-elevated h-1.5 rounded-full mt-2.5 overflow-hidden flex">
            <div
              className="bg-cyan-400 h-full"
              style={{ width: `${overview.globalBtcDominancePct ?? overview.btcDominance}%` }}
            />
            <div
              className="bg-violet-500 h-full"
              style={{ width: `${overview.globalEthDominancePct ?? overview.ethDominance}%` }}
            />
          </div>
        </div>

        {/* Fear & Greed Index */}
        <div
          data-qa="fear-greed-card"
          data-source={overview.fearAndGreed?.source ?? 'unavailable'}
          className="bg-surface border border-white/[0.08] hover:border-amber-500/30 rounded-xl p-3.5 transition-all duration-200 shadow-panel group"
        >
          <div className="text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="tracking-wide">Индекс страха и жадности</span>
            {overview.fearAndGreed?.source === 'alternative.me' ? (
              <span
                title={`Alternative.me Crypto Fear & Greed Index · рассчитан ${new Date(overview.fearAndGreed.timestamp ?? 0).toLocaleString('ru-RU')}`}
                className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded text-emerald-300 bg-emerald-500/10 border border-emerald-500/30"
              >
                LIVE · ALTERNATIVE.ME
              </span>
            ) : overview.fearAndGreed ? (
              <span className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded text-amber-300 bg-amber-500/15">QA</span>
            ) : (
              <span
                title="Внешний источник индекса (Alternative.me) не ответил — значение не подставляется"
                className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded text-slate-400 bg-white/[0.06] border border-white/[0.12]"
              >
                НЕДОСТУПЕН
              </span>
            )}
          </div>
          {overview.fearAndGreed ? (
            <>
              <div className="flex items-baseline space-x-2 mt-1.5">
                <span className="text-xl sm:text-2xl font-bold font-mono text-amber-400 tabular-nums">{overview.fearAndGreed.value}</span>
                <span className="text-xs text-slate-300 font-medium">{fearGreedLabelRu(overview.fearAndGreed.sentiment)}</span>
              </div>
              <div className="text-[11px] text-slate-400 font-sans mt-1">Шкала 0–100 · обновляется источником раз в сутки</div>
            </>
          ) : (
            <>
              <div className="text-xl sm:text-2xl font-bold font-mono text-slate-500 mt-1.5 tabular-nums">—</div>
              <div className="text-[11px] text-slate-400 font-sans mt-1">Источник индекса не ответил</div>
            </>
          )}
        </div>

        {/* Market Breadth */}
        <div className="bg-surface border border-white/[0.08] hover:border-cyan-500/30 rounded-xl p-3.5 transition-all duration-200 shadow-panel group">
          <div className="text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="tracking-wide">Широта рынка</span>
            <span className="text-[11px] text-emerald-400 font-mono font-semibold">
              {overview.marketBreadth.advancing + overview.marketBreadth.declining > 0
                ? `${Math.round((overview.marketBreadth.advancing / (overview.marketBreadth.advancing + overview.marketBreadth.declining)) * 100)}% РОСТ`
                : '—'}
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1.5 flex items-center space-x-2 tabular-nums">
            <span className="text-emerald-400">{overview.marketBreadth.advancing}▲</span>
            <span aria-hidden className="text-slate-500">/</span>
            <span className="text-rose-400">{overview.marketBreadth.declining}▼</span>
          </div>
          <div className="text-[11px] text-slate-400 font-sans mt-1">
            Преобладание покупок
          </div>
        </div>



      </div>
      </TerminalSection>

      <TerminalSection label="PRIMARY MARKET STATE" title="BTC command view" className="overview-command">
      {/* SECTION B & C: Main Chart & Futures/Liquidations Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main BTC Chart Column (7 cols) - The Command Center Focal Point */}
        <div className="lg:col-span-7 bg-surface border border-white/[0.08] rounded-xl p-3 sm:p-4 space-y-3.5 shadow-panel relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.06] gap-2">
            <div className="flex items-center space-x-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold text-lg text-white">BTC / USDT</span>
                  <span
                    className={`text-xs bg-surface-elevated px-2 py-0.5 rounded-full font-mono border font-semibold ${
                      dataMode === 'live'
                        ? 'text-brand-green border-brand-green/30'
                        : 'text-cyan-300 border-cyan-500/30'
                    }`}
                  >
                    {dataMode === 'live'
                      ? `LIVE СПОТ${btcAsset?.provenance?.exchange ? `: ${btcAsset.provenance.exchange.toUpperCase()}` : ' · BINANCE / KUCOIN'}`
                      : 'QA-датасет · только Spot (без Futures)'}
                  </span>
                </div>
                <div className="flex items-center space-x-2 mt-0.5 font-sans">
                  <span className="text-xl font-bold text-white tabular-nums font-mono">
                    {btcPrice !== null ? formatCurrency(btcPrice) : 'НЕТ ДАННЫХ'}
                  </span>
                  {btcChange24h !== null ? (
                    <span
                      className={`text-xs font-semibold tabular-nums  font-mono${
                        btcChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatPercent(btcChange24h)} 24h
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-500">24h: НЕТ ДАННЫХ</span>
                  )}
                </div>
              </div>
            </div>

            {/* Timeframe Selector Buttons */}
            <div className="flex items-center space-x-1 font-sans text-xs bg-surface-elevated p-1 rounded-lg border border-white/[0.06] self-start sm:self-auto">
              {(['5m', '15m', '30m', '1h', '4h', '1D', '1W'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-3 py-1 rounded-md transition-all font-semibold min-h-[28px] ${
                    selectedTimeframe === tf
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Candle Chart with ambient glow */}
          <CandleChart data={btcCandles} symbol="BTC/USDT" height={340} indicators={btcChartIndicators} />

          <div className="flex items-center justify-between text-[11px] font-sans text-slate-400 pt-1 border-t border-white/[0.04]">
            <div className="flex items-center space-x-3">
              <span>
                SMA20:{' '}
                <strong className="text-slate-200 tabular-nums font-mono">
                  {btcIndicators ? formatCurrency(btcIndicators.sma20, { decimals: 0 }) : '—'}
                </strong>
              </span>
              <span>
                SMA50:{' '}
                <strong className="text-slate-200 tabular-nums font-mono">
                  {btcIndicators ? formatCurrency(btcIndicators.sma50, { decimals: 0 }) : '—'}
                </strong>
              </span>
              <span>
                RSI-14:{' '}
                <strong className="text-emerald-400 tabular-nums font-mono">
                  {btcIndicators && Number.isFinite(btcIndicators.rsi14) ? btcIndicators.rsi14.toFixed(1) : '—'}
                </strong>
              </span>
            </div>
            <Link
              to="/coin/BTC"
              className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center space-x-1 font-semibold"
            >
              <span>Полный анализ BTC</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Snapshot Panels Column (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Futures Snapshot */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 shadow-panel">
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-violet-400" />
                <span className="font-bold text-sm text-white font-sans tracking-wide">
                  Фьючерсный срез
                </span>
              </div>
              <Link
                to="/futures"
                className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center space-x-1 font-sans font-medium"
              >
                <span>Все деривативы</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-surface-elevated p-3 rounded-lg border border-white/[0.06]">
                <div className="text-[11px] text-slate-400 font-sans">Агрегированный OI</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5 tabular-nums">
                  {formatCurrency(totalOpenInterest, { compact: true })}
                </div>
                {(() => {
                  // DERIVED: взвешенный Δ OI 24ч по фьючерсам с ACTUAL-источником
                  const actualOi = futures.filter((f) => f.openInterestChangeSource === 'ACTUAL' && f.openInterest != null && f.openInterest > 0 && f.openInterestChange24h != null);
                  if (actualOi.length === 0) {
                    return <div className="ui-helper mt-0.5">Δ24ч — нет фактических данных OI</div>;
                  }
                  const weightedChange = actualOi.reduce((s, f) => s + f.openInterestChange24h! * (f.openInterest ?? 0), 0)
                    / actualOi.reduce((s, f) => s + (f.openInterest ?? 0), 0);
                  return (
                    <div className={`text-[11px] font-mono mt-0.5 font-semibold ${weightedChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatPercent(weightedChange)} за 24h
                      <span className="text-slate-500 font-normal"> · ACTUAL</span>
                    </div>
                  );
                })()}
              </div>

              <div className="bg-surface-elevated p-3 rounded-lg border border-white/[0.06]">
                <div className="text-[11px] text-slate-400 font-sans">Суточный объём Futures</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5 tabular-nums">
                  {formatCurrency(totalFuturesVolume, { compact: true })}
                </div>
                {(() => {
                  // DERIVED: фактический BTC basis из среза деривативов
                  const btcFut = futures.find((f) => f.symbol.split('/')[0].toUpperCase() === 'BTC');
                  if (!btcFut) return <div className="ui-helper mt-0.5">Базис BTC — нет данных</div>;
                  return (
                    <div className={`text-[11px] font-mono mt-0.5 ${btcFut.basisPct >= 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                      Базис BTC: {btcFut.basisPct >= 0 ? '+' : ''}{btcFut.basisPct.toFixed(3)}%
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Key Futures Assets snippet */}
            <div className="space-y-1.5 font-sans text-xs">
              {futures.slice(0, 3).map((f) => (
                <div
                  key={f.symbol}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/80 hover:bg-surface-hover transition-colors border border-white/[0.04]"
                >
                  <span className="font-bold text-white">{f.symbol}</span>
                  <span className="text-slate-300 tabular-nums font-mono">
                    OI: {f.openInterest != null ? formatCurrency(f.openInterest, { compact: true }) : '—'}
                  </span>
                  <span
                    className={`font-semibold tabular-nums  font-mono${
                      f.fundingRate >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    F: {f.fundingRate.toFixed(4)}%
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums font-mono ${
                      f.openInterestChange24h == null ? 'text-slate-500' : f.openInterestChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {f.openInterestChange24h != null ? formatPercent(f.openInterestChange24h) : '—'}
                    <OiDeltaBadge source={f.openInterestChangeSource} />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Liquidations Snapshot */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 shadow-panel">
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-rose-400" />
                {/*
                  Единый источник с /liquidations (§51): и заголовок, и суммы берутся
                  из того же `getLiquidationSnapshot()`. «24ч» показывается только
                  когда окно наблюдения действительно покрыто — иначе честная
                  подпись периода (§31, §50, §55).
                */}
                <span className="font-bold text-sm text-white font-sans tracking-wide" data-qa="overview-liq-title">
                  {liquidations?.hasFullObservationWindow
                    ? 'Ликвидации · 24ч'
                    : liquidations && liquidations.observationDurationMs > 0
                      ? 'Ликвидации · с момента подключения'
                      : 'Ликвидации'}
                </span>
              </div>
              <Link
                to="/liquidations"
                className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center space-x-1 font-sans font-medium"
              >
                <span>Детализация</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {liquidations && (
              <div>
                {liquidations.total24h > 0 ? (
                  <>
                    {/* Total + фактический период наблюдения (§51) */}
                    <div className="flex items-center justify-between mb-1.5 text-[11px] font-sans" data-qa="overview-liq-total">
                      <span className="text-white font-bold font-mono tabular-nums">
                        Всего: {formatCurrency(liquidations.total24h, { compact: true })}
                      </span>
                      <span className="text-slate-500 font-mono tabular-nums">
                        {liquidations.eventsCount24h} событий ·{' '}
                        {liquidations.hasFullObservationWindow
                          ? '24ч'
                          : liquidations.observationDurationMs > 0
                            ? formatDuration(liquidations.observationDurationMs)
                            : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2 font-mono text-xs">
                      <span className="text-emerald-400 font-semibold tabular-nums font-mono">
                        Long: {formatCurrency(liquidations.totalLong24h, { compact: true })} (
                        {((liquidations.totalLong24h / liquidations.total24h) * 100).toFixed(1)}%)
                      </span>
                      <span className="text-rose-400 font-semibold tabular-nums font-mono">
                        Short: {formatCurrency(liquidations.totalShort24h, { compact: true })} (
                        {((liquidations.totalShort24h / liquidations.total24h) * 100).toFixed(1)}%)
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 rounded-full overflow-hidden flex bg-surface-elevated mb-3">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{
                          width: `${(liquidations.totalLong24h / liquidations.total24h) * 100}%`,
                        }}
                      />
                      <div
                        className="bg-rose-500 h-full"
                        style={{
                          width: `${(liquidations.totalShort24h / liquidations.total24h) * 100}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-400 font-sans mb-3 leading-relaxed">
                    {liquidations.dataStatus === 'AWAITING_STREAM'
                      ? 'Поток фактических ликвидаций подключен, события ещё не поступали. Оценочные суммы не подставляются.'
                      : 'Фактический поток ликвидаций недоступен — агрегаты не отображаются.'}
                  </div>
                )}

                {/* Largest Whale Event */}
                {liquidations.largestEvent && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs font-sans flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
                      <span className="text-slate-300">
                        Крупная ликвидация {liquidations.largestEvent.side === 'SHORT' ? 'шорта' : 'лонга'}:{' '}
                        <strong className="text-white">{liquidations.largestEvent.symbol}</strong>
                      </span>
                    </div>
                    <span className="font-bold text-rose-400 tabular-nums font-mono">
                      {formatCurrency(liquidations.largestEvent.amountUsd, { compact: true })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      </TerminalSection>

      {/* Статус источника: одна компактная строка, подробности по клику */}
      <div role="status" data-qa="overview-source-status">
        <Collapsible
          testId="overview-source-collapsible"
          tone={dataMode === 'live' ? 'neutral' : 'warning'}
          icon={
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                  dataMode === 'live' ? 'bg-cyan-400' : 'bg-amber-400'
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  dataMode === 'live' ? 'bg-cyan-400' : 'bg-amber-500'
                }`}
              />
            </span>
          }
          label={
            <span className="ui-num font-semibold tracking-tight">
              {dataMode === 'live'
                ? 'LIVE Data · Binance / KuCoin'
                : 'QA Data · внутренний датасет'}
            </span>
          }
        >
          <p className="ui-secondary text-[11px]">
            {dataMode === 'live'
              ? 'Котировки, объёмы и ликвидации поступают из фактических источников. При недоступности источника значения не подставляются и не заменяются другим датасетом.'
              : 'Значения зафиксированы для воспроизводимых проверок интерфейса и не выдаются за фактический рыночный поток.'}
          </p>
        </Collapsible>
      </div>

      {/* Quick Terminal Intelligence Hub */}
      <div className="bg-surface border border-white/[0.08] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-sans shadow-panel">
        <span className="text-slate-400 font-bold tracking-wide text-[11px] flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
          <span>Специализированные аналитические разделы:</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/portfolio"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-cyan-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <PieChart className="w-3.5 h-3.5 text-cyan-400" />
            <span>Портфель & VaR</span>
          </Link>
          <Link
            to="/correlations"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-violet-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <Grid className="w-3.5 h-3.5 text-violet-400" />
            <span>Корреляции & Beta</span>
          </Link>
          <Link
            to="/onchain"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-emerald-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <Network className="w-3.5 h-3.5 text-emerald-400" />
            <span>Он-чейн BTC</span>
          </Link>
          <Link
            to="/calendar"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-amber-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Макро-календарь</span>
          </Link>
          <Link
            to="/ecosystem"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-cyan-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>TVL DeFi и L2</span>
          </Link>
          <Link
            to="/journal"
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-white/[0.08] hover:border-violet-500/40 text-slate-200 hover:text-white flex items-center space-x-1.5 transition-all text-xs font-medium"
          >
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            <span>Журнал трейдера</span>
          </Link>
        </div>
      </div>


      {/* SECTION C: Heatmap Grid Preview */}
      <HeatmapGrid assets={assets} limit={18} compact={true} />

      {/* SECTION D: Radar Feed, Top Movers, Signals Preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MarketRadarPreview events={radarEvents} isDemoMode={dataMode === 'demo'} sourceUnavailable={radarUnavailable} />

        {/* Column 2: Top Movers & Funding Extremes */}
        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 space-y-4 shadow-panel">
          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.06]">
              <span className="font-bold text-xs text-white font-sans tracking-wide flex items-center space-x-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span>Лидеры роста (24h)</span>
              </span>
              <Link to="/market" className="text-[11px] text-cyan-400 hover:underline font-sans font-medium">
                Рынок →
              </Link>
            </div>

            <div className="space-y-1.5 font-sans text-xs">
              {topGainers.map((asset) => (
                <Link
                  key={asset.id}
                  to={`/coin/${asset.symbol}`}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/60 hover:bg-surface-hover transition-colors border border-white/[0.04]"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{asset.symbol}</span>
                    <span className="text-slate-400 text-[11px]">{asset.name}</span>
                  </div>
                  <div className="flex items-center space-x-3 tabular-nums font-mono">
                    <span className="text-slate-200 font-mono tabular-nums">{formatCurrency(asset.price)}</span>
                    <span className="font-semibold text-emerald-400 flex items-center">
                      <ArrowUpRight className="w-3 h-3 mr-0.5 font-mono tabular-nums" />
                      {formatPercent(asset.change24h)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.06]">
              <span className="font-bold text-xs text-white font-sans tracking-wide flex items-center space-x-1.5">
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
                <span>Лидеры падения (24h)</span>
              </span>
            </div>

            <div className="space-y-1.5 font-sans text-xs">
              {topLosers.map((asset) => (
                <Link
                  key={asset.id}
                  to={`/coin/${asset.symbol}`}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/60 hover:bg-surface-hover transition-colors border border-white/[0.04]"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{asset.symbol}</span>
                    <span className="text-slate-400 text-[11px]">{asset.name}</span>
                  </div>
                  <div className="flex items-center space-x-3 tabular-nums font-mono">
                    <span className="text-slate-200 font-mono tabular-nums">{formatCurrency(asset.price)}</span>
                    <span className="font-semibold text-rose-400 flex items-center">
                      <ArrowDownRight className="w-3 h-3 mr-0.5 font-mono tabular-nums" />
                      {formatPercent(asset.change24h)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Funding Extremes widget */}
          {highestFunding && lowestFunding && (
            <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-xs font-sans">
              <div className="bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded-lg">
                <div className="text-[11px] text-emerald-400 uppercase font-semibold">Макс фандинг:</div>
                <div className="font-bold text-white mt-0.5">{highestFunding.symbol}</div>
                <div className="text-emerald-300 font-bold tabular-nums font-mono">+{highestFunding.fundingRate.toFixed(4)}%</div>
              </div>
              <div className="bg-violet-950/40 border border-violet-500/30 p-2.5 rounded-lg">
                <div className="text-[11px] text-violet-400 uppercase font-semibold">Мин. фандинг (платят шорты):</div>
                <div className="font-bold text-white mt-0.5">{lowestFunding.symbol}</div>
                <div className="text-violet-300 font-bold tabular-nums font-mono">{lowestFunding.fundingRate.toFixed(4)}%</div>
              </div>
            </div>
          )}
        </div>

        <AnalyticsSetupsPreview
          btcPrice={btcPrice}
          btcPriceSource={btcPriceSource}
          openInterestUsd={btcOpenInterestUsd}
          openInterestSource={btcOpenInterestSource}
          openInterestDelta24h={btcOpenInterestDelta}
          openInterestDeltaSource={btcOpenInterestDeltaSource}
          fundingRate8h={btcFutures?.fundingRate ?? null}
          fundingSource={btcFundingSource}
          rsi14={btcRsi14}
          rsiSource={btcRsiSource}
          isDemoMode={dataMode === 'demo'}
        />
      </div>

      <SponsorSlot slot="overview-sidebar" />
    </div>
  );
};
