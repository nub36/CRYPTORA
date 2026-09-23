import React, { useEffect, useState, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { LiquidationPipeline, LIQUIDATION_SOURCE_LABELS, type LiquidationSourceId, type LiquidationStreamState } from '@/services/liquidations/LiquidationPipeline';
import { LiquidationData, OHLCV, Timeframe } from '@/types/market';
import { formatCurrency, formatTimestamp, formatDuration } from '@/utils/formatters';
import { sideLabel } from '@/utils/labels';
import { LiquidationHeatmapModelBuilder } from '@/services/liquidations/LiquidationHeatmap';
import { LiquidationHeatmap } from '@/components/market/LiquidationHeatmap';
import { Flame, ShieldAlert, Clock, Layers } from 'lucide-react';
import { SymbolPickerModal } from '@/components/common/SymbolPickerModal';
import { LiquidationPriceChart } from '@/components/market/LiquidationPriceChart';

const EMPTY_UNAVAILABLE_LIQUIDATIONS: LiquidationData = {
  totalLong24h: 0,
  totalShort24h: 0,
  total24h: 0,
  largestEvent: null,
  eventsCount24h: 0,
  lastEventAt: null,
  dataStatus: 'UNAVAILABLE',
  recentEvents: [],
  assetBreakdown: [],
  exchangeBreakdown: [],
  timeline: [],
  timelineBucketMinutes: 180,
  timelineRangeLabel: '',
  isDemo: false,
  observationStartedAt: null,
  observationDurationMs: 0,
  hasFullObservationWindow: false,
};

const CHART_TIMEFRAMES: Array<{ value: Timeframe; label: string; seconds: number }> = [
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '1h', label: '1h', seconds: 3600 },
  { value: '4h', label: '4h', seconds: 14_400 },
  { value: '1D', label: '1d', seconds: 86_400 },
];

export const LiquidationsPage: React.FC = () => {
  const { provider } = useMarketData();
  const [data, setData] = useState<LiquidationData>(EMPTY_UNAVAILABLE_LIQUIDATIONS);
  const [loading, setLoading] = useState(true);
  const [clusterInput, setClusterInput] = useState<{
    markPrice: number;
    openInterestUsd: number;
    isDemo: boolean;
  } | null>(null);
  const [heatmap, setHeatmap] = useState<ReturnType<typeof LiquidationHeatmapModelBuilder.build>>(null);
  const [streamStates, setStreamStates] = useState<Partial<Record<LiquidationSourceId, LiquidationStreamState>>>({});
  const connectedSources = (Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).filter(
    (id) => streamStates[id] === 'connected',
  );

  // Фильтры журнала (§43). События уже структурированы по бирже/стороне/размеру,
  // поэтому фильтрация локальная и не добавляет сетевых запросов.
  const [filterExchange, setFilterExchange] = useState<'all' | LiquidationSourceId>('all');
  const [filterSide, setFilterSide] = useState<'all' | 'LONG' | 'SHORT'>('all');
  const [filterMinUsd, setFilterMinUsd] = useState<0 | 1000 | 10000 | 100000>(0);

  // Инструмент для секции «Цена и ликвидации» + ряд 1h-свечей под него.
  const [liqSymbol, setLiqSymbol] = useState('BTC');
  const [liqTimeframe, setLiqTimeframe] = useState<Timeframe>('1h');
  const [liqCandles, setLiqCandles] = useState<OHLCV[]>([]);
  const [liqCandlesLoading, setLiqCandlesLoading] = useState(true);
  const [liqCandlesError, setLiqCandlesError] = useState(false);
  const [liqPickerOpen, setLiqPickerOpen] = useState(false);
  const liquidationEvents = useMemo(
    () => data?.dataStatus === 'DEMO' ? [] : (data?.recentEvents ?? []).filter((event) => !event.isDemo),
    [data],
  );

  useEffect(() => {
    let isActive = true;
    const load = () => {
      provider
        .getLiquidations()
        .then((res) => {
          if (!isActive) return;
          setData(res);
          setStreamStates(LiquidationPipeline.getInstance().getStreamStates());
          setLoading(false);
        })
        .catch(() => {
          // Поток ликвидаций недоступен: честное состояние вместо подстановки демо.
          if (!isActive) return;
          // State already contains an honest zero/unavailable snapshot; candles stay visible.
          setLoading(false);
        });
    };

    load();
    // Фактический поток ликвидаций обновляется непрерывно: срез перечитывается,
    // пока страница открыта, иначе агрегаты «замерзают» на первом рендере.
    const timer = setInterval(load, 5000);

    return () => {
      isActive = false;
      clearInterval(timer);
    };
  }, [provider]);

  // Входные метрики расчётной модели берутся из фактического источника (BTC-перпетуал),
  // а не из зашитых констант. Нет метрик — нет модели: подставлять «примерные» числа нельзя.
  useEffect(() => {
    let isActive = true;
    Promise.all([provider.getFuturesList(), provider.getCandles('BTC', '4h')])
      .then(([futures, btcCandles]) => {
        if (!isActive) return;
        const btc = futures.find((f) => f.symbol.toUpperCase().startsWith('BTC'));
        if (btc && btc.markPrice > 0 && btc.openInterest != null && btc.openInterest > 0) {
          // Провенанс входных метрик сохраняется: демо-входы нельзя выдавать за фактический рынок.
          setClusterInput({
            markPrice: btc.markPrice,
            openInterestUsd: btc.openInterest,
            isDemo: btc.isDemo,
          });
          // Карта плотности строится на исторических свечах BTC и тех же метриках модели.
          setHeatmap(
            LiquidationHeatmapModelBuilder.build({
              candles: btcCandles,
              referencePrice: btc.markPrice,
              openInterestUsd: btc.openInterest,
            })
          );
        } else {
          setClusterInput(null);
          setHeatmap(null);
        }
      })
      .catch(() => {
        // Входные метрики модели не получены — карта честно не строится.
        if (!isActive) return;
        setClusterInput(null);
        setHeatmap(null);
      });
    return () => {
      isActive = false;
    };
  }, [provider]);

  // Свечи — независимый REST/WS источник: liquidation events не являются
  // условием создания графика. Live provider делает Binance → KuCoin fallback.
  useEffect(() => {
    let isActive = true;
    let requestInFlight = false;
    setLiqCandles([]);
    setLiqCandlesLoading(true);
    setLiqCandlesError(false);

    const loadCandles = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const candles = await provider.getCandles(liqSymbol, liqTimeframe, 240);
        if (!isActive) return;
        setLiqCandles(candles);
        setLiqCandlesError(false);
      } catch {
        if (!isActive) return;
        // Keep last good history during transient failures; never fabricate bars.
        setLiqCandlesError(true);
      } finally {
        requestInFlight = false;
        if (isActive) setLiqCandlesLoading(false);
      }
    };

    void loadCandles();
    const timer = window.setInterval(() => void loadCandles(), 30_000);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [provider, liqSymbol, liqTimeframe]);

  const estimatedClusters = useMemo(() => {
    if (!clusterInput) return [];
    return LiquidationPipeline.calculateEstimatedClusters(
      clusterInput.markPrice,
      clusterInput.openInterestUsd
    );
  }, [clusterInput]);

  const longPct = data.total24h > 0 ? ((data.totalLong24h / data.total24h) * 100).toFixed(1) : '0.0';
  const shortPct = data.total24h > 0 ? ((data.totalShort24h / data.total24h) * 100).toFixed(1) : '0.0';
  // Масштаб оси баров выводится из фактических данных, а не из зашитой константы
  const timelineMax = Math.max(...data.timeline.map((b) => Math.max(b.longUsd, b.shortUsd)), 0);
  const selectedChartTimeframe = CHART_TIMEFRAMES.find((item) => item.value === liqTimeframe) ?? CHART_TIMEFRAMES[2];
  const chartEvents = liquidationEvents.filter((event) => event.symbol.trim().toUpperCase() === liqSymbol.toUpperCase());

  /**
   * Тиры по размеру (§44). Классификация чисто визуальная: входные значения
   * событий не меняются.
   */
  const sizeTiers = [
    { key: 'lt10k', label: '< $10K', min: 0, max: 10_000 },
    { key: '10k', label: '$10K–$100K', min: 10_000, max: 100_000 },
    { key: '100k', label: '$100K–$1M', min: 100_000, max: 1_000_000 },
    { key: '1m', label: '$1M+', min: 1_000_000, max: Infinity },
  ].map((tier) => {
    const inTier = data.recentEvents.filter((e) => e.amountUsd >= tier.min && e.amountUsd < tier.max);
    return { ...tier, events: inTier.length, usd: inTier.reduce((acc, e) => acc + e.amountUsd, 0) };
  });

  /** Журнал с фильтрами (§42, §43): DOM ограничен 50 строками, остальное — счётчиком. */
  const FEED_LIMIT = 50;
  const filteredEvents = data.recentEvents.filter((e) => {
    if (filterSide !== 'all' && e.side !== filterSide) return false;
    if (e.amountUsd < filterMinUsd) return false;
    if (filterExchange === 'all') return true;
    return e.exchange === LIQUIDATION_SOURCE_LABELS[filterExchange];
  });
  const feedEvents = filteredEvents.slice(0, FEED_LIMIT);
  const feedHidden = Math.max(filteredEvents.length - FEED_LIMIT, 0);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5 font-sans">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-wide">
              Карта и поток ликвидаций
            </h1>
            {loading && (
              <span className="text-[11px] font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/25">ПОЛУЧЕНИЕ ПОТОКА</span>
            )}
            {!loading && data.dataStatus === 'LIVE_STREAM' && (
              <span className="text-[11px] font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE-ПОТОК · {connectedSources.length > 0 ? connectedSources.map((id) => LIQUIDATION_SOURCE_LABELS[id].toUpperCase()).join(' · ') : 'БИРЖИ'}
              </span>
            )}
            {!loading && (data.dataStatus === 'AWAITING_STREAM' || data.dataStatus === 'UNAVAILABLE') && (
              <span className="text-[11px] font-semibold text-slate-300 bg-slate-500/10 px-2.5 py-0.5 rounded-full border border-slate-400/30">
                {data.dataStatus === 'AWAITING_STREAM'
                  ? 'ПОТОК ПОДКЛЮЧЕН · ОЖИДАНИЕ СОБЫТИЙ'
                  : 'ПОТОК ЛИКВИДАЦИЙ НЕДОСТУПЕН'}
              </span>
            )}
            {!loading && data.dataStatus === 'DEMO' && (
              <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA-СРЕЗ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {loading && 'Подключаем поток фактических ликвидаций. Свечной график загружается и обновляется независимо.'}
            {!loading && data.dataStatus === 'LIVE_STREAM' &&
              'Фактические принудительно закрытые позиции по публичным потокам бирж (Binance USD-M forceOrder, Bybit V5 allLiquidation, OKX liquidation-orders). Доли бирж считаются только по подключённым потокам.'}
            {!loading && data.dataStatus === 'AWAITING_STREAM' &&
              'Поток фактических ликвидаций подключен. Агрегаты появятся после первых событий — оценочные числа не подставляются.'}
            {!loading && data.dataStatus === 'UNAVAILABLE' &&
              'Фактический поток ликвидаций недоступен из текущей сети. Терминал не отображает оценочные суммы вместо реальных данных.'}
            {!loading && data.dataStatus === 'DEMO' &&
              'Мониторинг принудительно закрытых маржинальных позиций по биржам на QA-датасете.'}
          </p>
        </div>

        <div className="text-xs text-slate-400 font-sans">
          {loading ? 'Получение фактических событий…' : data.hasFullObservationWindow ? (
            <>Всего ликвидировано за 24ч:{' '}<strong className="text-white font-mono tabular-nums">{formatCurrency(data.total24h, { compact: true })}</strong></>
          ) : data.observationDurationMs > 0 ? (
            <>С момента подключения:{' '}<strong className="text-white font-mono tabular-nums">{formatCurrency(data.total24h, { compact: true })}</strong>{' '}<span className="text-slate-500">· Наблюдение: {formatDuration(data.observationDurationMs)}</span></>
          ) : (
            <>Всего ликвидировано:{' '}<strong className="text-white font-mono tabular-nums">{formatCurrency(data.total24h, { compact: true })}</strong></>
          )}
        </div>
      </div>

      {/* CRITICAL METHODOLOGY DISCLAIMER — компактная форма: принцип виден сразу, полный текст раскрывается */}
      <details className="group bg-amber-500/[0.08] border border-amber-500/30 rounded-xl text-xs font-sans text-slate-300 shadow-panel">
        <summary className="cursor-pointer list-none p-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
          <span className="flex items-center space-x-2 text-amber-300 font-semibold">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>Фактическая ликвидация ≠ расчётный уровень</span>
          </span>
          <span className="text-[11px] text-slate-300 sm:flex-1">
            Слева — публичные события принудительного закрытия (факт); карта уровней — математическая модель по OI и стандартным
            плечам, помечается <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono">MODEL / ESTIMATED</code>.
          </span>
          <span className="text-[11px] text-amber-300/80 whitespace-nowrap group-open:hidden">подробнее ▾</span>
          <span className="text-[11px] text-amber-300/80 whitespace-nowrap hidden group-open:inline">свернуть ▴</span>
        </summary>
        <p className="px-3 pb-3 text-[11px] leading-relaxed text-slate-300">
          <strong>Фактическое событие ликвидации:</strong> Публичный биржевой ордер принудительного закрытия позиции при наступлении маржин-колла. Это подтвержденный свершившийся факт.<br />
          <strong>Расчётный ликвидационный уровень:</strong> Математическая гипотетическая модель, построенная на оценке открытого интереса и стандартных плеч (10x, 25x, 50x, 100x). Трейдеры могут довносить обеспечение, закрывать сделки лимитными ордерами или хеджироваться на других площадках. CRYPTORA не обладает и не заявляет доступ к скрытым персональным ликвидационным уровням пользователей бирж. Любая тепловая карта уровней обязана маркироваться как <code className="bg-slate-800 px-1.5 py-0.5 rounded text-amber-300 font-mono">MODEL / ESTIMATED</code> (расчётная модель).
        </p>
      </details>

      {/* Terminal chart: candles are independent of the actual liquidation stream. */}
      <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-surface shadow-[0_18px_50px_rgba(0,0,0,.24)]" data-qa="liquidation-terminal">
        <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide text-white">Цена и ликвидации</h2>
              <span className="rounded border border-cyan-400/20 bg-cyan-400/[0.07] px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-cyan-300">MARKET TERMINAL</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Фактические ликвидации отображаются поверх независимой истории свечей.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border border-white/[0.08] bg-surface-inset p-0.5" role="group" aria-label="Таймфрейм графика">
              {CHART_TIMEFRAMES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setLiqTimeframe(item.value)}
                  aria-pressed={liqTimeframe === item.value}
                  className={`rounded px-2 py-1.5 font-mono text-[11px] transition-colors ${liqTimeframe === item.value ? 'bg-cyan-400/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,.18)]' : 'text-slate-500 hover:text-slate-200'}`}
                  data-qa={`liq-timeframe-${item.label}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLiqPickerOpen(true)}
              data-qa="liq-picker-open"
              className="flex items-center gap-2 rounded-md border border-white/[0.1] bg-surface-elevated px-3 py-2 font-mono text-[11px] font-bold text-slate-100 transition hover:border-cyan-300/35 hover:text-cyan-200"
              title="Выбрать инструмент для графика"
            >
              {liqSymbol}/USDT <span className="text-slate-500">⌄</span>
            </button>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 p-2 sm:p-3">
            <LiquidationPriceChart
              candles={liqCandles}
              events={chartEvents}
              symbol={liqSymbol}
              timeframe={liqTimeframe}
              timeframeSec={selectedChartTimeframe.seconds}
              loading={liqCandlesLoading}
              error={liqCandlesError}
            />
          </div>
          <aside className="border-t border-white/[0.07] bg-surface-inset xl:border-l xl:border-t-0" aria-label="Лента ликвидаций">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <h3 className="text-[11px] font-bold tracking-wide text-slate-200">LIVE LIQUIDATIONS</h3>
                <p className="mt-0.5 text-[11px] text-slate-600">Фактические события · {liqSymbol}/USDT</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-2 py-1 font-mono text-[11px] text-emerald-300">
                <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{chartEvents.length} EVENTS
              </span>
            </div>
            <div className="grid grid-cols-[55px_minmax(0,1fr)_68px] gap-2 border-b border-white/[0.05] px-4 py-2 text-[11px] uppercase tracking-wider text-slate-600">
              <span>Time</span><span>Symbol · Exchange</span><span className="text-right">Side / USD</span>
            </div>
            {chartEvents.length === 0 ? (
              <div className="flex min-h-[184px] flex-col items-center justify-center px-5 text-center" data-qa="liq-chart-feed-empty">
                <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.025] text-slate-600"><Flame className="h-3.5 w-3.5" /></span>
                <p className="text-[11px] font-medium text-slate-400">Событий пока нет</p>
                <p className="mt-1 max-w-[190px] text-[11px] leading-relaxed text-slate-600">Поток биржевых ликвидаций пуст. История цены продолжает обновляться независимо.</p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {[...chartEvents].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 30).map((event) => (
                  <div key={event.id} className="grid grid-cols-[55px_minmax(0,1fr)_68px] items-center gap-2 border-b border-white/[0.035] px-4 py-2.5 transition-colors hover:bg-white/[0.025]">
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">{new Date(event.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11px] font-semibold text-slate-200">{event.symbol}/USDT</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-600">{event.exchange}</span>
                    </span>
                    <span className="text-right">
                      <span className={`block font-mono text-[11px] font-bold ${event.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>{event.side}</span>
                      <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-slate-300">{formatCurrency(event.amountUsd, { compact: true })}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-white/[0.06] px-4 py-2 font-sans text-[11px] text-slate-600">
              0 событий — корректное состояние; расчётные уровни не показываются как ликвидации.
            </div>
          </aside>
        </div>
      </section>
      <SymbolPickerModal
        open={liqPickerOpen}
        onClose={() => setLiqPickerOpen(false)}
        onSelect={setLiqSymbol}
        current={liqSymbol}
        title="Инструмент для графика ликвидаций"
      />

      {/* Aggregate Long/Short Ratio Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 tracking-wide">Ликвидировано лонгов{data.hasFullObservationWindow ? ' (24ч)' : data.observationDurationMs > 0 ? ' (наблюдение)' : ''}</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums font-mono">
            {formatCurrency(data.totalLong24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            {data.total24h > 0 ? `${longPct}% от общего объема` : 'Нет фактических событий за 24ч'}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 tracking-wide">Ликвидировано шортов{data.hasFullObservationWindow ? ' (24ч)' : data.observationDurationMs > 0 ? ' (наблюдение)' : ''}</div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums font-mono">
            {formatCurrency(data.totalShort24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            {data.total24h > 0 ? `${shortPct}% от общего объема (Short Squeeze)` : 'Нет фактических событий за 24ч'}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 tracking-wide">Крупнейшее единичное событие</div>
          {data.largestEvent ? (
            <>
              <div className="text-2xl font-black text-white mt-1 tabular-nums font-mono">
                {formatCurrency(data.largestEvent.amountUsd, { compact: true })}
              </div>
              <div className="text-[11px] text-rose-300 mt-0.5">
                {data.largestEvent.symbol} ({sideLabel(data.largestEvent.side).toLowerCase()}) на {data.largestEvent.exchange}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-black text-slate-500 mt-1 tabular-nums font-mono">—</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Фактических событий ещё не поступало</div>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar: только при наличии фактических событий */}
      {data.total24h > 0 && (
      <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-emerald-400 font-bold tabular-nums font-mono">Long: {longPct}%</span>
          <span className="text-rose-400 font-bold tabular-nums font-mono">Short: {shortPct}%</span>
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-surface-elevated">
          <div className="bg-emerald-500 h-full" style={{ width: `${longPct}%` }} />
          <div className="bg-rose-500 h-full" style={{ width: `${shortPct}%` }} />
        </div>
      </div>
      )}

      {/* Timeline & Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start">
        {/* Timeline Visualization (8 cols) */}
        <div className="lg:col-span-8 bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3.5 shadow-panel">
          <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-bold text-white tracking-wide flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Хронология ликвидаций по 3-часовым барам за 24ч</span>
            </span>
            <span className="text-[11px] text-slate-400">Бары по UTC</span>
          </div>

          {/* Bar Chart: фактическое распределение событий по 3-часовым барам */}
          {timelineMax === 0 && (
            <div className="text-xs text-slate-500 font-sans py-2">
              {data.dataStatus === 'AWAITING_STREAM'
                ? 'Поток подключен, фактических событий за 24ч пока нет. Хронология заполнится автоматически.'
                : 'Фактический поток ликвидаций недоступен — выдуманные бары не отображаются.'}
            </div>
          )}
          <div className={`h-56 flex items-end justify-between pt-6 px-2 gap-2 ${timelineMax === 0 ? 'hidden' : ''}`}>
            {data.timeline.map((bar, idx) => {
              const longHeight = (bar.longUsd / timelineMax) * 160;
              const shortHeight = (bar.shortUsd / timelineMax) * 160;

              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div className="w-full flex items-end justify-center space-x-1 mb-1">
                    {/* Long bar */}
                    <div
                      style={{ height: `${Math.max(4, longHeight)}px` }}
                      className="w-1/2 bg-emerald-500/80 rounded-t group-hover:bg-emerald-400 transition-colors"
                      title={`Long: ${formatCurrency(bar.longUsd, { compact: true })}`}
                    />
                    {/* Short bar */}
                    <div
                      style={{ height: `${Math.max(4, shortHeight)}px` }}
                      className="w-1/2 bg-rose-500/80 rounded-t group-hover:bg-rose-400 transition-colors"
                      title={`Short: ${formatCurrency(bar.shortUsd, { compact: true })}`}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 group-hover:text-white tabular-nums font-mono">
                    {bar.timestamp}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center space-x-6 text-[11px] pt-2 border-t border-white/[0.06] text-slate-400">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-emerald-500 rounded"></span>
              <span>Ликвидации лонгов</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-rose-500 rounded"></span>
              <span>Ликвидации шортов</span>
            </div>
          </div>
        </div>

        {/* Exchange & Asset Breakdowns (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Exchange Breakdown */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white tracking-wide pb-2 border-b border-white/[0.06] flex items-center justify-between">
              <span>Распределение по биржам</span>
              {data.dataStatus !== 'DEMO' && (
                <span className="text-[11px] font-mono text-slate-400">
                  {connectedSources.length}/3 потоков
                </span>
              )}
            </div>
            {data.dataStatus !== 'DEMO' && (
              <ul className="flex flex-wrap gap-1.5 text-[11px] font-sans" aria-label="Состояние потоков ликвидаций по биржам">
                {(Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).map((id) => {
                  const st = streamStates[id] ?? 'idle';
                  const cls =
                    st === 'connected'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : st === 'connecting' || st === 'reconnecting'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        : 'border-surface-border bg-surface-elevated text-slate-400';
                  const label =
                    st === 'connected' ? 'поток' : st === 'connecting' ? 'подключение' : st === 'reconnecting' ? 'переподключение' : 'недоступен';
                  return (
                    <li key={id} className={`rounded border px-1.5 py-0.5 ${cls}`} data-qa={`liq-source-${id}`} data-state={st}>
                      <span className="font-mono">{LIQUIDATION_SOURCE_LABELS[id]}</span> · {label}
                    </li>
                  );
                })}
              </ul>
            )}
            {/*
              Честная подпись отсутствия данных. Условие — «нет фактических событий»,
              а не «пустой список бирж»: после §40 пайплайн всегда перечисляет ВСЕ
              биржи (нуль — валидное наблюдение «поток жив, событий не было»),
              поэтому `exchangeBreakdown.length === 0` больше не наступал никогда
              и плашка исчезла бы навсегда.
            */}
            {data.eventsCount24h === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">
                Разбивка появится после первых фактических событий потока. Доли неподключённых бирж не оцениваются.
              </div>
            )}
            <div className="space-y-2.5 text-xs">
              {data.exchangeBreakdown.map((ex) => (
                <div key={ex.exchange} className="space-y-1">
                  <div className="flex justify-between tabular-nums font-mono">
                    <span className="text-white font-semibold">{ex.exchange}</span>
                    <span className="text-slate-300 font-mono tabular-nums">
                      {formatCurrency(ex.totalUsd, { compact: true })} ({ex.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                    <div
                      className="bg-cyan-400 h-full rounded-full"
                      style={{ width: `${ex.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Asset Liquidation Totals */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white tracking-wide pb-2 border-b border-white/[0.06]">
              Топ активов по ликвидациям
            </div>
            {data.assetBreakdown.length === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">
                Данных по активам пока нет — суммы не подставляются оценочно.
              </div>
            )}
            <div className="space-y-1.5 text-xs">
              {data.assetBreakdown.slice(0, 5).map((ab) => (
                <div
                  key={ab.symbol}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/60 hover:bg-surface-hover transition-colors border border-white/[0.04]"
                >
                  <span className="font-bold text-white">{ab.symbol}</span>
                  <div className="text-right tabular-nums font-mono">
                    <span className="font-bold text-slate-200 font-mono tabular-nums">
                      {formatCurrency(ab.totalUsd, { compact: true })}
                    </span>
                    <span className="text-[11px] text-rose-400 block">
                      Shorts: {formatCurrency(ab.shortUsd, { compact: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Size tiers (§44): классификация фактических событий, значения не меняются */}
          {data.recentEvents.length > 0 && (
            <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-2.5 shadow-panel">
              <div className="text-xs font-bold text-white tracking-wide pb-2 border-b border-white/[0.06]">
                Крупные ликвидации · тиры
              </div>
              <div className="space-y-2 text-[11px]">
                {sizeTiers.map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-2">
                    <span className="text-slate-400 font-mono shrink-0">{t.label}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                      <span
                        className="block h-full bg-amber-400/70 rounded-full"
                        style={{ width: `${(t.events / data.recentEvents.length) * 100}%` }}
                      />
                    </span>
                    <span className="text-slate-300 font-mono tabular-nums shrink-0 text-right">
                      {t.events} · {t.usd > 0 ? formatCurrency(t.usd, { compact: true }) : '$0'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-500 font-sans pt-1 border-t border-white/[0.06]">
                Тиры считаются по событиям текущего журнала и охватывают {data.recentEvents.length} из {data.eventsCount24h} событий окна.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Тепловая карта плотности (цена × время) — расчетная модель */}
      <LiquidationHeatmap
        model={heatmap}
        unavailableNote={
          'Исторические свечи BTC недоступны из текущего источника — карта не строится на выдуманных данных.'
        }
      />

      {/* Estimated Liquidation Clusters (Model Simulation) */}
      <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white tracking-wide">
              Расчётные уровни ликвидаций по плечам
            </span>
          </div>
          <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-500/30">
            MODEL / ESTIMATED
          </span>
        </div>

        <p className="text-xs text-slate-400 font-sans leading-relaxed">
          {clusterInput
            ? clusterInput.isDemo
              ? `Расчётные ценовые уровни принудительного закрытия позиций с плечами 10x–100x, построенные на демонстрационных входных метриках BTC (метка ${formatCurrency(clusterInput.markPrice)}, открытый интерес ${formatCurrency(clusterInput.openInterestUsd, { compact: true })}) — фактический источник фьючерсных метрик недоступен. Это модель, а не фактический ордер биржевого стакана.`
              : `Расчётные ценовые уровни принудительного закрытия позиций с плечами 10x–100x, построенные от фактической метки BTC ${formatCurrency(clusterInput.markPrice)} и открытого интереса ${formatCurrency(clusterInput.openInterestUsd, { compact: true })}. Это модель, а не фактический ордер биржевого стакана.`
            : 'Расчётная модель недоступна: нет входных метрик (метка цены и открытый интерес) по BTC. Модель не строится на приблизительных числах.'}
        </p>

        {!clusterInput && (
          <div className="text-xs text-slate-500 font-sans py-2">
            Значения появятся автоматически при получении метрик фьючерсного рынка.
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {estimatedClusters.map((c, idx) => (
            <div
              key={idx}
              className={`p-2.5 rounded border text-xs space-y-1 ${
                c.side === 'LONG'
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={c.side === 'LONG' ? 'text-brand-green font-bold' : 'text-brand-red font-bold'}>
                  {c.leverageTier}x {sideLabel(c.side).toLowerCase()}
                </span>
                <span className="text-slate-400">±{c.distancePct}%</span>
              </div>
              <div className="text-sm font-bold text-white font-mono tabular-nums">
                {formatCurrency(c.priceLevel)}
              </div>
              <div className="text-[11px] text-slate-400">
                Объем под риском: {formatCurrency(c.estimatedVolumeUsd, { compact: true })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Actual Events Feed Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Flame className="w-4 h-4 text-rose-500" />
            <span className="text-xs font-bold text-white tracking-wide">
              {data.dataStatus === 'DEMO'
                ? 'Журнал событий ликвидаций QA-датасета'
                : 'Журнал фактических событий ликвидаций'}
            </span>
          </div>
          {data.dataStatus === 'DEMO' ? (
            <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
              QA-ДАТАСЕТ
            </span>
          ) : (
            <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/30">
              {connectedSources.length > 0 ? connectedSources.map((id) => LIQUIDATION_SOURCE_LABELS[id].toUpperCase()).join(' · ') : 'ПОТОКИ БИРЖ'}
            </span>
          )}
        </div>

        {/* Фильтры журнала (§43). Структура данных позволяет фильтровать корректно. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-sans">
          <label className="flex items-center gap-1.5 text-slate-400">
            <span>Биржа</span>
            <select
              value={filterExchange}
              onChange={(e) => setFilterExchange(e.target.value as 'all' | LiquidationSourceId)}
              className="bg-surface-elevated border border-surface-border rounded px-1.5 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              data-qa="liq-filter-exchange"
            >
              <option value="all">Все</option>
              {(Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).map((id) => (
                <option key={id} value={id}>{LIQUIDATION_SOURCE_LABELS[id]}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400">
            <span>Сторона</span>
            <select
              value={filterSide}
              onChange={(e) => setFilterSide(e.target.value as 'all' | 'LONG' | 'SHORT')}
              className="bg-surface-elevated border border-surface-border rounded px-1.5 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              data-qa="liq-filter-side"
            >
              <option value="all">Все</option>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400">
            <span>Мин. размер</span>
            <select
              value={String(filterMinUsd)}
              onChange={(e) => setFilterMinUsd(Number(e.target.value) as 0 | 1000 | 10000 | 100000)}
              className="bg-surface-elevated border border-surface-border rounded px-1.5 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              data-qa="liq-filter-size"
            >
              <option value="0">Все</option>
              <option value="1000">$1K+</option>
              <option value="10000">$10K+</option>
              <option value="100000">$100K+</option>
            </select>
          </label>

          <span className="text-slate-500 font-mono tabular-nums ml-auto" data-qa="liq-feed-count">
            {feedEvents.length} из {data.recentEvents.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-slate-400 text-[11px] border-b border-surface-border">
              <tr>
                <th className="py-2">Время</th>
                <th className="py-2">Инструмент</th>
                <th className="py-2">Сторона</th>
                <th className="py-2 text-right">Объем (USD)</th>
                <th className="py-2 text-right">Цена исполнения</th>
                <th className="py-2 text-right">Биржа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {feedEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                    {data.recentEvents.length === 0
                      ? data.dataStatus === 'AWAITING_STREAM'
                        ? 'Журнал пуст: поток подключен, фактические события принудительного закрытия ещё не поступали.'
                        : 'Журнал пуст: фактический поток ликвидаций недоступен. Плейсхолдеры-события не подставляются.'
                      : 'Под текущие фильтры не подходит ни одно событие.'}
                  </td>
                </tr>
              )}
              {feedEvents.map((event) => (
                <tr key={event.id} className="hover:bg-surface-hover">
                  <td className="py-2 text-slate-400 font-mono tabular-nums whitespace-nowrap">{formatTimestamp(event.timestamp)}</td>
                  <td className="py-2 font-bold text-white">{event.symbol}</td>
                  <td className="py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                        event.side === 'LONG'
                          ? 'bg-emerald-950 text-brand-green border border-emerald-500/30'
                          : 'bg-rose-950 text-brand-red border border-rose-500/30'
                      }`}
                    >
                      {sideLabel(event.side)}
                    </span>
                  </td>
                  <td className="py-2 text-right font-bold text-white font-mono tabular-nums">
                    {formatCurrency(event.amountUsd, { compact: true })}
                  </td>
                  <td className="py-2 text-right text-slate-300 font-mono tabular-nums">
                    {formatCurrency(event.price)}
                  </td>
                  <td className="py-2 text-right text-brand-cyan">{event.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* DOM ограничен (§42): не более 50 строк, остальное — счётчиком. */}
        {feedHidden > 0 && (
          <div className="text-[11px] text-slate-500 font-sans pt-1 border-t border-surface-border">
            Показаны последние {FEED_LIMIT} событий, ещё {feedHidden} не отображаются.
          </div>
        )}
      </div>
    </div>
  );
};
