import React, { useState, useMemo } from 'react';
import {
  PortfolioRiskEngine,
  PortfolioAssetAllocation,
} from '@/services/portfolio/PortfolioRiskEngine';
import {
  PieChart,
  ShieldCheck,
  Zap,
  Sliders,
} from 'lucide-react';
import { Badge } from '@/components/common/Badge';

export const PortfolioRiskPage: React.FC = () => {
  // Initial Portfolio Allocation State
  const [allocations, setAllocations] = useState<PortfolioAssetAllocation[]>([
    { symbol: 'BTC', amountUsd: 50000 },
    { symbol: 'ETH', amountUsd: 25000 },
    { symbol: 'SOL', amountUsd: 15000 },
    { symbol: 'USDT', amountUsd: 10000 },
  ]);

  const report = useMemo(
    () => PortfolioRiskEngine.calculateRiskReport(allocations),
    [allocations]
  );

  const handleAmountChange = (index: number, val: string) => {
    const num = Math.max(0, Number(val) || 0);
    const updated = [...allocations];
    updated[index].amountUsd = num;
    setAllocations(updated);
  };

  const applyPresetConservative = () => {
    setAllocations([
      { symbol: 'BTC', amountUsd: 60000 },
      { symbol: 'ETH', amountUsd: 25000 },
      { symbol: 'USDT', amountUsd: 15000 },
    ]);
  };

  const applyPresetBarbell = () => {
    setAllocations([
      { symbol: 'BTC', amountUsd: 40000 },
      { symbol: 'ETH', amountUsd: 20000 },
      { symbol: 'SOL', amountUsd: 20000 },
      { symbol: 'NEAR', amountUsd: 10000 },
      { symbol: 'USDT', amountUsd: 10000 },
    ]);
  };

  const applyPresetHighBeta = () => {
    setAllocations([
      { symbol: 'BTC', amountUsd: 20000 },
      { symbol: 'ETH', amountUsd: 20000 },
      { symbol: 'SOL', amountUsd: 30000 },
      { symbol: 'NEAR', amountUsd: 20000 },
      { symbol: 'USDT', amountUsd: 10000 },
    ]);
  };

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <PieChart className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              ПОРТФЕЛЬНЫЙ РИСК И СТРЕСС-ТЕСТИРОВАНИЕ (PORTFOLIO RISK & VAR)
            </h1>
            <Badge variant="cyan" size="sm">
              RISK INTELLIGENCE
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Параметрический расчет Value at Risk (1-Day VaR), совокупной беты, индекса концентрации HHI и симуляция стресс-сценариев.
          </p>
        </div>

        {/* Presets */}
        <div className="flex items-center space-x-1.5 font-mono text-xs overflow-x-auto pb-1 sm:pb-0">
          <span className="text-slate-500 mr-1 hidden lg:inline">Пресеты:</span>
          <button
            onClick={applyPresetConservative}
            className="px-2.5 py-1 bg-surface border border-surface-border hover:border-brand-green text-slate-300 hover:text-white rounded transition-colors whitespace-nowrap"
          >
            Консервативный Core (60% BTC)
          </button>
          <button
            onClick={applyPresetBarbell}
            className="px-2.5 py-1 bg-surface border border-surface-border hover:border-brand-cyan text-slate-300 hover:text-white rounded transition-colors whitespace-nowrap"
          >
            Barbell (40% BTC / 30% Alts)
          </button>
          <button
            onClick={applyPresetHighBeta}
            className="px-2.5 py-1 bg-surface border border-surface-border hover:border-brand-purple text-slate-300 hover:text-white rounded transition-colors whitespace-nowrap"
          >
            High-Beta Altseason
          </button>
        </div>
      </div>

      {/* Non-Custodial Invariant Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-mono font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Non-Custodial / Аналитическое моделирование риска</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          CRYPTORA не подключается к Web3-кошелькам, не хранит активы и не запрашивает транзакционных подписей. Все расчеты риска и стресс-тестирования выполняются локально как математическая декомпозиция для информирования пользователя.
        </p>
      </div>

      {/* Risk Metrics Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-surface border border-surface-border rounded-lg p-4 font-mono">
          <div className="text-[11px] text-slate-400">Объем портфеля (Total Value)</div>
          <div className="text-2xl font-bold text-white mt-1">
            ${report.totalValueUsd.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Базовая валюта: USD</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-mono">
          <div className="text-[11px] text-slate-400">Portfolio Beta к BTC</div>
          <div
            className={`text-2xl font-black mt-1 ${
              report.portfolioBeta > 1.2
                ? 'text-purple-400'
                : report.portfolioBeta > 0.9
                ? 'text-brand-cyan'
                : 'text-amber-400'
            }`}
          >
            {report.portfolioBeta}x
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Чувствительность к рынку</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-mono">
          <div className="text-[11px] text-slate-400">1-Day VaR (95% Доверие)</div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            -${report.dailyVaR95Usd.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            -{report.dailyVaR95Pct}% потенциальный риск в сутки
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-mono">
          <div className="text-[11px] text-slate-400">Концентрация (HHI Индекс)</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {report.hhiConcentrationIndex}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            <span
              className={`font-semibold ${
                report.concentrationRating === 'WELL_DIVERSIFIED'
                  ? 'text-brand-green'
                  : report.concentrationRating === 'MODERATE_CONCENTRATION'
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {report.concentrationRating === 'WELL_DIVERSIFIED' && 'Высокая диверсификация'}
              {report.concentrationRating === 'MODERATE_CONCENTRATION' && 'Умеренная концентрация'}
              {report.concentrationRating === 'HIGH_CONCENTRATION' && 'Высокая концентрация'}
            </span>
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-mono">
          <div className="text-[11px] text-slate-400">Годовая волатильность</div>
          <div className="text-2xl font-bold text-white mt-1">
            {report.annualizedVolatilityPct}%
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Взвешенная $\sigma$ активов</div>
        </div>
      </div>

      {/* Main Row: Asset Allocator & Weights Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocator Form */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-1.5">
              <Sliders className="w-4 h-4 text-brand-cyan" />
              <span className="font-bold text-white uppercase tracking-wider">
                Распределение долей активов
              </span>
            </div>
            <span className="text-[10px] text-slate-500">Интерактивный ввод</span>
          </div>

          <div className="space-y-3">
            {allocations.map((alloc, idx) => (
              <div key={alloc.symbol} className="flex items-center justify-between gap-3">
                <span className="font-bold text-white w-14">{alloc.symbol}</span>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-2 text-slate-500">$</span>
                  <input
                    type="number"
                    value={alloc.amountUsd}
                    onChange={(e) => handleAmountChange(idx, e.target.value)}
                    className="w-full bg-surface-elevated border border-surface-border rounded pl-6 pr-2 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
                  />
                </div>
                <span className="text-slate-400 w-12 text-right">
                  {report.allocations.find((a) => a.symbol === alloc.symbol)?.weightPct || 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Weights Breakdown Cards */}
        <div className="lg:col-span-2 bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="font-bold text-white uppercase tracking-wider">
              Декомпозиция весов и параметров чувствительности
            </span>
            <span className="text-[10px] text-slate-500">Взвешенные коэффициенты</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[11px] text-slate-500 border-b border-surface-border">
                <tr>
                  <th className="py-2 px-2">Символ</th>
                  <th className="py-2 px-2 text-right">Объем ($)</th>
                  <th className="py-2 px-2 text-right">Вес (%)</th>
                  <th className="py-2 px-2 text-center">Beta к BTC</th>
                  <th className="py-2 px-2 text-right">Вклад в Beta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50 text-[11px]">
                {report.allocations.map((a) => (
                  <tr key={a.symbol} className="hover:bg-surface-elevated/40">
                    <td className="py-2.5 px-2 font-bold text-white">{a.symbol}</td>
                    <td className="py-2.5 px-2 text-right text-slate-200">
                      ${a.amountUsd.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold text-brand-cyan">
                      {a.weightPct}%
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-surface-border">
                        {a.beta}x
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-300">
                      {((a.weightPct / 100) * a.beta).toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stress Testing Scenarios Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-brand-purple" />
            <span className="font-bold text-white uppercase tracking-wider">
              Стресс-тестирование портфеля (Historical & Macro Shock Scenarios)
            </span>
          </div>
          <span className="text-[11px] text-slate-500">Симуляция экстремальных фаз</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[11px] text-slate-500 border-b border-surface-border">
              <tr>
                <th className="py-2.5 px-2">Стресс-сценарий</th>
                <th className="py-2.5 px-2">Период</th>
                <th className="py-2.5 px-2">Модель рыночного шока</th>
                <th className="py-2.5 px-2 text-right">Просадка / Рост (%)</th>
                <th className="py-2.5 px-2 text-right">PnL портфеля ($)</th>
                <th className="py-2.5 px-2 text-right">Остаток капитала ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-[11px]">
              {report.stressTestResults.map((st) => (
                <tr key={st.id} className="hover:bg-surface-elevated/40">
                  <td className="py-3 px-2 font-bold text-white">{st.name}</td>
                  <td className="py-3 px-2 text-slate-400">{st.historicalPeriod}</td>
                  <td className="py-3 px-2 text-slate-300 font-sans text-[11px] max-w-md">
                    {st.description}
                  </td>
                  <td
                    className={`py-3 px-2 text-right font-black ${
                      st.simulatedPnlPct >= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {st.simulatedPnlPct >= 0 ? '+' : ''}{st.simulatedPnlPct}%
                  </td>
                  <td
                    className={`py-3 px-2 text-right font-bold ${
                      st.simulatedPnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {st.simulatedPnlUsd >= 0 ? '+' : ''}${st.simulatedPnlUsd.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-bold text-white">
                    ${st.survivingValueUsd.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
