import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Archive,
  FlaskConical,
  PlayCircle,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { Collapsible } from '@/components/common/Collapsible';
import { BacktestEngine, BacktestResult, StrategyRule } from '@/services/backtest/BacktestEngine';
import { OHLCV, Timeframe } from '@/types/market';
import { formatPercent } from '@/utils/formatters';
import { sideLabel } from '@/utils/labels';
import { StrategyArchivePanel } from '@/components/strategies/StrategyArchivePanel';
import { ProductStrategiesSection } from '@/components/strategies/ProductStrategiesSection';

/**
 * /strategies — продуктовая страница.
 *
 * Primary UI: ровно три стратегии (V3.0 / V3.3 / V2.8) компактными карточками.
 * Всё исследовательское — симулятор, архив 13 версий, оговорки про отсутствие
 * исполнения — вынесено в свёрнутые collapsible-секции и не занимает экран.
 *
 * Математика стратегий и signal conditions здесь не определяются: страница
 * только читает реестр `strategyArchive`.
 */
export const StrategiesPage: React.FC = () => {
  const { provider } = useMarketData();
  const [symbol, setSymbol] = useState<'BTC' | 'ETH' | 'SOL'>('BTC');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [strategyType, setStrategyType] = useState<'RSI_REVERSAL' | 'EMA_CROSS' | 'BREAKOUT'>('RSI_REVERSAL');
  const [stopLossPct, setStopLossPct] = useState<number>(2.5);
  const [takeProfitPct, setTakeProfitPct] = useState<number>(5.0);
  const initialCapital = 10000;
  const positionSizeUsd = 2000;

  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  useEffect(() => {
    async function loadCandles() {
      try {
        const data = await provider.getCandles(symbol, timeframe);
        setCandles(data);
        setSourceUnavailable(false);
      } catch {
        setCandles([]);
        setSourceUnavailable(true);
      }
    }
    loadCandles();
  }, [provider, symbol, timeframe]);

  const handleRunBacktest = () => {
    if (candles.length === 0) return;
    setIsRunning(true);

    const rule: StrategyRule = {
      id: `strat-${strategyType.toLowerCase()}`,
      name:
        strategyType === 'RSI_REVERSAL'
          ? 'RSI (14): разворот из перепроданности'
          : strategyType === 'EMA_CROSS'
          ? 'EMA (9 / 21): трендовое пересечение'
          : 'Пробой максимума 20-барного канала',
      type: strategyType,
      parameters: {
        oversoldThreshold: 30,
        fastPeriod: 9,
        slowPeriod: 21,
        lookback: 20,
      },
      stopLossPct,
      takeProfitPct,
    };

    const result = BacktestEngine.runBacktest(candles, rule, symbol, timeframe, {
      initialCapital,
      positionSizeUsd,
      takerFeePct: 0.05,
      slippagePct: 0.02,
    });

    setBacktestResult(result);
    setIsRunning(false);
  };

  useEffect(() => {
    if (candles.length > 30 && !backtestResult) {
      handleRunBacktest();
    }
  }, [candles]);

  return (
    <div className="mx-auto max-w-[1920px] space-y-4 px-3 py-3 sm:px-4">
      {sourceUnavailable && <DataSourceUnavailable subject="исторические свечи" />}

      {/* ── Заголовок: одна строка, без методологии ─────────────────── */}
      <header className="border-b border-surface-border pb-3">
        <h1 className="ui-h1">Стратегии</h1>
        <p className="ui-helper mt-1">
          Формализованные правила входа и выхода на рыночных данных CRYPTORA.
        </p>
      </header>

      {/* ── Primary UI: три продуктовые стратегии ───────────────────── */}
      <ProductStrategiesSection />

      {/* ── Исследовательский архив: вторичный, свёрнут по умолчанию ── */}
      <Collapsible
        testId="research-archive-collapsible"
        mountOnOpen
        tone="muted"
        icon={<Archive className="h-4 w-4" />}
        label="Исследовательский архив"
        hint="все версии программы, включая отклонённые"
      >
        <StrategyArchivePanel />
      </Collapsible>

      {/* ── Симулятор: инструмент исследования, не продуктовый экран ── */}
      <Collapsible
        testId="backtest-lab-collapsible"
        mountOnOpen
        tone="muted"
        icon={<FlaskConical className="h-4 w-4" />}
        label="Симулятор правил"
        hint="побарная ретроспектива без исполнения ордеров"
      >
        <div className="space-y-4 font-sans text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border pb-2">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Sliders className="h-4 w-4 text-brand-cyan" />
              <span>Параметры симуляции</span>
            </div>
            <button
              onClick={handleRunBacktest}
              disabled={isRunning || candles.length === 0}
              className="flex min-h-[40px] items-center gap-1.5 rounded bg-brand-cyan px-3 py-1.5 font-bold text-slate-950 transition-all hover:bg-brand-cyan/90 disabled:opacity-50"
            >
              {isRunning ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              <span>Запустить бэктест</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="ui-label mb-1 block">Инструмент</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value as 'BTC' | 'ETH' | 'SOL')}
                className="w-full rounded border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-white"
              >
                <option value="BTC">BTC / USDT</option>
                <option value="ETH">ETH / USDT</option>
                <option value="SOL">SOL / USDT</option>
              </select>
            </div>

            <div>
              <label className="ui-label mb-1 block">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="w-full rounded border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-white"
              >
                <option value="15m">15 минут</option>
                <option value="1h">1 час</option>
                <option value="4h">4 часа</option>
                <option value="1D">1 день</option>
              </select>
            </div>

            <div>
              <label className="ui-label mb-1 block">Правило входа</label>
              <select
                value={strategyType}
                onChange={(e) =>
                  setStrategyType(e.target.value as 'RSI_REVERSAL' | 'EMA_CROSS' | 'BREAKOUT')
                }
                className="w-full rounded border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-white"
              >
                <option value="RSI_REVERSAL">RSI (14) — разворот из перепроданности</option>
                <option value="EMA_CROSS">EMA (9 / 21) — трендовое пересечение</option>
                <option value="BREAKOUT">Пробой максимума 20-барного канала</option>
              </select>
            </div>

            <div>
              <label className="ui-label mb-1 block">Stop Loss, %</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="20"
                value={stopLossPct}
                onChange={(e) => setStopLossPct(Number(e.target.value))}
                className="w-full rounded border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-white"
              />
            </div>

            <div>
              <label className="ui-label mb-1 block">Take Profit, %</label>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={takeProfitPct}
                onChange={(e) => setTakeProfitPct(Number(e.target.value))}
                className="w-full rounded border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-white"
              />
            </div>
          </div>

          {backtestResult && <BacktestResultView result={backtestResult} />}
        </div>
      </Collapsible>

      {/* ── Инвариант без исполнения: одна строка, детали по клику ──── */}
      <Collapsible
        testId="non-execution-collapsible"
        tone="warning"
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Без исполнения ордеров"
        hint="CRYPTORA не подключается к торговым ключам"
      >
        <p className="ui-secondary text-[11px]">
          Все расчёты — математическая ретроспективная симуляция на исторических барах с вычетом
          комиссии тейкера (0.05%) и проскальзывания (0.02%). Платформа не подключается к торговым
          ключам и не исполняет реальные ордера на биржах. Статусы стратегий отражают результаты
          исследования, а не доказанную доходность в live.
        </p>
      </Collapsible>
    </div>
  );
};

const BacktestResultView: React.FC<{ result: BacktestResult }> = ({ result: r }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="PnL" value={`${r.netProfitUsd >= 0 ? '+' : ''}$${r.netProfitUsd.toLocaleString()}`} tone={r.netProfitUsd >= 0 ? 'text-brand-green' : 'text-rose-400'} hint={`${formatPercent(r.netProfitPct)} к депозиту`} />
      <Metric label="Win rate" value={`${r.winRatePct}%`} tone="text-amber-400" hint={`${r.winningTrades} побед / ${r.losingTrades} убытков`} />
      <Metric label="Profit factor" value={`${r.profitFactor}`} tone="text-brand-cyan" hint="Валовая прибыль / убыток" />
      <Metric label="Max drawdown" value={`-${r.maxDrawdownPct}%`} tone="text-rose-400" hint="От пикового баланса" />
      <Metric label="Sharpe" value={`${r.sharpeRatio}`} tone="text-purple-400" hint="С поправкой на риск" />
      <Metric label="Сделок" value={`${r.totalTrades}`} tone="text-white" hint="Комиссии учтены" />
    </div>

    <div className="space-y-2 rounded-lg border border-surface-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border pb-2">
        <span className="ui-card-title">Журнал симулированных сделок ({r.trades.length})</span>
        <span className="ui-helper">Комиссия тейкера 0.05% · проскальзывание 0.02%</span>
      </div>

      {r.trades.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-500">
          За выбранный интервал условий для входа не зафиксировано.
        </div>
      ) : (
        <div className="-mx-3 overflow-x-auto px-3">
          <table className="w-full min-w-[560px] text-left">
            <thead className="border-b border-surface-border text-[11px] text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-normal">ID</th>
                <th className="px-2 py-1.5 font-normal">Сторона</th>
                <th className="px-2 py-1.5 font-normal">Entry</th>
                <th className="px-2 py-1.5 font-normal">Exit</th>
                <th className="px-2 py-1.5 font-normal">Причина выхода</th>
                <th className="px-2 py-1.5 text-right font-normal">Комиссии</th>
                <th className="px-2 py-1.5 text-right font-normal">PnL %</th>
                <th className="px-2 py-1.5 text-right font-normal">PnL $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-[11px]">
              {r.trades.map((trade) => (
                <tr key={trade.id} className="hover:bg-surface-elevated/40">
                  <td className="px-2 py-1.5 text-slate-400">{trade.id}</td>
                  <td className="px-2 py-1.5 font-bold text-brand-green">{sideLabel(trade.side)}</td>
                  <td className="ui-num px-2 py-1.5 text-white">${trade.entryPrice.toLocaleString()}</td>
                  <td className="ui-num px-2 py-1.5 text-white">${trade.exitPrice.toLocaleString()}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                        trade.exitReason === 'TAKE_PROFIT'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {trade.exitReason}
                    </span>
                  </td>
                  <td className="ui-num px-2 py-1.5 text-right text-slate-400">
                    ${trade.feesPaid.toFixed(2)}
                  </td>
                  <td className={`ui-num px-2 py-1.5 text-right font-bold ${trade.pnlPct >= 0 ? 'text-brand-green' : 'text-rose-400'}`}>
                    {trade.pnlPct >= 0 ? '+' : ''}
                    {trade.pnlPct.toFixed(2)}%
                  </td>
                  <td className={`ui-num px-2 py-1.5 text-right font-bold ${trade.pnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'}`}>
                    {trade.pnlUsd >= 0 ? '+' : ''}${trade.pnlUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </div>
);

const Metric: React.FC<{ label: string; value: string; tone: string; hint: string }> = ({
  label,
  value,
  tone,
  hint,
}) => (
  <div className="rounded-lg border border-surface-border bg-surface p-3">
    <div className="ui-label">{label}</div>
    <div className={`ui-num mt-1 text-lg font-bold ${tone}`}>{value}</div>
    <div className="ui-helper mt-0.5">{hint}</div>
  </div>
);
