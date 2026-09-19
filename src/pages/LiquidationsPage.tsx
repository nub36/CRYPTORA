import React, { useEffect, useState, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { LiquidationPipeline, LIQUIDATION_SOURCE_LABELS, type LiquidationSourceId, type LiquidationStreamState } from '@/services/liquidations/LiquidationPipeline';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { LiquidationData } from '@/types/market';
import { formatCurrency, formatTimestamp, formatDuration } from '@/utils/formatters';
import { sideLabel } from '@/utils/labels';
import { LiquidationHeatmapModelBuilder } from '@/services/liquidations/LiquidationHeatmap';
import { LiquidationHeatmap } from '@/components/market/LiquidationHeatmap';
import { Flame, ShieldAlert, Clock, Layers } from 'lucide-react';

export const LiquidationsPage: React.FC = () => {
  const { provider } = useMarketData();
  const [data, setData] = useState<LiquidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [clusterInput, setClusterInput] = useState<{
    markPrice: number;
    openInterestUsd: number;
    isDemo: boolean;
  } | null>(null);
  const [heatmap, setHeatmap] = useState<ReturnType<typeof LiquidationHeatmapModelBuilder.build>>(null);
  const [streamStates, setStreamStates] = useState<Partial<Record<LiquidationSourceId, LiquidationStreamState>>>({});
  // Фильтры журнала (§43). Данные уже структурированы по биржам/стороне/размеру,
  // поэтому фильтр корректен; новых сетевых запросов он не добавляет.
  const [filterExchange, setFilterExchange] = useState<'all' | LiquidationSourceId>('all');
  const [filterSide, setFilterSide] = useState<'all' | 'LONG' | 'SHORT'>('all');
  const [filterMinUsd, setFilterMinUsd] = useState<0 | 1000 | 10000 | 100000>(0);
  const connectedSources = (Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).filter(
    (id) => streamStates[id] === 'connected',
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
          setSourceUnavailable(false);
          setLoading(false);
        })
        .catch(() => {
          // Поток ликвидаций недоступен: честное состояние вместо подстановки демо.
          if (!isActive) return;
          setSourceUnavailable(true);
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
        if (btc && btc.markPrice > 0 && btc.openInterest > 0) {
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

  const estimatedClusters = useMemo(() => {
    if (!clusterInput) return [];
    return LiquidationPipeline.calculateEstimatedClusters(
      clusterInput.markPrice,
      clusterInput.openInterestUsd
    );
  }, [clusterInput]);

  if (!loading && sourceUnavailable && !data) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-2xl items-center px-4">
        <DataSourceUnavailable subject="поток ликвидаций" />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-sans text-sm">
        <Flame className="w-5 h-5 animate-spin mr-2 text-rose-500" />
        Загрузка аналитики ликвидаций...
      </div>
    );
  }

  const longPct = data.total24h > 0 ? ((data.totalLong24h / data.total24h) * 100).toFixed(1) : '0.0';
  const shortPct = data.total24h > 0 ? ((data.totalShort24h / data.total24h) * 100).toFixed(1) : '0.0';
  // Масштаб оси баров выводится из фактических данных, а не из зашитой константы
  const timelineMax = Math.max(...data.timeline.map((b) => Math.max(b.longUsd, b.shortUsd)), 0);

  /** Период наблюдения в человекочитаемом виде (§33). */
  const observationLabel = data.observationDurationMs > 0 ? formatDuration(data.observationDurationMs) : null;
  /** Честная подпись периода: «24ч» только при реально покрытом окне (§31, §50, §55). */
  const periodLabel = data.hasFullObservationWindow ? '24ч' : observationLabel ? 'с момента подключения' : '—';
  /** Отношение Long/Short по фактическим суммам (§36). */
  const longShortRatio =
    data.totalShort24h > 0
      ? (data.totalLong24h / data.totalShort24h).toFixed(2)
      : data.totalLong24h > 0
        ? '∞'
        : null;
  /** Число событий по стороне — для карточек Long/Short (§34). */
  const longEvents = data.assetBreakdown.reduce((acc, a) => acc + a.longEvents, 0);
  const shortEvents = data.assetBreakdown.reduce((acc, a) => acc + a.shortEvents, 0);

  /**
   * Тиры по размеру (§44). Классификация чисто визуальная: входные значения
   * не меняются.
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

  /** Журнал с фильтрами (§42, §43); DOM ограничен 50 строками. */
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
            {data.dataStatus === 'LIVE_STREAM' && (
              <span className="text-[11px] font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE-ПОТОК · {connectedSources.length > 0 ? connectedSources.map((id) => LIQUIDATION_SOURCE_LABELS[id].toUpperCase()).join(' · ') : 'БИРЖИ'}
              </span>
            )}
            {(data.dataStatus === 'AWAITING_STREAM' || data.dataStatus === 'UNAVAILABLE') && (
              <span className="text-[11px] font-semibold text-slate-300 bg-slate-500/10 px-2.5 py-0.5 rounded-full border border-slate-400/30">
                {data.dataStatus === 'AWAITING_STREAM'
                  ? 'ПОТОК ПОДКЛЮЧЕН · ОЖИДАНИЕ СОБЫТИЙ'
                  : 'ПОТОК ЛИКВИДАЦИЙ НЕДОСТУПЕН'}
              </span>
            )}
            {data.dataStatus === 'DEMO' && (
              <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {data.dataStatus === 'LIVE_STREAM' &&
              'Фактические принудительно закрытые позиции по публичным потокам бирж (Binance USD-M forceOrder, Bybit V5 allLiquidation, OKX liquidation-orders). Доли бирж считаются только по подключённым потокам.'}
            {data.dataStatus === 'AWAITING_STREAM' &&
              'Поток фактических ликвидаций подключен. Агрегаты появятся после первых событий — оценочные числа не подставляются.'}
            {data.dataStatus === 'UNAVAILABLE' &&
              'Фактический поток ликвидаций недоступен из текущей сети. Терминал не отображает оценочные суммы вместо реальных данных.'}
            {data.dataStatus === 'DEMO' &&
              'Мониторинг принудительно закрытых маржинальных позиций по биржам на QA-датасете.'}
          </p>
        </div>

      </div>

      {/*
        Компактная сводка наблюдения (§33). Все значения вычисляются из
        фактического состояния конвейера; «24ч» появляется только когда окно
        действительно покрыто (§31, §50, §55).
      */}
      <div
        className="bg-surface border border-white/[0.08] rounded-xl px-3 py-2.5 shadow-panel grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-2"
        data-qa="liq-summary"
      >
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Статус</div>
          <div className="text-xs font-bold truncate" data-qa="liq-status">
            {data.dataStatus === 'LIVE_STREAM' ? (
              <span className="text-cyan-300">LIVE</span>
            ) : data.dataStatus === 'AWAITING_STREAM' ? (
              <span className="text-amber-300">ОЖИДАНИЕ</span>
            ) : data.dataStatus === 'DEMO' ? (
              <span className="text-amber-300">QA</span>
            ) : (
              <span className="text-slate-400">НЕДОСТУПЕН</span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Потоки</div>
          <div className="text-xs font-bold text-white tabular-nums font-mono">{connectedSources.length}/3</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Событий</div>
          <div className="text-xs font-bold text-white tabular-nums font-mono" data-qa="liq-events-count">
            {data.eventsCount24h}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Период наблюдения</div>
          <div className="text-xs font-bold text-white tabular-nums font-mono" data-qa="liq-period">
            {observationLabel ?? '—'}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Получено с момента</div>
          <div className="text-xs font-bold text-white tabular-nums font-mono truncate">
            {data.observationStartedAt ? formatTimestamp(new Date(data.observationStartedAt).toISOString()) : '—'}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">Общий объём · {periodLabel}</div>
          <div className="text-xs font-bold text-white tabular-nums font-mono" data-qa="liq-total">
            {data.total24h > 0 ? formatCurrency(data.total24h, { compact: true }) : '—'}
          </div>
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

      {/* Long / Short / Largest (§34, §35) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Long Liquidations */}
        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel" data-qa="liq-long-card">
          <div className="text-xs text-slate-400 tracking-wide">Long Liquidations</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums font-mono">
            {data.totalLong24h > 0 ? formatCurrency(data.totalLong24h, { compact: true }) : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            {data.total24h > 0 ? `${longPct}% от объёма` : 'Нет фактических событий'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono" data-qa="liq-long-events">
            {longEvents} {longEvents === 1 ? 'событие' : longEvents >= 2 && longEvents <= 4 ? 'события' : 'событий'}
          </div>
        </div>

        {/* Short Liquidations */}
        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel" data-qa="liq-short-card">
          <div className="text-xs text-slate-400 tracking-wide">Short Liquidations</div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums font-mono">
            {data.totalShort24h > 0 ? formatCurrency(data.totalShort24h, { compact: true }) : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            {data.total24h > 0 ? `${shortPct}% от объёма` : 'Нет фактических событий'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono" data-qa="liq-short-events">
            {shortEvents} {shortEvents === 1 ? 'событие' : shortEvents >= 2 && shortEvents <= 4 ? 'события' : 'событий'}
          </div>
        </div>

        {/* Largest Liquidation */}
        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 shadow-panel sm:col-span-2 lg:col-span-1" data-qa="liq-largest-card">
          <div className="text-xs text-slate-400 tracking-wide">Largest Liquidation</div>
          {data.largestEvent ? (
            <>
              <div className="text-2xl font-black text-white mt-1 tabular-nums font-mono">
                {formatCurrency(data.largestEvent.amountUsd, { compact: true })}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-sans">
                <span className="font-bold text-white">{data.largestEvent.symbol}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-bold border ${
                    data.largestEvent.side === 'LONG'
                      ? 'bg-emerald-950 text-brand-green border-emerald-500/30'
                      : 'bg-rose-950 text-brand-red border-rose-500/30'
                  }`}
                >
                  {data.largestEvent.side}
                </span>
                <span className="text-slate-400">{data.largestEvent.exchange}</span>
              </div>
              {/* Цена и время берутся только из payload биржи: если их нет — не выдумываем (§35). */}
              <div className="mt-1 text-[11px] text-slate-400 font-mono tabular-nums">
                {data.largestEvent.price > 0 ? <>Price: {formatCurrency(data.largestEvent.price)}</> : <>Price: —</>}
                <span className="text-slate-600"> · </span>
                {formatTimestamp(data.largestEvent.timestamp)} UTC
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

      {/* Long/Short ratio (§36): доли + отношение. Выводов о направлении рынка не делается. */}
      {data.total24h > 0 && (
      <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs mb-2">
          <span className="text-emerald-400 font-bold tabular-nums font-mono">Long {longPct}%</span>
          {longShortRatio !== null && (
            <span className="text-slate-400 tabular-nums font-mono" data-qa="liq-ratio">
              Long/Short liquidation ratio: <span className="text-white font-bold">{longShortRatio}</span>
            </span>
          )}
          <span className="text-rose-400 font-bold tabular-nums font-mono">Short {shortPct}%</span>
        </div>
        <div
          className="w-full h-3 rounded-full overflow-hidden flex bg-surface-elevated"
          role="img"
          aria-label={`Доля ликвидаций: Long ${longPct}%, Short ${shortPct}%`}
        >
          <div className="bg-emerald-500 h-full" style={{ width: `${longPct}%` }} />
          <div className="bg-rose-500 h-full" style={{ width: `${shortPct}%` }} />
        </div>
      </div>
      )}

      {/* Timeline & Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start">
        {/* Timeline Visualization (8 cols) */}
        <div className="lg:col-span-8 bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3.5 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-bold text-white tracking-wide flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              {/* Честный заголовок (§37): 24ч — только при реально покрытом окне. */}
              <span data-qa="liq-timeline-title">
                {data.hasFullObservationWindow
                  ? 'Liquidations Timeline · 24ч'
                  : 'Liquidations Timeline · с момента подключения'}
              </span>
            </span>
            <span className="text-[11px] text-slate-400">
              {data.timelineBucketMinutes >= 60
                ? `Бары ${data.timelineBucketMinutes / 60}ч · UTC`
                : `Бары ${data.timelineBucketMinutes}м · UTC`}
            </span>
          </div>

          {/*
            Фактический период наблюдения (§31, §37, §55). Бакеты вне наблюдения
            конвейер не строит вовсе — пустые часы не выдаются за наблюдения.
          */}
          {data.timelineRangeLabel && (
            <div className="text-[11px] text-slate-400 font-mono tabular-nums" data-qa="liq-timeline-range">
              {data.timelineRangeLabel}
            </div>
          )}

          {/* Bar Chart: фактическое распределение событий по адаптивным барам (§38) */}
          {timelineMax === 0 && (
            <div className="text-xs text-slate-500 font-sans py-2">
              {data.dataStatus === 'AWAITING_STREAM'
                ? 'Поток подключен, фактических событий пока нет. Хронология заполнится автоматически.'
                : 'Фактический поток ликвидаций недоступен — выдуманные бары не отображаются.'}
            </div>
          )}
          <div className={`h-56 flex items-end justify-between pt-6 px-2 gap-1 sm:gap-2 overflow-x-auto ${timelineMax === 0 ? 'hidden' : ''}`}>
            {data.timeline.map((bar, idx) => {
              const longHeight = (bar.longUsd / timelineMax) * 160;
              const shortHeight = (bar.shortUsd / timelineMax) * 160;
              // Тултип (§39): время, стороны, итого, число событий.
              const tooltip = [
                `${bar.timestamp} UTC`,
                `Long: ${formatCurrency(bar.longUsd, { compact: true })}`,
                `Short: ${formatCurrency(bar.shortUsd, { compact: true })}`,
                `Total: ${formatCurrency(bar.totalUsd, { compact: true })}`,
                `Events: ${bar.eventCount}`,
              ].join('\n');

              return (
                <div
                  key={idx}
                  className="flex-1 min-w-[14px] flex flex-col items-center h-full justify-end group"
                  title={tooltip}
                  data-observed={bar.observed ? 'true' : 'false'}
                  data-qa={`liq-bar-${idx}`}
                >
                  <div className="w-full flex items-end justify-center space-x-0.5 sm:space-x-1 mb-1">
                    <div
                      style={{ height: `${Math.max(4, longHeight)}px` }}
                      className={`w-1/2 rounded-t group-hover:bg-emerald-400 transition-colors ${
                        bar.observed ? 'bg-emerald-500/80' : 'bg-emerald-500/25'
                      }`}
                    />
                    <div
                      style={{ height: `${Math.max(4, shortHeight)}px` }}
                      className={`w-1/2 rounded-t group-hover:bg-rose-400 transition-colors ${
                        bar.observed ? 'bg-rose-500/80' : 'bg-rose-500/25'
                      }`}
                    />
                  </div>
                  <span className="text-[11px] sm:text-[11px] text-slate-400 group-hover:text-white tabular-nums font-mono">
                    {bar.timestamp}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[11px] pt-2 border-t border-white/[0.06] text-slate-400">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-emerald-500 rounded"></span>
              <span>Long</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-rose-500 rounded"></span>
              <span>Short</span>
            </div>
          </div>
        </div>

        {/* Exchange & Asset Breakdowns (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Exchange Distribution (§40, §48): все биржи, включая нулевые */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white tracking-wide pb-2 border-b border-white/[0.06] flex items-center justify-between">
              <span>Exchange Distribution</span>
              {data.dataStatus !== 'DEMO' && (
                <span className="text-[11px] font-mono text-slate-400">{connectedSources.length}/3 потоков</span>
              )}
            </div>

            {data.dataStatus !== 'DEMO' ? (
              <ul className="space-y-1.5 text-[11px] font-sans" aria-label="Состояние потоков ликвидаций по биржам">
                {data.exchangeBreakdown.map((ex) => {
                  const st = ex.state;
                  const badge =
                    st === 'connected'
                      ? { txt: 'LIVE', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
                      : st === 'connecting'
                        ? { txt: 'CONNECTING', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' }
                        : st === 'reconnecting'
                          ? { txt: 'RECONNECTING', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' }
                          : { txt: 'OFFLINE', cls: 'border-surface-border bg-surface-elevated text-slate-400' };
                  const sourceId = (Object.keys(LIQUIDATION_SOURCE_LABELS) as LiquidationSourceId[]).find(
                    (id) => LIQUIDATION_SOURCE_LABELS[id] === ex.exchange
                  );
                  return (
                    <li
                      key={ex.exchange}
                      className="rounded-lg border border-white/[0.05] bg-surface-elevated/50 px-2 py-1.5 space-y-1"
                      data-qa={`liq-source-${sourceId ?? ex.exchange.toLowerCase()}`}
                      data-state={st}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-white font-semibold truncate">{ex.exchange}</span>
                        <span className={`rounded border px-1.5 py-0.5 font-mono shrink-0 ${badge.cls}`}>{badge.txt}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 tabular-nums font-mono">
                        <span className="text-slate-300">
                          {ex.totalUsd > 0 ? formatCurrency(ex.totalUsd, { compact: true }) : '$0'}
                          <span className="text-slate-500"> ({ex.percentage}%)</span>
                        </span>
                        <span className="text-slate-400">
                          {ex.eventCount} {ex.eventCount === 1 ? 'событие' : ex.eventCount >= 2 && ex.eventCount <= 4 ? 'события' : 'событий'}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                        <div className="bg-cyan-400 h-full rounded-full" style={{ width: `${ex.percentage}%` }} />
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {ex.lastEventAt ? `Last event: ${formatTimestamp(ex.lastEventAt)} UTC` : 'Last event: —'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
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
                      <div className="bg-cyan-400 h-full rounded-full" style={{ width: `${ex.percentage}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Assets (§41): Symbol · Total · Long · Short · Events · Largest */}
          <div className="bg-surface border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white tracking-wide pb-2 border-b border-white/[0.06]">
              Топ активов по ликвидациям
            </div>
            {data.assetBreakdown.length === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">
                Данных по активам пока нет — суммы не подставляются оценочно.
              </div>
            )}

            {/* Десктоп: таблица */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[11px] text-left">
                <thead className="text-slate-500 border-b border-white/[0.06]">
                  <tr>
                    <th className="py-1.5 font-medium">Symbol</th>
                    <th className="py-1.5 font-medium text-right">Total</th>
                    <th className="py-1.5 font-medium text-right">Long</th>
                    <th className="py-1.5 font-medium text-right">Short</th>
                    <th className="py-1.5 font-medium text-right">Events</th>
                    <th className="py-1.5 font-medium text-right">Largest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.assetBreakdown.slice(0, 8).map((ab) => (
                    <tr key={ab.symbol} className="hover:bg-surface-hover" data-qa={`liq-asset-${ab.symbol}`}>
                      <td className="py-1.5 font-bold text-white">{ab.symbol}</td>
                      <td className="py-1.5 text-right font-bold text-slate-200 font-mono tabular-nums">
                        {formatCurrency(ab.totalUsd, { compact: true })}
                      </td>
                      <td className="py-1.5 text-right text-emerald-400 font-mono tabular-nums">
                        {ab.longUsd > 0 ? formatCurrency(ab.longUsd, { compact: true }) : '—'}
                      </td>
                      <td className="py-1.5 text-right text-rose-400 font-mono tabular-nums">
                        {ab.shortUsd > 0 ? formatCurrency(ab.shortUsd, { compact: true }) : '—'}
                      </td>
                      <td className="py-1.5 text-right text-slate-400 font-mono tabular-nums">{ab.eventCount}</td>
                      <td className="py-1.5 text-right text-slate-400 font-mono tabular-nums">
                        {ab.largestEventUsd != null ? formatCurrency(ab.largestEventUsd, { compact: true }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Мобильные: компактные карточки (§53) */}
            <div className="sm:hidden space-y-1.5">
              {data.assetBreakdown.slice(0, 8).map((ab) => (
                <div key={ab.symbol} className="rounded-lg bg-surface-elevated/60 border border-white/[0.04] p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{ab.symbol}</span>
                    <span className="font-bold text-slate-200 font-mono tabular-nums">
                      {formatCurrency(ab.totalUsd, { compact: true })}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] font-mono tabular-nums">
                    <span className="text-emerald-400">Long {formatCurrency(ab.longUsd, { compact: true })}</span>
                    <span className="text-rose-400">Short {formatCurrency(ab.shortUsd, { compact: true })}</span>
                    <span className="text-slate-500">Events {ab.eventCount}</span>
                    <span className="text-slate-500">
                      Largest {ab.largestEventUsd != null ? formatCurrency(ab.largestEventUsd, { compact: true }) : '—'}
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
                        style={{ width: `${data.recentEvents.length > 0 ? (t.events / data.recentEvents.length) * 100 : 0}%` }}
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
              QA
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
            <span>Exchange</span>
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
            <span>Side</span>
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
            <span>Minimum size</span>
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
                <th className="py-2">Time</th>
                <th className="py-2">Symbol</th>
                <th className="py-2">Side</th>
                <th className="py-2 text-right">Volume (USD)</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Exchange</th>
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
                  <td className="py-2 text-slate-400 font-mono tabular-nums whitespace-nowrap">
                    {formatTimestamp(event.timestamp)}
                  </td>
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
