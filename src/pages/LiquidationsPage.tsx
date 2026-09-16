import React, { useEffect, useState, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { LiquidationData } from '@/types/market';
import { formatCurrency, formatTimestamp } from '@/utils/formatters';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
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

  useEffect(() => {
    let isActive = true;
    const load = () => {
      provider
        .getLiquidations()
        .then((res) => {
          if (!isActive) return;
          setData(res);
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
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-mono text-sm">
        <Flame className="w-5 h-5 animate-spin mr-2 text-rose-500" />
        Загрузка аналитики ликвидаций...
      </div>
    );
  }

  const longPct = data.total24h > 0 ? ((data.totalLong24h / data.total24h) * 100).toFixed(1) : '0.0';
  const shortPct = data.total24h > 0 ? ((data.totalShort24h / data.total24h) * 100).toFixed(1) : '0.0';
  // Масштаб оси баров выводится из фактических данных, а не из зашитой константы
  const timelineMax = Math.max(...data.timeline.map((b) => Math.max(b.longUsd, b.shortUsd)), 0);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5 font-mono">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-wide">
              КАРТА И ПОТОК ЛИКВИДАЦИЙ (LIQUIDATIONS)
            </h1>
            {data.dataStatus === 'LIVE_STREAM' && (
              <span className="text-[10px] font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE STREAM (BINANCE FUTURES)
              </span>
            )}
            {(data.dataStatus === 'AWAITING_STREAM' || data.dataStatus === 'UNAVAILABLE') && (
              <span className="text-[10px] font-semibold text-slate-300 bg-slate-500/10 px-2.5 py-0.5 rounded-full border border-slate-400/30">
                {data.dataStatus === 'AWAITING_STREAM'
                  ? 'ПОТОК ПОДКЛЮЧЕН · ОЖИДАНИЕ СОБЫТИЙ'
                  : 'ПОТОК ЛИКВИДАЦИЙ НЕДОСТУПЕН'}
              </span>
            )}
            {data.dataStatus === 'DEMO' && (
              <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA-СРЕЗ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {data.dataStatus === 'LIVE_STREAM' &&
              'Фактические принудительно закрытые позиции Binance USD-M Futures по публичному потоку forceOrder.'}
            {data.dataStatus === 'AWAITING_STREAM' &&
              'Поток фактических ликвидаций подключен. Агрегаты появятся после первых событий — оценочные числа не подставляются.'}
            {data.dataStatus === 'UNAVAILABLE' &&
              'Фактический поток ликвидаций недоступен из текущей сети. Терминал не отображает оценочные суммы вместо реальных данных.'}
            {data.dataStatus === 'DEMO' &&
              'Мониторинг принудительно закрытых маржинальных позиций по биржам на QA-датасете.'}
          </p>
        </div>

        <div className="text-xs text-slate-400 font-sans">
          Всего ликвидировано за 24ч:{' '}
          <strong className="text-white font-mono tabular-nums">{formatCurrency(data.total24h, { compact: true })}</strong>
        </div>
      </div>

      {/* CRITICAL METHODOLOGY DISCLAIMER */}
      <div className="p-3.5 bg-amber-500/[0.08] border border-amber-500/30 rounded-xl text-xs font-sans text-slate-300 space-y-1.5 shadow-panel">
        <div className="flex items-center space-x-2 text-amber-300 font-mono font-bold">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400" />
          <span>КРИТИЧЕСКИЙ ПРИНЦИП: ACTUAL LIQUIDATION EVENT ≠ ESTIMATED LIQUIDATION LEVEL</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-300">
          <strong>Фактическое событие ликвидации (Actual Event):</strong> Публичный биржевой ордер принудительного закрытия позиции при наступлении маржин-колла. Это подтвержденный свершившийся факт.<br />
          <strong>Расчетный ликвидационный уровень (Estimated / Model Level):</strong> Математическая гипотетическая модель, построенная на оценке открытого интереса и стандартных плеч (10x, 25x, 50x, 100x). Трейдеры могут довносить обеспечение, закрывать сделки лимитными ордерами или хеджироваться на других площадках. CRYPTORA не обладает и не заявляет доступ к скрытым персональным ликвидационным уровням пользователей бирж. Любая тепловая карта уровней обязана маркироваться как <code className="bg-slate-800 px-1.5 py-0.5 rounded text-amber-300 font-mono">ESTIMATED / MODEL</code>.
        </p>
      </div>

      {/* Aggregate Long/Short Ratio Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 uppercase tracking-wider">Ликвидировано Long (24h)</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">
            {formatCurrency(data.totalLong24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {data.total24h > 0 ? `${longPct}% от общего объема` : 'Нет фактических событий за 24ч'}
          </div>
        </div>

        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 uppercase tracking-wider">Ликвидировано Short (24h)</div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums">
            {formatCurrency(data.totalShort24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {data.total24h > 0 ? `${shortPct}% от общего объема (Шорт-сквиз)` : 'Нет фактических событий за 24ч'}
          </div>
        </div>

        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 shadow-panel">
          <div className="text-xs text-slate-400 uppercase tracking-wider">Крупнейшее единичное событие</div>
          {data.largestEvent ? (
            <>
              <div className="text-2xl font-black text-white mt-1 tabular-nums">
                {formatCurrency(data.largestEvent.amountUsd, { compact: true })}
              </div>
              <div className="text-[11px] text-rose-300 mt-0.5">
                {data.largestEvent.symbol} ({data.largestEvent.side}) на {data.largestEvent.exchange}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-black text-slate-500 mt-1 tabular-nums">—</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Фактических событий ещё не поступало</div>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar: только при наличии фактических событий */}
      {data.total24h > 0 && (
      <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-emerald-400 font-bold tabular-nums">Longs: {longPct}%</span>
          <span className="text-rose-400 font-bold tabular-nums">Shorts: {shortPct}%</span>
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-[#111a30]">
          <div className="bg-emerald-500 h-full" style={{ width: `${longPct}%` }} />
          <div className="bg-rose-500 h-full" style={{ width: `${shortPct}%` }} />
        </div>
      </div>
      )}

      {/* Timeline & Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start">
        {/* Timeline Visualization (8 cols) */}
        <div className="lg:col-span-8 bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 space-y-3.5 shadow-panel">
          <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Хронология ликвидаций по 3-часовым барам (24H Timeline)</span>
            </span>
            <span className="text-[10px] text-slate-400">UTC Bars</span>
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
                      title={`Longs: ${formatCurrency(bar.longUsd, { compact: true })}`}
                    />
                    {/* Short bar */}
                    <div
                      style={{ height: `${Math.max(4, shortHeight)}px` }}
                      className="w-1/2 bg-rose-500/80 rounded-t group-hover:bg-rose-400 transition-colors"
                      title={`Shorts: ${formatCurrency(bar.shortUsd, { compact: true })}`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 group-hover:text-white tabular-nums">
                    {bar.timestamp}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center space-x-6 text-[11px] pt-2 border-t border-white/[0.06] text-slate-400">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-emerald-500 rounded"></span>
              <span>Long Liquidations</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-rose-500 rounded"></span>
              <span>Short Liquidations</span>
            </div>
          </div>
        </div>

        {/* Exchange & Asset Breakdowns (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Exchange Breakdown */}
          <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-2 border-b border-white/[0.06]">
              Распределение по биржам
            </div>
            {data.exchangeBreakdown.length === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">
                Разбивка появится после первых фактических событий потока.
              </div>
            )}
            <div className="space-y-2.5 text-xs">
              {data.exchangeBreakdown.map((ex) => (
                <div key={ex.exchange} className="space-y-1">
                  <div className="flex justify-between tabular-nums">
                    <span className="text-white font-semibold">{ex.exchange}</span>
                    <span className="text-slate-300">
                      {formatCurrency(ex.totalUsd, { compact: true })} ({ex.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#111a30] overflow-hidden">
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
          <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-2 border-b border-white/[0.06]">
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
                  className="flex items-center justify-between p-2 rounded-lg bg-[#111a30]/60 hover:bg-[#162342] transition-colors border border-white/[0.04]"
                >
                  <span className="font-bold text-white">{ab.symbol}</span>
                  <div className="text-right tabular-nums">
                    <span className="font-bold text-slate-200">
                      {formatCurrency(ab.totalUsd, { compact: true })}
                    </span>
                    <span className="text-[10px] text-rose-400 block">
                      Shorts: {formatCurrency(ab.shortUsd, { compact: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
      <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-4 space-y-3 shadow-panel">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Расчетные уровни плечевых тиров (Estimated Liquidation Levels)
            </span>
          </div>
          <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-500/30">
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
                  {c.leverageTier}x {c.side} Liq
                </span>
                <span className="text-slate-400">±{c.distancePct}%</span>
              </div>
              <div className="text-sm font-bold text-white">
                {formatCurrency(c.priceLevel)}
              </div>
              <div className="text-[10px] text-slate-400">
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
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              {data.dataStatus === 'DEMO'
                ? 'Журнал событий ликвидаций QA-датасета'
                : 'Журнал фактических событий ликвидаций (Actual Event Log)'}
            </span>
          </div>
          {data.dataStatus === 'DEMO' ? (
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
              QA DATASET
            </span>
          ) : (
            <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/30">
              BINANCE FUTURES forceOrder@arr
            </span>
          )}
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
              {data.recentEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                    {data.dataStatus === 'AWAITING_STREAM'
                      ? 'Журнал пуст: поток подключен, фактические события принудительного закрытия ещё не поступали.'
                      : 'Журнал пуст: фактический поток ликвидаций недоступен. Плейсхолдеры-события не подставляются.'}
                  </td>
                </tr>
              )}
              {data.recentEvents.map((event) => (
                <tr key={event.id} className="hover:bg-surface-hover">
                  <td className="py-2 text-slate-400">{formatTimestamp(event.timestamp)}</td>
                  <td className="py-2 font-bold text-white">{event.symbol}</td>
                  <td className="py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        event.side === 'LONG'
                          ? 'bg-emerald-950 text-brand-green border border-emerald-500/30'
                          : 'bg-rose-950 text-brand-red border border-rose-500/30'
                      }`}
                    >
                      {event.side}
                    </span>
                  </td>
                  <td className="py-2 text-right font-bold text-white">
                    {formatCurrency(event.amountUsd, { compact: true })}
                  </td>
                  <td className="py-2 text-right text-slate-300">
                    {formatCurrency(event.price)}
                  </td>
                  <td className="py-2 text-right text-brand-cyan">{event.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
