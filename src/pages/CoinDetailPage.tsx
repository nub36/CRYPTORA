import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetDetail, OHLCV, Timeframe, FuturesAsset, RadarEvent } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import type { CandleChartType } from '@/components/common/CandleChart';
import {
  InstrumentChartCard,
  InstrumentMetricsCard,
  InstrumentMetricsGrid,
  InstrumentRadarCard,
  buildCorrelationRows,
  buildDerivativesRows,
  buildSpotStatisticsRows,
  buildTechnicalRows,
  sectionSourceNote,
} from '@/components/instrument';
import { buildChartIndicatorOverlays, buildCorrelationContext } from '@/services/indicators/chartOverlays';
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
import { useInstrumentCandles } from '@/hooks/useInstrumentCandles';
import { getAssetBySymbol, getCanonicalByBinanceSymbol, getCanonicalByKuCoinSymbol } from '@/services/data/registry/assetRegistry';
import {
  Star,
  Layers,
  Activity,
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

export const CoinDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const routeSymbol = normalizeCoinRouteSymbol(symbol);
  const navigate = useNavigate();
  const { provider, watchlist, toggleWatchlist, subscribeSymbol } = useMarketData();
  const livePrice = useLivePrice(routeSymbol);
  const workspace = useCoinWorkspaceLayout();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [futuresData, setFuturesData] = useState<FuturesAsset | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedRouteSymbol, setResolvedRouteSymbol] = useState<string | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [realtimeKline, setRealtimeKline] = useState<KlineTick | null>(null);
  const [candleRecoveryUnavailable, setCandleRecoveryUnavailable] = useState(false);
  const candlesRef = useRef<OHLCV[]>([]);
  const latestCandleOpenTimeRef = useRef<number | null>(null);
  const recoveryTargetOpenTimeRef = useRef<number | null>(null);
  const latestWsKlineRef = useRef<KlineTick | null>(null);
  const recoveryKeysRef = useRef(new Set<string>());
  // RC-8: ключ защиты от устаревших ответов включает рынок.
  const candleRouteKeyRef = useRef(`${routeSymbol}:${timeframe}:spot`);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [chartType, setChartType] = useState<CandleChartType>('candles');
  const [showMA, setShowMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showTimezone, setShowTimezone] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The picker lazily loads the full active Spot universe itself (exchangeInfo,
  // cached app-wide). No provider.getAssets() here: that would pull bulk tickers
  // and kick off candle enrichment just to open a selector.
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const [btcCandles, setBtcCandles] = useState<OHLCV[]>([]);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('idle');

  // Price chart keeps its own independent height; RSI/MACD render in separate panes below.
  const isDesktopWorkspace = useMediaQuery('(min-width: 1280px)');
  /*
   * На телефоне (< 640px) высота графика чуть меньше планшетной: после того как
   * toolbar перестал занимать три ряда (117px → ~41px), терминал не должен
   * «съедать» освободившееся место — цель раздела 9 задачи — разумное
   * соотношение ширины к высоте и видимость следующего блока страницы без
   * чрезмерного скролла. Пороги 1280 (460 ↔ 340) не изменились.
   */
  const isPhoneViewport = useMediaQuery('(max-width: 639.98px)');
  const chartHeight = isDesktopWorkspace ? 460 : isPhoneViewport ? 300 : 340;

  /**
   * История свечей — независимый блок частичных данных: он никогда не входит
   * в гейт загрузки актива/шапки и падает в собственное состояние.
   *
   * Загрузка выполняется ОБЩИМ хуком `useInstrumentCandles`, тем же, что
   * использует страница фьючерса (задача §2, §18): рынок передаётся явно,
   * ответ с устаревшим ключом отбрасывается, дедлайн 17с защищает от
   * зависшего провайдера. Spot-специфика остаётся здесь и только здесь:
   * подмешивание последней WS-свечи и запись истории в репозиторий.
   */
  const {
    candles,
    setCandles,
    status: candleStatus,
    retry: retryCandles,
  } = useInstrumentCandles({
    provider,
    symbol: routeSymbol,
    market: 'spot',
    timeframe,
    limit: 500,
    // 8с Binance + 8с резерв KuCoin: финальный UI-предел чуть больше суммы.
    deadlineMs: 17_000,
    onRequestStart: () => {
      candlesRef.current = [];
      latestCandleOpenTimeRef.current = null;
      recoveryTargetOpenTimeRef.current = null;
      latestWsKlineRef.current = null;
      setRealtimeKline(null);
    },
    transform: (rows) => {
      const latestRest = rows[rows.length - 1];
      const latestWs = latestWsKlineRef.current;
      if (!latestWs) return rows;
      if (latestRest && detectCandleGap(latestRest.time, latestWs.openTime, timeframeIntervalSeconds(timeframe))) {
        void recoverCandleHistory();
      }
      return mergeKlineIntoCandles(rows, latestWs, routeSymbol, mapTimeframeToBinanceInterval(timeframe));
    },
    onApplied: (rows) => {
      candlesRef.current = rows;
      if (rows.length === 0) return;
      latestCandleOpenTimeRef.current = Math.max(
        latestCandleOpenTimeRef.current ?? 0,
        rows[rows.length - 1].time,
      );
      MemoryTimeSeriesRepository.getInstance().saveCandles(routeSymbol, timeframe, rows);
    },
  });
  const candlesLoading = candleStatus === 'loading';
  candlesRef.current = candles;

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
    void provider.getCandles('BTC', timeframe, 500, { market: 'spot' })
      .then((rows) => { if (active) setBtcCandles(rows); })
      .catch(() => { if (active) setBtcCandles([]); });
    return () => { active = false; };
  }, [routeSymbol, timeframe, provider]);

  // Correlation context is bounded by the already-loaded candle arrays (max 500 each).
  // Расчёт — общий с фьючерсной страницей (`buildCorrelationContext`), формулы неизменны.
  const correlationContext = useMemo(() => {
    if (!routeSymbol || routeSymbol === 'BTC') return null;
    const context = buildCorrelationContext(candles, btcCandles);
    return context ? { ...context, timeframe } : null;
  }, [candles, btcCandles, routeSymbol, timeframe]);

  const recoverCandleHistory = useCallback(async () => {
    if (!routeSymbol) return;
    const requestKey = `${routeSymbol}:${timeframe}:spot`;
    if (recoveryKeysRef.current.has(requestKey)) return;
    recoveryKeysRef.current.add(requestKey);
    try {
      // Force bypass the provider's short-lived candle cache on reconnect/gap recovery.
      const recovered = await provider.getCandles(routeSymbol, timeframe, 500, { forceRefresh: true, market: 'spot' });
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
    const key = `${routeSymbol}:${timeframe}:spot`;
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

  /**
   * Оверлеи графика (SMA 20/50/200 + Bollinger) — ОБЩАЯ с фьючерсной
   * страницей реализация. Формулы не изменены: тот же IndicatorEngine.
   */
  const chartIndicators = useMemo(() => buildChartIndicatorOverlays(candles), [candles]);

  if (!asset || asset.symbol !== routeSymbol) {
    const requestPending = loading || resolvedRouteSymbol !== routeSymbol;
    return (
      <div className="route-shell mx-auto max-w-[1920px] space-y-4 px-3 py-4 sm:px-4" data-route="coin" data-layout="chart-first" data-qa="coin-page-shell">
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

      <TerminalSection label="ASSET STATE" title={`${asset.symbol} market state`} className="coin-identity">
      {/* Asset Header Card */}
      <div className="coin-state-strip">
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
      </TerminalSection>

      <TerminalSection label="PRIMARY WORKSPACE" title={`${asset.symbol} chart and context`} className="coin-workspace-region">
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
          items-start: обе колонки держат естественную высоту. Растягивание (`items-stretch`)
          не давало визуально ничего — Pulse-обёртка прозрачна, — но растягивало РАМКУ карточки
          графика под более высокий Pulse и оставляло внутри неё пустую полосу (UI-cleanup §2). */}
      <div
        data-qa="coin-workspace"
        className="grid grid-cols-1 xl:grid-cols-[72fr_28fr] gap-3.5 items-start"
      >
      {/*
        Карточка графика — ОБЩИЙ компонент с /futures/:symbol (задача §2, §10).
        Здесь остаются только Spot-данные: серия свечей, WS-kline и 24ч
        high/low из спотового ticker.
      */}
      <InstrumentChartCard
        market="spot"
        displayPair={`${asset.symbol}/USDT`}
        status={candleStatus}
        onRetry={retryCandles}
        stateQa="spot-chart-state"
        qa="coin-chart-card"
        high24h={asset.high24h ?? null}
        low24h={asset.low24h ?? null}
        note="Аналитический terminal · без исполнения сделок"
        titleSlot={
          <button
            type="button"
            onClick={openPicker}
            data-qa="coin-picker-chart-open"
            className="truncate font-sans text-sm font-bold text-white transition-colors hover:text-brand-cyan"
            title="Выбрать другую монету"
          >
            {asset.symbol}/USDT {chartType === 'candles' ? 'Свечной' : 'Линейный'} график ▾
          </button>
        }
        notice={candleRecoveryUnavailable ? (
          <div role="status" className="rounded border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 font-sans text-xs text-amber-200">
            Не удалось восстановить историю после разрыва kline-потока; показаны только фактически полученные свечи.
          </div>
        ) : undefined}
        terminal={{
          data: candles,
          symbol: `${asset.symbol}/USDT`,
          timeframe,
          onTimeframeChange: setTimeframe,
          height: chartHeight,
          indicators: chartIndicators,
          realtimeKline,
          chartType,
          onChartTypeChange: setChartType,
          showRSI,
          onShowRSIChange: setShowRSI,
          showMACD,
          onShowMACDChange: setShowMACD,
          showMA,
          onShowMAChange: setShowMA,
          showVolume,
          onShowVolumeChange: setShowVolume,
          showTimezone,
          onShowTimezoneChange: setShowTimezone,
        }}
      />

        <div className="xl:sticky xl:top-[70px] self-start">
          <AssetPulsePanel pulse={pulse} />
        </div>
      </div>
            </>
          )}
          {moduleId === 'stats' && (
            <>
      {/*
        Stats Grid — ОБЩИЕ карточки `@/components/instrument` (задача §2, §17).

        Раньше каждая карточка была написана прямо здесь, а страница фьючерса
        не имела аналогов вовсе. Теперь «Рыночная статистика», «Деривативы»,
        «Технические индикаторы» и «Корреляция с BTC» — один и тот же
        компонент на обоих рынках; Spot отличается только НАБОРОМ строк
        (`buildSpotStatisticsRows`) и источником данных.

        ОБЩАЯ сетка `InstrumentMetricsGrid` (UI-cleanup §3/§4/§6): последняя
        карточка поглощает хвостовые пустые ячейки — на desktop «Корреляция
        с BTC» занимает всю вторую строку, на tablet нечётный хвост закрывает
        оба столбца, на мобильном карточки стопкой в одну колонку.
      */}
      <InstrumentMetricsGrid>
        <InstrumentMetricsCard
          title="Рыночная статистика"
          icon={Activity}
          market="spot"
          status="ready"
          qa="spot-market-statistics"
          sourceNote={sectionSourceNote('spot', `${asset.symbol}USDT`)}
          rows={buildSpotStatisticsRows(asset)}
        />

        <InstrumentMetricsCard
          title="Деривативы: детали контракта"
          icon={Layers}
          iconClassName="text-brand-purple"
          market="futures"
          status={futuresData ? 'ready' : 'no-data'}
          qa="spot-derivatives"
          sourceNote={sectionSourceNote('futures', futuresData?.contractSymbol ?? '—')}
          emptyMessage={`По ${asset.symbol} нет активного бессрочного контракта USD-M.`}
          rows={futuresData ? buildDerivativesRows(futuresData, 'compact') : []}
          footer={
            futuresData ? (
              <Link to="/futures" className="inline-flex items-center space-x-1 pt-1 text-[11px] text-brand-cyan hover:underline">
                <span>Все фьючерсы и фандинг</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            ) : undefined
          }
        />

        <InstrumentMetricsCard
          title="Технические индикаторы"
          icon={SlidersHorizontal}
          iconClassName="text-brand-sky"
          market="spot"
          status={dynamicIndicators ? 'ready' : candlesLoading ? 'loading' : 'no-data'}
          qa="spot-indicators"
          sourceNote={sectionSourceNote('spot', `свечи ${timeframe}`)}
          emptyMessage="Недостаточно фактических свечей для расчёта."
          rows={buildTechnicalRows(dynamicIndicators ?? undefined)}
        />

        {routeSymbol && routeSymbol !== 'BTC' && (
          <InstrumentMetricsCard
            title="Корреляция с BTC"
            icon={Activity}
            iconClassName="text-amber-400"
            market="spot"
            status={correlationContext ? 'ready' : candlesLoading ? 'loading' : 'no-data'}
            qa="spot-btc-correlation"
            sourceNote={sectionSourceNote('spot', 'BTCUSDT')}
            emptyMessage="Недостаточно истории для расчёта"
            rows={correlationContext ? buildCorrelationRows(correlationContext) : []}
            variant="inline"
          />
        )}
      </InstrumentMetricsGrid>
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

          {/* События Radar — общая секция (та же, что на странице фьючерса). */}
          <InstrumentRadarCard
            events={radarEvents}
            status="ready"
            policy="native-spot"
            sourceSymbol={asset.symbol}
            qa="spot-radar"
          />
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
        title="Выбор монеты для графика"
      />
      </TerminalSection>

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

    </div>
  );
};
