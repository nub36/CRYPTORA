import React, { useState, useEffect } from 'react';
import { Cpu, ShieldCheck, PlayCircle, Sliders, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { BacktestEngine, BacktestResult, StrategyRule } from '@/services/backtest/BacktestEngine';
import { OHLCV, Timeframe } from '@/types/market';
import { formatPercent } from '@/utils/formatters';
import { sideLabel } from '@/utils/labels';
import { StrategyArchivePanel } from '@/components/strategies/StrategyArchivePanel';

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

  // Fetch historical candles for backtest simulation
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
      takerFeePct: 0.05, // 0.05% taker fee
      slippagePct: 0.02, // 0.02% simulated slippage
    });

    setBacktestResult(result);
    setIsRunning(false);
  };

  // Run initial backtest once candles load
  useEffect(() => {
    if (candles.length > 30 && !backtestResult) {
      handleRunBacktest();
    }
  }, [candles]);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {sourceUnavailable && <DataSourceUnavailable subject="исторические свечи" />}
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-brand-purple" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Лаборатория стратегий
            </h1>
            <Badge variant="purple" size="sm">
              Архитектурный прототип
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Конструктор формализованных правил и побарная симуляция на исторических данных (без заглядывания в будущее).
          </p>
        </div>

        <div className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded border border-cyan-500/30">
          Симуляция / без исполнения ордеров
        </div>
      </div>

      {/* Strict Non-Execution Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>CRYPTORA — аналитический терминал: инвариант без исполнения ордеров</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Все расчеты в Лаборатории стратегий представляют собой <strong>математическую ретроспективную симуляцию</strong> на исторических барах с вычетом комиссий тейкера (0.05%) и проскальзывания (0.02%). Платформа <strong>не подключается к торговым ключам и не исполняет реальные ордера</strong> на биржах.
        </p>
      </div>

      {/* Strategy Research Archive (read-only; all 13 historical versions from the registry) */}
      <StrategyArchivePanel />

      {/* Interactive Controls & Parameters */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2 font-bold text-white uppercase">
            <Sliders className="w-4 h-4 text-brand-cyan" />
            <span>Параметры симуляции и правила входа</span>
          </div>
          <button
            onClick={handleRunBacktest}
            disabled={isRunning || candles.length === 0}
            className="px-3 py-1.5 bg-brand-cyan hover:bg-brand-cyan/90 text-slate-950 font-bold rounded flex items-center space-x-1.5 transition-all disabled:opacity-50"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
            <span>Запустить бэктест</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Инструмент</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value as any)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
            >
              <option value="BTC">BTC / USDT</option>
              <option value="ETH">ETH / USDT</option>
              <option value="SOL">SOL / USDT</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Таймфрейм свечей</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
            >
              <option value="15m">15 Минут</option>
              <option value="1h">1 Час</option>
              <option value="4h">4 Часа</option>
              <option value="1D">1 День</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Алгоритмическое правило</label>
            <select
              value={strategyType}
              onChange={(e) => setStrategyType(e.target.value as any)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
            >
              <option value="RSI_REVERSAL">RSI (14) Разворот из перепроданности</option>
              <option value="EMA_CROSS">EMA (9 / 21) Трендовое пересечение</option>
              <option value="BREAKOUT">Пробой максимума 20-барного канала</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Стоп-лосс (уровень отмены, %)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="20"
              value={stopLossPct}
              onChange={(e) => setStopLossPct(Number(e.target.value))}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Тейк-профит (целевой ориентир, %)</label>
            <input
              type="number"
              step="0.5"
              min="1"
              max="50"
              value={takeProfitPct}
              onChange={(e) => setTakeProfitPct(Number(e.target.value))}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white"
            />
          </div>
        </div>
      </div>

      {/* Backtest Results Dashboard */}
      {backtestResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Чистый результат (PnL)</div>
              <div
                className={`text-lg font-bold font-mono mt-1 ${
                  backtestResult.netProfitUsd >= 0 ? 'text-brand-green' : 'text-rose-400'
                }`}
              >
                {backtestResult.netProfitUsd >= 0 ? '+' : ''}${backtestResult.netProfitUsd.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                {formatPercent(backtestResult.netProfitPct)} к депозиту
              </div>
            </div>

            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Доля прибыльных</div>
              <div className="text-lg font-bold font-mono text-amber-400 mt-1">
                {backtestResult.winRatePct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {backtestResult.winningTrades} побед / {backtestResult.losingTrades} убытков
              </div>
            </div>

            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Профит-фактор</div>
              <div className="text-lg font-bold font-mono text-brand-cyan mt-1">
                {backtestResult.profitFactor}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Валовая прибыль / валовый убыток</div>
            </div>

            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Макс. просадка</div>
              <div className="text-lg font-bold font-mono text-rose-400 mt-1">
                -{backtestResult.maxDrawdownPct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">От пикового баланса</div>
            </div>

            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Коэффициент Шарпа</div>
              <div className="text-lg font-bold font-mono text-purple-400 mt-1">
                {backtestResult.sharpeRatio}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Скорректировано на риск</div>
            </div>

            <div className="bg-surface border border-surface-border rounded-lg p-3">
              <div className="text-[11px] font-sans text-slate-400">Всего симулировано сделок</div>
              <div className="text-lg font-bold font-mono text-white mt-1">
                {backtestResult.totalTrades}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Комиссии учтены</div>
            </div>
          </div>

          {/* Simulated Trade Execution Log */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans text-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-surface-border">
              <span className="font-bold text-white tracking-wide">
                Журнал симулированных сделок ({backtestResult.trades.length})
              </span>
              <span className="text-[11px] text-slate-500">
                Комиссия тейкера: 0.05% | Проскальзывание: 0.02%
              </span>
            </div>

            {backtestResult.trades.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                За выбранный исторический интервал условий для входа в позицию не зафиксировано.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[11px] text-slate-500 border-b border-surface-border">
                    <tr>
                      <th className="py-1.5 px-2">ID</th>
                      <th className="py-1.5 px-2">Сторона</th>
                      <th className="py-1.5 px-2">Вход</th>
                      <th className="py-1.5 px-2">Выход</th>
                      <th className="py-1.5 px-2">Причина выхода</th>
                      <th className="py-1.5 px-2 text-right">Комиссии</th>
                      <th className="py-1.5 px-2 text-right">PnL (%)</th>
                      <th className="py-1.5 px-2 text-right">PnL ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border/50 text-[11px]">
                    {backtestResult.trades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-surface-elevated/40">
                        <td className="py-1.5 px-2 text-slate-400">{trade.id}</td>
                        <td className="py-1.5 px-2">
                          <span className="text-brand-green font-bold">{sideLabel(trade.side)}</span>
                        </td>
                        <td className="py-1.5 px-2 text-white">
                          ${trade.entryPrice.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-white">
                          ${trade.exitPrice.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              trade.exitReason === 'TAKE_PROFIT'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {trade.exitReason}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-400">
                          ${trade.feesPaid.toFixed(2)}
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right font-bold ${
                            trade.pnlPct >= 0 ? 'text-brand-green' : 'text-rose-400'
                          }`}
                        >
                          {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right font-bold ${
                            trade.pnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'
                          }`}
                        >
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
      )}
    </div>
  );
};
