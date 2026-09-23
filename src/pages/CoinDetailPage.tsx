import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetDetail, OHLCV, Timeframe, FuturesAsset, RadarEvent } from '@/types/market';
import { formatCurrency, formatPercent, formatNumber } from '@/utils/formatters';
import { radarEventTypeLabel, radarSeverityLabel } from '@/utils/labels';
import { CandleChart } from '@/components/common/CandleChart';
import type { ChartIndicatorData, CandleChartType } from '@/components/common/CandleChart';
import { SymbolPickerModal } from '@/components/common/SymbolPickerModal';
import { CoinIcon } from '@/components/common/CoinIcon';
import { Badge } from '@/components/common/Badge';
import { OrderBookL2 } from '@/components/market/OrderBookL2';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { LiquidationPulse } from '@/services/liquidations/LiquidationPulse';
import { AssetPulsePanel } from '@/components/market/AssetPulsePanel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { WorkspaceModule } from '@/components/workspace/WorkspaceModule';
import { useCoinWorkspaceLayout } from '@/workspace/useCoinWorkspaceLayout';
import { COIN_WORKSPACE_MODULES, isDefaultOrder } from '@/workspace/layout';
import { LiquidationData } from '@/types/market';
import { MemoryTimeSeriesRepository } from '@/services/storage/TimeSeriesRepository';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { OrderBookSnapshot, KlineTick, RealtimeConnectionState } from '@/types/realtime';
import { AiExplanationPanel } from '@/components/ai/AiExplanationPanel';
import { DataSourcesBadge } from '@/components/common/DataSourcesBadge';
import { mapTimeframeToBinanceInterval, useRealtimeKline } from '@/hooks/useRealtimeKline';
import { detectCandleGap, klineTimeSeconds, mergeCandleHistory, mergeKlineIntoCandles, timeframeIntervalSeconds } from '@/services/realtime/candleHandoff';
import { useLivePrice } from '@/hooks/useLivePrices';
import { getAssetBySymbol, getCanonicalByBinanceSymbol, getCanonicalByKuCoinSymbol } from '@/services/data/registry/assetRegistry';
import {
  Star,
  Layers,
  Activity,
  Radio,
  ChevronLeft,
  SlidersHorizontal,
  ArrowUpRight,
  Cpu,
  Wrench,
  Flame,
  RotateCcw,
} from 'lucide-react';

export function normalizeCoinRouteSymbol(param?: string): string {
  const raw = (param ?? '').trim().toUpperCase();
  const base = raw.split('/')[0]?.replace(/USDT$/, '') ?? '';
  return getAssetBySymbol(raw)?.symbol
    ?? getCanonicalByBinanceSymbol(raw)?.symbol
    ?? getCanonicalByKuCoinSymbol(raw)?.symbol
    ?? getAssetBySymbol(base)?.symbol
    ?? base;
}

/** «через 3ч 12м» до момента ts; при прошедшем моменте — «скоро». */
const formatUntil = (ts: number): string => {
  const diff = ts - Date.now();
  if (diff <= 0) return 'скоро';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `через ${h}ч ${m}м` : `через ${m}м`;
};

export const CoinDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const routeSymbol = normalizeCoinRouteSymbol(symbol);
  const navigate = useNavigate();
  const { provider, watchlist, toggleWatchlist, subscribeSymbol } = useMarketData();
  const livePrice = useLivePrice(routeSymbol);
  const workspace = useCoinWorkspaceLayout();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [futuresData, setFuturesData] = useState<FuturesAsset | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedRouteSymbol, setResolvedRouteSymbol] = useState<string | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [candlesUnavailable, setCandlesUnavailable] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [realtimeKline, setRealtimeKline] = useState<KlineTick | null>(null);
  const [candleRecoveryUnavailable, setCandleRecoveryUnavailable] = useState(false);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const latestCandleOpenTimeRef = useRef<number | null>(null);
  const recoveryTargetOpenTimeRef = useRef<number | null>(null);
  const latestWsKlineRef = useRef<KlineTick | null>(null);
  const recoveryKeysRef = useRef(new Set<string>());
  const candleRouteKeyRef = useRef(`${routeSymbol}:${timeframe}`);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [chartType, setChartType] = useState<CandleChartType>('candles');
  const [showMA, setShowMA] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAssets, setPickerAssets] = useState<Array<{ symbol: string; name: string }>>([]);
  const openPicker = useCallback(() => {
    setPickerOpen(true);
    void provider.getAssets()
      .then((assets) => setPickerAssets(assets.map(({ symbol: assetSymbol, name }) => ({ symbol: assetSymbol, name }))))
      .catch(() => { /* Keep the shared canonical catalog available if exchange lookup fails. */ });
  }, [provider]);
  const [btcCandles, setBtcCandles] = useState<OHLCV[]>([]);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('idle');

  // Price chart keeps its own independent height; RSI/MACD render in separate panes below.
  const isDesktopWorkspace = useMediaQuery('(min-width: 1280px)');
  const chartHeight = isDesktopWorkspace ? 460 : 340;

  useEffect(() => {
    if (routeSymbol) {
      setOrderBook(null);
      const releaseSymbol = subscribeSymbol(routeSymbol);
      const feed = RealtimeFeedManager.getInstance();
      feed.subscribeDepth(routeSymbol);

      const unsubDepth = feed.eventBus.subscribe<OrderBookSnapshot>(
        `depth:${routeSymbol}`,
        (snapshot) => {
          setOrderBook(snapshot);
        }
      );

      // Track WebSocket connection state for freshness indicator
      const unsubConn = feed.eventBus.subscribe<RealtimeConnectionState>(
        'connection',
        (state) => setConnectionState(state),
      );

      // Set initial state
      setConnectionState(feed.getConnectionState());

      return () => {
        unsubDepth();
        unsubConn();
        releaseSymbol();
        feed.unsubscribeDepth(routeSymbol);
      };
    }
  }, [routeSymbol, subscribeSymbol]);

  // BTC correlation history is optional and never blocks the main asset snapshot.
  useEffect(() => {
    let active = true;
    setBtcCandles([]);
    if (!routeSymbol || routeSymbol === 'BTC') return () => { active = false; };
    void provider.getCandles('BTC', timeframe)
      .then((rows) => { if (active) setBtcCandles(rows); })
      .catch(() => { if (active) setBtcCandles([]); });
    return () => { active = false; };
  }, [routeSymbol, timeframe, provider]);

  // Correlation context is bounded by the already-loaded candle arrays (max 500 each).
  const correlationContext = useMemo(() => {
    if (!routeSymbol || routeSymbol === 'BTC' || candles.length < 20 || btcCandles.length < 20) return null;
    const coinReturns = IndicatorEngine.calculateReturns(candles.map((c) => c.close));
    const btcReturns = IndicatorEngine.calculateReturns(btcCandles.map((c) => c.close));
    const correlation = IndicatorEngine.calculateCorrelation(coinReturns, btcReturns);
    const beta = IndicatorEngine.calculateBeta(coinReturns, btcReturns);
    const lookback = Math.min(coinReturns.length, btcReturns.length);
    return { correlation, beta, lookback, timeframe };
  }, [candles, btcCandles, routeSymbol, timeframe]);

  const recoverCandleHistory = useCallback(async () => {
    if (!routeSymbol) return;
    const requestKey = `${routeSymbol}:${timeframe}`;
    if (recoveryKeysRef.current.has(requestKey)) return;
    recoveryKeysRef.current.add(requestKey);
    try {
      // Force bypass the provider's short-lived candle cache on reconnect/gap recovery.
      const recovered = await provider.getCandles(routeSymbol, timeframe, 500, { forceRefresh: true });
      if (candleRouteKeyRef.current !== requestKey) return;
      let reconciled = mergeCandleHistory(candlesRef.current, recovered);
      const latestWs = latestWsKlineRef.current;
      if (latestWs) {
        reconciled = mergeKlineIntoCandles(
          reconciled,
          latestWs,
          routeSymbol,
          mapTimeframeToBinanceInterval(timeframe),
        );
      }
      candlesRef.current = reconciled;
      setCandles(reconciled);
      setCandleRecoveryUnavailable(false);
      if (reconciled.length > 0) {
        MemoryTimeSeriesRepository.getInstance().saveCandles(routeSymbol, timeframe, reconciled);
        latestCandleOpenTimeRef.current = Math.max(
          latestCandleOpenTimeRef.current ?? 0,
          reconciled[reconciled.length - 1].time,
        );
        recoveryTargetOpenTimeRef.current = null;
      }
    } catch {
      if (candleRouteKeyRef.current === requestKey) setCandleRecoveryUnavailable(true);
    } finally {
      recoveryKeysRef.current.delete(requestKey);
    }
  }, [provider, routeSymbol, timeframe]);

  useEffect(() => {
    const key = `${routeSymbol}:${timeframe}`;
    candleRouteKeyRef.current = key;
    latestCandleOpenTimeRef.current = null;
    recoveryTargetOpenTimeRef.current = null;
    latestWsKlineRef.current = null;
    candlesRef.current = [];
    setCandleRecoveryUnavailable(false);
    setRealtimeKline(null);
    setCandles([]);
  }, [routeSymbol, timeframe]);

  // A fresh ticker/depth connection is not treated as proof that candle klines are fresh.
  // Kline freshness is tracked independently and a REST reconciliation follows reconnects.
  const handleKlineTick = useCallback((tick: KlineTick) => {
    if (!routeSymbol) return;
    if (tick.symbol.toUpperCase().replace(/USDT$/, '') !== routeSymbol || tick.interval !== mapTimeframeToBinanceInterval(timeframe)) return;
    const openTimeSeconds = klineTimeSeconds(tick.openTime);
    if (openTimeSeconds === null) return;
    if (latestCandleOpenTimeRef.current !== null && openTimeSeconds < latestCandleOpenTimeRef.current) return;
    const gap = detectCandleGap(
      latestCandleOpenTimeRef.current,
      tick.openTime,
      timeframeIntervalSeconds(timeframe),
    );
    if (gap) {
      if (recoveryTargetOpenTimeRef.current !== openTimeSeconds) {
        recoveryTargetOpenTimeRef.current = openTimeSeconds;
        void recoverCandleHistory();
      }
    } else {
      latestCandleOpenTimeRef.current = Math.max(latestCandleOpenTimeRef.current ?? 0, openTimeSeconds);
    }
    latestWsKlineRef.current = tick;
    setRealtimeKline(tick);
  }, [routeSymbol, timeframe, recoverCandleHistory]);

  useRealtimeKline({
    symbol: routeSymbol || undefined,
    timeframe,
    enabled: !loading && !!asset && asset.symbol === routeSymbol,
    onKlineTick: handleKlineTick,
    onReconnect: recoverCandleHistory,
  });

  // Primary quote only. The full getAssetDetail() path includes candles and
  // CoinGecko metadata, so awaiting it here used to block every page control.
  // Keep an explicit deadline for custom providers that fail to settle; the UI
  // shell and picker render independently while this request is in flight.
  useEffect(() => {
    if (!routeSymbol) {
      setResolvedRouteSymbol(routeSymbol);
      setLoading(false);
      return;
    }
    let active = true;
    let deadlineTimer: number | undefined;
    setLoading(true);
    setResolvedRouteSymbol(null);
    setAsset(null);
    setSourceUnavailable(false);

    const snapshotRequest = Promise.resolve().then(() => (
      provider.getAssetSnapshot
        ? provider.getAssetSnapshot(routeSymbol)
        : provider.getAssetDetail(routeSymbol)
    ));
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = window.setTimeout(() => reject(new Error('Spot quote request exceeded 9.5s')), 9_500);
    });

    void Promise.race([snapshotRequest, deadline])
      .then((detail) => {
        if (!active) return;
        setAsset(detail);
        setSourceUnavailable(false);
      })
      .catch(() => {
        if (!active) return;
        setAsset(null);
        setSourceUnavailable(true);
      })
      .finally(() => {
        if (!active) return;
        if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
        setResolvedRouteSymbol(routeSymbol);
        setLoading(false);
      });

    return () => {
      active = false;
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
    };
  }, [routeSymbol, provider, retryKey]);

  // Candle history is an independent partial-data block. It is never part of
  // the asset/header loading gate and rejects into a local empty/error state.
  useEffect(() => {
    if (!routeSymbol) return;
    let active = true;
    candlesRef.current = [];
    latestCandleOpenTimeRef.current = null;
    recoveryTargetOpenTimeRef.current = null;
    latestWsKlineRef.current = null;
    setCandles([]);
    setRealtimeKline(null);
    setCandlesUnavailable(false);
    setCandlesLoading(true);
    let candleDeadlineTimer: number | undefined;
    const candleDeadline = new Promise<never>((_, reject) => {
      // The live provider may use an 8s Binance request followed by an 8s
      // KuCoin fallback. This final UI guard prevents a hung custom provider
      // from leaving only the chart's loading state open indefinitely.
      candleDeadlineTimer = window.setTimeout(() => reject(new Error('Spot candle request exceeded 17s')), 17_000);
    });

    void Promise.race([provider.getCandles(routeSymbol, timeframe), candleDeadline])
      .then((rows) => {
        if (!active) return;
        const latestRest = rows[rows.length - 1];
        let initialCandles = rows;
        const latestWs = latestWsKlineRef.current;
        if (latestWs) {
          if (latestRest && detectCandleGap(latestRest.time, latestWs.openTime, timeframeIntervalSeconds(timeframe))) {
            void recoverCandleHistory();
          }
          initialCandles = mergeKlineIntoCandles(rows, latestWs, routeSymbol, mapTimeframeToBinanceInterval(timeframe));
        }
        candlesRef.current = initialCandles;
        if (initialCandles.length > 0) {
          const finalTime = initialCandles[initialCandles.length - 1].time;
          latestCandleOpenTimeRef.current = Math.max(latestCandleOpenTimeRef.current ?? 0, finalTime);
          MemoryTimeSeriesRepository.getInstance().saveCandles(routeSymbol, timeframe, initialCandles);
        }
        setCandles(initialCandles);
      })
      .catch(() => {
        if (!active) return;
        setCandles([]);
        setCandlesUnavailable(true);
      })
      .finally(() => {
        if (candleDeadlineTimer !== undefined) window.clearTimeout(candleDeadlineTimer);
        if (active) setCandlesLoading(false);
      });

    return () => {
      active = false;
      if (candleDeadlineTimer !== undefined) window.clearTimeout(candleDeadlineTimer);
    };
  }, [routeSymbol, timeframe, provider, recoverCandleHistory]);

  // Derivatives, Radar and liquidation data are supplemental, independent requests.
  useEffect(() => {
    if (!routeSymbol) return;
    let active = true;
    setFuturesData(null);
    setRadarEvents([]);
    setLiquidations(null);
    void Promise.allSettled([
      provider.getFuturesList(),
      provider.getRadarEvents(routeSymbol),
      provider.getLiquidations(),
    ]).then(([futuresResult, radarResult, liquidationResult]) => {
      if (!active) return;
      if (futuresResult.status === 'fulfilled') {
        const match = futuresResult.value.find(
          (row) => row.symbol.split('/')[0].toUpperCase() === routeSymbol,
        );
        setFuturesData(match ?? null);
      }
      if (radarResult.status === 'fulfilled') setRadarEvents(radarResult.value);
      if (liquidationResult.status === 'fulfilled') setLiquidations(liquidationResult.value);
    });
    return () => { active = false; };
  }, [routeSymbol, provider]);

  const dynamicIndicators = useMemo(() => {
    if (candles.length > 0) {
      return IndicatorEngine.computeCompleteIndicators(candles);
    }
    return asset?.indicators;
  }, [candles, asset]);

  // Chart indicator series for overlays (SMA, Bollinger) aligned with candle timestamps
  const chartIndicators = useMemo<ChartIndicatorData | undefined>(() => {
    if (candles.length < 20) return undefined;
    const closes = candles.map((c) => c.close);
    const pad = (series: number[], offset: number): number[] => {
      const padded = new Array<number>(offset).fill(NaN);
      return padded.concat(series);
    };
    const sma20 = IndicatorEngine.calculateSMA(closes, 20);
    const sma50 = IndicatorEngine.calculateSMA(closes, 50);
    const sma200 = IndicatorEngine.calculateSMA(closes, 200);
    const bb = IndicatorEngine.calculateBollingerBands(closes, 20, 2);
    return {
      sma20: candles.length >= 20 ? pad(sma20, closes.length - sma20.length) : undefined,
      sma50: candles.length >= 50 ? pad(sma50, closes.length - sma50.length) : undefined,
      sma200: candles.length >= 200 ? pad(sma200, closes.length - sma200.length) : undefined,
      bollingerUpper: bb.length > 0 ? pad(bb.map((b) => b.upper), closes.length - bb.length) : undefined,
      bollingerMiddle: bb.length > 0 ? pad(bb.map((b) => b.middle), closes.length - bb.length) : undefined,
      bollingerLower: bb.length > 0 ? pad(bb.map((b) => b.lower), closes.length - bb.length) : undefined,
    };
  }, [candles]);

  if (!asset || asset.symbol !== routeSymbol) {
    const requestPending = loading || resolvedRouteSymbol !== routeSymbol;
    return (
      <div className="mx-auto max-w-[1920px] space-y-4 px-3 py-4 sm:px-4" data-qa="coin-page-shell">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <CoinIcon symbol={routeSymbol || '?'} size={40} />
            <div>
              <h1 className="font-sans text-lg font-bold text-white">{routeSymbol || 'Монета'}</h1>
              <p className="font-sans text-xs text-slate-400">Spot-карточка · источник данных загружается отдельно</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openPicker}
              data-qa="coin-picker-open"
              className="rounded border border-surface-border bg-surface-elevated px-3 py-2 font-sans text-xs font-semibold text-white hover:border-brand-cyan"
            >
              Выбрать монету
            </button>
            <Link to="/market" className="rounded border border-surface-border px-3 py-2 font-sans text-xs text-brand-cyan hover:bg-white/[0.04]">
              Рынок Spot
            </Link>
          </div>
        </section>

        <section className="rounded-lg border border-surface-border bg-surface p-5" aria-live="polite" data-qa="coin-load-state">
          {requestPending ? (
            <div role="status" className="flex items-center gap-2 font-sans text-sm text-slate-300">
              <Activity className="h-4 w-4 animate-spin text-brand-cyan" />
              Получаем Spot ticker для {routeSymbol}. График и дополнительные источники не блокируют выбор монеты.
            </div>
          ) : sourceUnavailable ? (
            <div className="space-y-3">
              <DataSourceUnavailable subject={`Spot ticker ${routeSymbol}`} />
              <p className="font-sans text-xs text-slate-400">Остальные блоки не подменяются demo-значениями.</p>
              <button type="button" onClick={() => setRetryKey((n) => n + 1)} className="rounded border border-surface-border px-3 py-2 font-sans text-xs text-white hover:bg-white/[0.05]">
                Повторить загрузку
              </button>
            </div>
          ) : (
            <div className="space-y-3 font-sans text-sm">
              <h2 className="font-bold text-white">Актив не найден</h2>
              <p className="text-slate-400">«{routeSymbol}» отсутствует в поддерживаемом каталоге или не имеет доступного Spot ticker.</p>
            </div>
          )}
        </section>

        <SymbolPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(base) => navigate(`/coin/${base.toUpperCase()}`)}
          current={routeSymbol}
          availableAssets={pickerAssets}
          title="Выбор монеты"
        />
      </div>
    );
  }

  const isStarred = watchlist.includes(asset.symbol);
  const currentPrice = livePrice !== undefined ? livePrice : asset.price;

  // Снимок «ликвидации + деривативы» строго по текущему активу.
  // Источник данных определяется провайдером: фактические события, демо-набор или
  // модельная оценка — с явной маркировкой происхождения в UI.
  const pulse = LiquidationPulse.buildAssetPulse({
    symbol: asset.symbol,
    liquidations,
    futures: futuresData,
    priceChange24h: asset.change24h,
  });

  return (
    <div className="mx-auto max-w-[1920px] space-y-3.5 px-3 py-3 sm:px-4">
      {/* Breadcrumbs & Back */}
      <div className="flex items-center justify-between font-mono text-[13px] text-slate-400">
        <div className="flex items-center space-x-2">
          <Link to="/market" className="hover:text-white flex items-center space-x-1">
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Рынок</span>
          </Link>
          <span aria-hidden>/</span>
          <span className="text-white font-bold">{asset.symbol}</span>
        </div>

        <div className="flex items-center space-x-2">
          {!asset.isDemo ? (
            <Badge variant="green" size="xs">
              LIVE SPOT: {asset.provenance?.exchange.toUpperCase() || 'BINANCE'}{asset.provenance?.isFallback ? ' (FALLBACK)' : ''}
            </Badge>
          ) : (
            <Badge variant="demo" size="xs">
              QA-ДАТАСЕТ
            </Badge>
          )}
          <DataSourcesBadge
            spot={asset.provenance?.exchange ?? 'Binance'}
            derivatives={futuresData ? 'Binance Futures' : undefined}
            orderBook="Binance"
            liquidations={liquidations && liquidations.dataStatus === 'LIVE_STREAM' ? 'Binance/Bybit/OKX' : undefined}
            metadata="CoinGecko"
            connectionState={connectionState}
          />
        </div>
      </div>

      {/* Asset Header Card */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <CoinIcon symbol={asset.symbol} size={48} className="shadow-md" />

          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl sm:text-2xl font-bold font-sans text-white">
                {asset.name}
              </h1>
              <span className="text-sm font-mono text-slate-400 font-semibold">
                {asset.symbol}
              </span>
              {asset.rank < Number.MAX_SAFE_INTEGER && (
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-sans">
                  Ранг #{asset.rank}
                </span>
              )}
              <span className="text-xs bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded font-sans uppercase">
                {asset.category}
              </span>
            </div>

            {asset.description && (
              <p className="mt-1 max-w-3xl font-sans text-[13px] text-slate-400">
                {asset.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-6 self-start md:self-auto">
          <div className="text-right font-mono">
            <div className="text-2xl font-black text-white flex items-center justify-end space-x-1.5">
              {livePrice !== undefined && (
                <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse inline-block" title="Тик реального времени (WebSocket)" />
              )}
              <span>{formatCurrency(currentPrice, { decimals: currentPrice > 10 ? 2 : 4 })}</span>
            </div>
            <div className="flex items-center justify-end space-x-2 mt-0.5">
              <span
                className={`text-xs font-bold ${
                  asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                24h: {formatPercent(asset.change24h)}
              </span>
              {asset.change1h != null && (
                <>
                  <span aria-hidden className="text-slate-500 text-xs">•</span>
                  <span
                    className={`text-xs font-semibold ${
                      asset.change1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                    }`}
                  >
                    1h: {formatPercent(asset.change1h)}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={openPicker}
            data-qa="coin-picker-open"
            className="rounded border border-surface-border bg-surface-elevated px-3 py-2 font-sans text-xs font-semibold text-white hover:border-brand-cyan"
            title="Перейти к другой монете"
          >
            Выбрать монету ▾
          </button>
          <button
            onClick={() => toggleWatchlist(asset.symbol)}
            className={`p-2.5 rounded border transition-colors ${
              isStarred
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-surface-elevated border-surface-border text-slate-400 hover:text-white'
            }`}
            title={isStarred ? 'Удалить из избранного' : 'Добавить в избранное'}
          >
            <Star className={`w-5 h-5 ${isStarred ? 'fill-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quick Action Navigation Bar */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Link
          to="/strategies"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-brand-purple text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Cpu className="w-3.5 h-3.5 text-brand-purple" />
          <span>Симуляция в лаборатории стратегий</span>
        </Link>
        <Link
          to="/tools"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-brand-cyan text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Wrench className="w-3.5 h-3.5 text-brand-cyan" />
          <span>Калькуляторы риска & DCA</span>
        </Link>
        <Link
          to="/liquidations"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-rose-500 text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>Кластеры ликвидаций</span>
        </Link>
      </div>

      {/* Переставляемая рабочая область (UX-цикл п. 5): порядок модулей хранится в localStorage
          (схема v1), внутреннее устройство модулей неизменно. */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-border pb-1.5">
        <span className="text-[11px] font-sans text-slate-500">
          Рабочая область: модули можно переставлять (ручка или стрелки ↑/↓ с клавиатуры)
        </span>
        <button
          type="button"
          onClick={workspace.reset}
          disabled={isDefaultOrder(workspace.order)}
          data-qa="workspace-reset"
          className="flex items-center gap-1 rounded border border-surface-border px-2 py-1 text-[11px] font-sans text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Сбросить раскладку</span>
        </button>
      </div>

      {workspace.order.map((moduleId, index) => (
        <WorkspaceModule
          key={moduleId}
          id={moduleId}
          title={COIN_WORKSPACE_MODULES.find((m) => m.id === moduleId)!.titleRu}
          index={index}
          count={workspace.order.length}
          onMove={workspace.move}
          onDrop={workspace.dropOn}
        >
          {moduleId === 'chart' && (
            <>
      {/* Analytical Workspace: доминирующий график + снимок деривативов/ликвидаций.
          Двухколоночная раскладка включается от 1280px; ниже Pulse складывается под график.
          items-stretch ensures Pulse panel fills the chart height — no vertical gap before next module. */}
      <div
        data-qa="coin-workspace"
        className="grid grid-cols-1 xl:grid-cols-[72fr_28fr] gap-3.5 items-stretch"
      >
      <div data-qa="coin-chart-card" className="space-y-3 rounded-lg border border-surface-border bg-surface p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={openPicker}
              data-qa="coin-picker-chart-open"
              className="font-sans font-bold text-sm text-white hover:text-brand-cyan transition-colors"
              title="Выбрать другую монету"
            >
              {asset.symbol}/USDT {chartType === 'candles' ? 'Свечной' : 'Линейный'} график ▾
            </button>
            <div className="hidden sm:flex items-center space-x-2 text-xs font-sans text-slate-400">
              <span>Макс. 24ч: <strong className="text-slate-200 font-mono tabular-nums">{asset.high24h != null ? formatCurrency(asset.high24h) : '—'}</strong></span>
              <span>Мин. 24ч: <strong className="text-slate-200 font-mono tabular-nums">{asset.low24h != null ? formatCurrency(asset.low24h) : '—'}</strong></span>
            </div>
          </div>

          {/* Timeframe buttons */}
          <div className="flex items-center space-x-1 font-sans text-xs bg-surface-elevated p-1 rounded border border-surface-border self-start sm:self-auto">
            {(['5m', '15m', '30m', '1h', '4h', '1D', '1W'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-brand-cyan text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          {/* Indicator sub-panel toggles */}
          <div className="flex items-center space-x-1 font-sans text-xs self-start sm:self-auto">
            <button
              onClick={() => setShowRSI((v) => !v)}
              className={`px-2.5 py-1 rounded transition-colors border ${
                showRSI
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300 font-bold'
                  : 'border-surface-border text-slate-400 hover:text-white'
              }`}
              title="RSI (14) — индекс относительной силы"
            >
              RSI
            </button>
            <button
              onClick={() => setShowMACD((v) => !v)}
              className={`px-2.5 py-1 rounded transition-colors border ${
                showMACD
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 font-bold'
                  : 'border-surface-border text-slate-400 hover:text-white'
              }`}
              title="MACD (12/26/9) — схождение/расхождение скользящих средних"
            >
              MACD
            </button>
          </div>
        </div>

        {/* Тип графика + MA-линии с легендой */}
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
          <div
            className="flex items-center space-x-1 bg-surface-elevated p-1 rounded border border-surface-border"
            data-qa="chart-type-switch"
          >
            {([['candles', 'Свечи'], ['line', 'Линия']] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setChartType(t)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  chartType === t ? 'bg-brand-cyan text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowMA((v) => !v)}
            data-qa="chart-ma-toggle"
            title="SMA 20/50/200 и полосы Боллинджера поверх цены"
            className={`px-2.5 py-1 rounded transition-colors border ${
              showMA
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                : 'border-surface-border text-slate-400 hover:text-white'
            }`}
          >
            MA {showMA ? 'вкл' : 'выкл'}
          </button>
          {showMA && chartIndicators && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400" data-qa="chart-ma-legend">
              <span className="flex items-center gap-1" title="Скользящее среднее за 20 свечей">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} /> SMA 20
              </span>
              <span className="flex items-center gap-1" title="Скользящее среднее за 50 свечей">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#3b82f6' }} /> SMA 50
              </span>
              <span className="flex items-center gap-1" title="Скользящее среднее за 200 свечей">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#a855f7' }} /> SMA 200
              </span>
              <span className="flex items-center gap-1" title="Полосы Боллинджера (20, 2σ)">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgba(99, 102, 241, 0.8)' }} /> BB 20
              </span>
            </div>
          )}
        </div>

        {candlesLoading && <div role="status" className="font-sans text-xs text-slate-400">Загрузка свечей… остальные блоки доступны.</div>}
        {candlesUnavailable && <div role="status" className="rounded border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 font-sans text-xs text-amber-200">Spot-источник свечей недоступен; график и индикаторы не подменяются demo-данными.</div>}
        {candleRecoveryUnavailable && <div role="status" className="rounded border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 font-sans text-xs text-amber-200">Не удалось восстановить историю после разрыва kline-потока; показаны только фактически полученные свечи.</div>}
        {!candlesLoading && !candlesUnavailable && candles.length === 0 && <div role="status" className="font-sans text-xs text-slate-400">Источник пока не вернул историю свечей.</div>}
        {/* Interactive TradingView Lightweight Chart */}
        <CandleChart data={candles} symbol={`${asset.symbol}/USDT`} timeframe={timeframe} height={chartHeight} indicators={chartIndicators} realtimeKline={realtimeKline} showRSI={showRSI} showMACD={showMACD} chartType={chartType} showMA={showMA} />
      </div>

        <div className="xl:sticky xl:top-[70px] self-start">
          <AssetPulsePanel pulse={pulse} />
        </div>
      </div>
            </>
          )}
          {moduleId === 'stats' && (
            <>
      {/* Stats Grid: Market Metrics, Derivatives, Technical Indicators + Correlation */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Key Market Stats */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Activity className="w-4 h-4 text-brand-cyan" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Рыночная статистика
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Капитализация</span>
              <span className="font-bold text-white font-mono tabular-nums">{formatCurrency(asset.marketCap)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Объём торгов 24ч</span>
              <span className="font-bold text-white font-mono tabular-nums">{formatCurrency(asset.volume24h)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">В обращении</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {formatNumber(asset.circulatingSupply, { compact: true })} {asset.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Общий запас</span>
              {asset.totalSupply != null ? (
                <span className="text-slate-200 font-mono tabular-nums">
                  {formatNumber(asset.totalSupply, { compact: true })} {asset.symbol}
                  <span className="text-[11px] text-emerald-500 ml-1">CoinGecko</span>
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]" title="Источник (CoinGecko) не отдал данные">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Макс. запас</span>
              {asset.maxSupply != null ? (
                <span className="text-slate-200 font-mono tabular-nums">
                  {formatNumber(asset.maxSupply, { compact: true })} {asset.symbol}
                  <span className="text-[11px] text-emerald-500 ml-1">CoinGecko</span>
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]" title="Источник (CoinGecko) не отдал данные или неограничен">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Исторический максимум (ATH)</span>
              {asset.ath != null && asset.athDate ? (
                <span className="text-slate-200 font-mono tabular-nums">
                  {formatCurrency(asset.ath)} ({asset.athDate.slice(0, 10)})
                  <span className="text-[11px] text-emerald-500 ml-1">CoinGecko</span>
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]" title="Источник (CoinGecko) недоступен или не отдал данные">Н/Д</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Исторический минимум (ATL)</span>
              {asset.atl != null && asset.atlDate ? (
                <span className="text-slate-200 font-mono tabular-nums">
                  {formatCurrency(asset.atl)} ({asset.atlDate.slice(0, 10)})
                  <span className="text-[11px] text-emerald-500 ml-1">CoinGecko</span>
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]" title="Источник (CoinGecko) недоступен или не отдал данные">Н/Д</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Динамика за 7 дней</span>
              {asset.change7d != null ? (
                <span
                  className={`font-bold ${
                    asset.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {formatPercent(asset.change7d)}
                </span>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Futures & Derivatives Snapshot */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Layers className="w-4 h-4 text-brand-purple" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Деривативы: детали контракта
            </span>
          </div>

          {futuresData ? (
            <div className="space-y-2 text-xs">
              {/* Детализация без дублей со снимком Pulse: там OI, OI Δ24ч и фандинг 8ч,
                  здесь — остальные метрики контракта и производные показатели. */}
              <div className="flex justify-between">
                <span className="text-slate-400">Метка / индексная цена</span>
                <span className="font-bold text-white font-mono tabular-nums">
                  {formatCurrency(futuresData.markPrice, { decimals: futuresData.markPrice > 10 ? 2 : 4 })} /{' '}
                  {formatCurrency(futuresData.indexPrice, { decimals: futuresData.indexPrice > 10 ? 2 : 4 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Спред метки к индексу</span>
                <span className="text-slate-200 tabular-nums font-mono">
                  {formatCurrency(futuresData.markPrice - futuresData.indexPrice, {
                    decimals: futuresData.markPrice > 10 ? 2 : 4,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ставка к следующему начислению{futuresData.nextFundingTime ? ` · ${formatUntil(futuresData.nextFundingTime)}` : ''}</span>
                <span
                  className={`font-bold tabular-nums  font-mono${
                    futuresData.predictedFundingRate >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {futuresData.predictedFundingRate >= 0 ? '+' : ''}
                  {futuresData.predictedFundingRate.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Годовой фандинг (APR)</span>
                <span className="text-slate-200 font-semibold tabular-nums font-mono">
                  {formatPercent(futuresData.annualizedFundingRate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">OI Δ за 1 час</span>
                <span
                  className={`font-bold tabular-nums font-mono ${
                    futuresData.openInterestChange1h == null ? 'text-slate-500' : futuresData.openInterestChange1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {futuresData.openInterestChange1h != null ? formatPercent(futuresData.openInterestChange1h) : '—'}
                  <OiDeltaBadge source={futuresData.openInterestChangeSource} />
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Суточный фьючерсный объем</span>
                <span className="text-slate-200 tabular-nums font-mono">
                  {formatCurrency(futuresData.futuresVolume24h, { compact: true })}
                </span>
              </div>
              <Link
                to="/futures"
                className="inline-flex items-center space-x-1 text-[11px] text-brand-cyan hover:underline pt-1"
              >
                <span>Все фьючерсы и фандинг</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="py-8 text-center text-[13px] text-slate-500">
              Нет активного фьючерсного бессрочного контракта в демо-выборке.
            </div>
          )}
        </div>

        {/* Card 3: Technical Indicators Snapshot */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <SlidersHorizontal className="w-4 h-4 text-brand-sky" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Технические индикаторы
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">RSI (14)</span>
              {dynamicIndicators?.rsi14 != null ? (
                <span
                  className={`font-bold ${
                    dynamicIndicators.rsi14 >= 70
                      ? 'text-rose-400'
                      : dynamicIndicators.rsi14 <= 30
                      ? 'text-emerald-400'
                      : 'text-brand-cyan'
                  }`}
                >
                  {dynamicIndicators.rsi14.toFixed(1)}{' '}
                  <span className="text-[11px] font-normal text-slate-400">
                    {dynamicIndicators.rsi14 >= 70
                      ? '(Перекуплен)'
                      : dynamicIndicators.rsi14 <= 30
                      ? '(Перепродан)'
                      : '(Нейтрально)'}
                  </span>
                </span>
              ) : (
                // З3: недостаточно фактических свечей — «нет данных», не RSI=50
                <span className="text-slate-500 font-bold">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Гистограмма MACD</span>
              {dynamicIndicators?.macd?.hist != null ? (
                <span
                  className={`font-bold ${
                    dynamicIndicators.macd.hist >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {dynamicIndicators.macd.hist.toFixed(2)}
                </span>
              ) : (
                <span className="text-slate-500 font-bold">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SMA (20 / 50 / 200)</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {dynamicIndicators?.sma20 != null ? formatCurrency(dynamicIndicators.sma20, { compact: true }) : '—'} /{' '}
                {dynamicIndicators?.sma50 != null ? formatCurrency(dynamicIndicators.sma50, { compact: true }) : '—'} /{' '}
                {dynamicIndicators?.sma200 != null ? formatCurrency(dynamicIndicators.sma200, { compact: true }) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Полосы Боллинджера (верх / низ)</span>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {dynamicIndicators?.bollinger?.upper != null ? formatCurrency(dynamicIndicators.bollinger.upper, { compact: true }) : '—'} /{' '}
                {dynamicIndicators?.bollinger?.lower != null ? formatCurrency(dynamicIndicators.bollinger.lower, { compact: true }) : '—'}
              </span>
            </div>
            {dynamicIndicators && 'atr14' in dynamicIndicators && (
              <div className="flex justify-between">
                <span className="text-slate-400">ATR (14) / VWAP</span>
                <span className="text-xs text-brand-cyan">
                  ±{formatCurrency((dynamicIndicators as any).atr14, { compact: true })} /{' '}
                  {formatCurrency((dynamicIndicators as any).vwap, { compact: true })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Card 4: Correlation Context (compact, BTC only) */}
        {routeSymbol && routeSymbol !== 'BTC' && (
          <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
            <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
              <Activity className="w-4 h-4 text-amber-400" />
              <span className="text-[13px] font-bold tracking-wide text-white">
                Корреляция с BTC
              </span>
            </div>

            {correlationContext ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Корреляция (ρ)</span>
                  {correlationContext.correlation != null ? (
                    <span className={`font-bold font-mono tabular-nums ${
                      Math.abs(correlationContext.correlation) >= 0.7
                        ? 'text-amber-400'
                        : Math.abs(correlationContext.correlation) >= 0.4
                        ? 'text-slate-200'
                        : 'text-emerald-400'
                    }`}>
                      {correlationContext.correlation.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Бета (β)</span>
                  {correlationContext.beta != null ? (
                    <span className="text-slate-200 font-mono tabular-nums">
                      {correlationContext.beta.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Окно наблюдения</span>
                  <span className="text-slate-300 font-mono">
                    {correlationContext.lookback} свечей · {correlationContext.timeframe}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-[13px] text-slate-500 font-sans">
                Недостаточно истории для расчёта
              </div>
            )}
          </div>
        )}
      </div>
            </>
          )}
          {moduleId === 'depth' && (
            <>
      {/* Order Book L2, Trading Pairs & Radar Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Order Book L2 Column */}
        <div className="lg:col-span-1 min-h-[380px]">
          <OrderBookL2
            orderBook={orderBook}
            currentPrice={currentPrice}
            symbol={asset.symbol}
          />
        </div>

        {/* Pairs and Radar in 2-column layout */}
        <div className="lg:col-span-2 space-y-4">
          {/* Trading Pairs Table */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-surface-border">
              <span className="font-sans text-[13px] font-bold tracking-wide text-white">
                {asset.isDemo ? 'Пары на ведущих биржах (QA-датасет)' : 'Пары на ведущих биржах (Spot Market)'}
              </span>
              <span className="text-[11px] font-sans text-slate-400">Биржевая глубина</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="border-b border-surface-border text-xs text-slate-400">
                  <tr>
                    <th className="py-2 text-left">Биржа</th>
                    <th className="py-2 text-left">Пара</th>
                    <th className="py-2 text-right">Цена</th>
                    <th className="py-2 text-right">24h Объем</th>
                    <th className="py-2 text-right">Спред %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {asset.pairs.map((p, idx) => (
                    <tr key={idx} className="hover:bg-surface-hover">
                      <td className="py-2 text-white font-semibold">{p.exchange}</td>
                      <td className="py-2 text-brand-cyan">{p.pair}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatCurrency(p.price)}</td>
                      <td className="py-2 text-right text-slate-400 font-mono tabular-nums">
                        {formatCurrency(p.volume24h, { compact: true })}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {p.spreadPct != null ? (
                          <>
                            {p.spreadPct}%
                            <span className="text-[11px] text-slate-500 ml-1">({(p.spreadPct * 100).toFixed(1)}bps)</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Radar events for this coin */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-surface-border">
              <div className="flex items-center space-x-2">
                <Radio className="w-4 h-4 text-brand-cyan" />
                <span className="font-sans text-[13px] font-bold tracking-wide text-white">
                  События Market Radar по {asset.symbol}
                </span>
              </div>
              <Link
                to="/radar"
                className="flex items-center space-x-1 font-sans text-xs text-brand-cyan hover:underline"
              >
                <span>Все аномалии</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {radarEvents.length === 0 ? (
              <div className="py-6 text-center font-sans text-[13px] text-slate-500">
                По инструменту {asset.symbol} активных аномалий не зафиксировано.
              </div>
            ) : (
              <div className="space-y-2 font-sans">
                {radarEvents.map((re) => (
                  <div
                    key={re.id}
                    className="p-2.5 rounded bg-surface-elevated border border-surface-border text-xs flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          re.severity === 'HIGH' ? 'red' : re.severity === 'MEDIUM' ? 'amber' : 'cyan'
                        }
                        size="xs"
                      >
                        {radarSeverityLabel(re.severity)}
                      </Badge>
                      <span className="text-white font-semibold">{radarEventTypeLabel(re.type)}</span>
                      <span className="hidden text-xs text-slate-400 sm:inline">
                        {re.observation}
                      </span>
                    </div>
                    <span className="text-brand-cyan font-bold whitespace-nowrap">
                      {re.metricValue}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
            </>
          )}
        </WorkspaceModule>
      ))}

      {/* AI-разбор актива — вторичный аналитический слой (docs/AI.md §7).
          Вызывается ТОЛЬКО по явному действию пользователя. */}
      <AiExplanationPanel
        asset={asset}
        futures={futuresData}
        radarEvents={radarEvents}
        liquidations={liquidations}
      />

      <SymbolPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(base) => navigate(`/coin/${base.toUpperCase()}`)}
        current={asset.symbol}
        availableAssets={pickerAssets}
        title="Выбор монеты для графика"
      />
    </div>
  );
};
