import React, { useState, useMemo, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import {
  PortfolioRiskEngine,
  PortfolioAssetAllocation,
  type PortfolioRiskOverrides,
} from '@/services/portfolio/PortfolioRiskEngine';
import { CandleHistoryService } from '@/services/data/CandleHistoryService';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import {
  PieChart,
  ShieldCheck,
  Zap,
  Sliders,
} from 'lucide-react';
import { Badge } from '@/components/common/Badge';

export const PortfolioRiskPage: React.FC = () => {
  const [allocations, setAllocations] = useState<PortfolioAssetAllocation[]>([
    { symbol: 'BTC', amountUsd: 50000 },
    { symbol: 'ETH', amountUsd: 25000 },
    { symbol: 'SOL', amountUsd: 15000 },
    { symbol: 'USDT', amountUsd: 10000 },
  ]);

  // Н12: беты/волатильности из фактических дневных свечей — ПЕРЕСЧИТЫВАЮТСЯ каждые 60с
  // (раньше считались один раз при монтировании и застывали). CandleHistoryService
  // кэширует свечи на 60с — цикл почти не создаёт сетевых запросов.
  const [riskOverrides, setRiskOverrides] = useState<PortfolioRiskOverrides | undefined>();

  const fetchRiskOverrides = useCallback(async () => {
    const candleService = CandleHistoryService.getInstance();
    const candles = await candleService.getAll().catch(() => null);
    if (!candles) return;
    const btcCandles = candles.get('BTC');
    if (!btcCandles || btcCandles.dailyCloses.length < 5) return;

    const btcReturns = IndicatorEngine.calculateReturns(btcCandles.dailyCloses);
    if (btcReturns.length < 4) return;

    const realBetas: Record<string, number> = {};
    const realVols: Record<string, number> = {};

    for (const [sym, entry] of candles) {
      if (sym === 'BTC' || entry.dailyCloses.length < 5) continue;
      const returns = IndicatorEngine.calculateReturns(entry.dailyCloses);
      const beta = IndicatorEngine.calculateBeta(returns, btcReturns);
      if (beta != null && Number.isFinite(beta)) {
        realBetas[sym] = Number(beta.toFixed(2));
      }
      if (returns.length >= 4) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
        realVols[sym] = Number((Math.sqrt(variance) * Math.sqrt(365)).toFixed(2));
      }
    }

    if (Object.keys(realBetas).length > 0) {
      setRiskOverrides({ betas: realBetas, volatilities: realVols });
    }
  }, []);

  useAutoRefresh(fetchRiskOverrides, 60_000);

  const report = useMemo(
    () => PortfolioRiskEngine.calculateRiskReport(allocations, riskOverrides),
    [allocations, riskOverrides]
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

  const betaColor = (beta: number | null) => {
    if (beta == null) return 'text-slate-500';
    if (beta > 1.2) return 'text-violet-400';
    if (beta > 0.9) return 'text-cyan-400';
    return 'text-amber-400';
  };

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <PieChart className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Портфельный риск и стресс-тестирование
            </h1>
            <Badge variant="cyan" size="sm">
              Риск-аналитика
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Параметрический расчет Value at Risk (1-Day VaR), совокупной беты, индекса концентрации HHI и симуляция стресс-сценариев.
          </p>
        </div>

        <div className="flex items-center space-x-1.5 font-sans text-xs overflow-x-auto pb-1 sm:pb-0">
          <span className="text-slate-400 mr-1 hidden lg:inline font-semibold">Пресеты:</span>
          <button onClick={applyPresetConservative} className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-emerald-500/50 text-slate-300 hover:text-white rounded-lg transition-colors whitespace-nowrap min-h-[32px] font-medium">
            Консервативный Core (60% BTC)
          </button>
          <button onClick={applyPresetBarbell} className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-cyan-500/50 text-slate-300 hover:text-white rounded-lg transition-colors whitespace-nowrap min-h-[32px] font-medium">
            Barbell (40% BTC / 30% Alts)
          </button>
          <button onClick={applyPresetHighBeta} className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-violet-500/50 text-slate-300 hover:text-white rounded-lg transition-colors whitespace-nowrap min-h-[32px] font-medium">
            High-Beta Altseason
          </button>
        </div>
      </div>

      {/* Non-Custodial Invariant Notice */}
      <div className="p-4 bg-surface border border-white/[0.08] rounded-xl text-xs font-sans text-slate-300 space-y-2 shadow-panel">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Без кастоди: аналитическое моделирование риска</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          CRYPTORA не подключается к Web3-кошелькам, не хранит активы и не запрашивает транзакционных подписей. Все расчеты риска и стресс-тестирования выполняются локально как математическая декомпозиция для информирования пользователя.
        </p>
      </div>

      {/* Data source notice */}
      {report.staticReferenceUsed && (
        <div className="p-3 bg-amber-950/30 border border-amber-500/20 rounded-xl text-xs font-sans text-amber-300">
          <span className="font-semibold">⚠ Справочные β / σ:</span> Для некоторых активов используются исторические справочные значения (не из свечей). Стресс-тесты используют фиксированные исторические шоки.
        </div>
      )}

      {/* Risk Metrics Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 font-sans shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Стоимость портфеля</div>
          <div className="text-2xl font-bold text-white mt-1.5 tabular-nums font-mono">
            ${report.totalValueUsd.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Базовая валюта: USD</div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 font-sans shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Бета портфеля к BTC</div>
          <div className={`text-2xl font-black mt-1.5 tabular-nums font-mono ${betaColor(report.portfolioBeta)}`}>
            {report.portfolioBeta != null ? `${report.portfolioBeta}x` : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {report.portfolioBeta != null ? 'Чувствительность к рынку (факт.)' : 'Нет данных свечей'}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 font-sans shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">VaR за 1 день (доверие 95%)</div>
          <div className="text-2xl font-bold text-rose-400 mt-1.5 tabular-nums font-mono">
            {report.dailyVaR95Usd != null ? `-$${report.dailyVaR95Usd.toLocaleString()}` : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            {report.dailyVaR95Pct != null ? `-${report.dailyVaR95Pct}% потенциальный риск в сутки` : 'Требуется история'}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 font-sans shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Концентрация (индекс HHI)</div>
          <div className="text-2xl font-bold text-amber-400 mt-1.5 tabular-nums font-mono">
            {report.hhiConcentrationIndex}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            <span className={`font-semibold ${
              report.concentrationRating === 'WELL_DIVERSIFIED' ? 'text-emerald-400'
                : report.concentrationRating === 'MODERATE_CONCENTRATION' ? 'text-amber-400'
                : 'text-rose-400'
            }`}>
              {report.concentrationRating === 'WELL_DIVERSIFIED' && 'Высокая диверсификация'}
              {report.concentrationRating === 'MODERATE_CONCENTRATION' && 'Умеренная концентрация'}
              {report.concentrationRating === 'HIGH_CONCENTRATION' && 'Высокая концентрация'}
            </span>
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-4 font-sans shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Годовая волатильность</div>
          <div className="text-2xl font-bold text-white mt-1.5 tabular-nums font-mono">
            {report.annualizedVolatilityPct != null ? `${report.annualizedVolatilityPct}%` : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {report.annualizedVolatilityPct != null ? 'Взвешенная волатильность (факт.)' : 'Нет данных свечей'}
          </div>
        </div>
      </div>

      {/* Main Row: Asset Allocator & Weights Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-1.5">
              <Sliders className="w-4 h-4 text-brand-cyan" />
              <span className="font-bold text-white tracking-wide">Распределение долей активов</span>
            </div>
            <span className="text-[11px] text-slate-500">Интерактивный ввод</span>
          </div>
          <div className="space-y-3">
            {allocations.map((alloc, idx) => (
              <div key={alloc.symbol} className="flex items-center justify-between gap-3">
                <span className="font-bold text-white w-14">{alloc.symbol}</span>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-2 text-slate-500">$</span>
                  <input type="number" value={alloc.amountUsd} onChange={(e) => handleAmountChange(idx, e.target.value)} className="w-full bg-surface-elevated border border-surface-border rounded pl-6 pr-2 py-1.5 text-white focus:outline-none focus:border-brand-cyan" />
                </div>
                <span className="text-slate-400 w-12 text-right">
                  {report.allocations.find((a) => a.symbol === alloc.symbol)?.weightPct || 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Weights Breakdown Cards */}
        <div className="lg:col-span-2 bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="font-bold text-white tracking-wide">Декомпозиция весов и параметров чувствительности</span>
            <span className="text-[11px] text-slate-500">
              {riskOverrides ? 'β из свечей (DERIVED)' : 'β недоступны (UNAVAILABLE)'}
            </span>
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
                    <td className="py-2.5 px-2 text-right text-slate-200">${a.amountUsd.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right font-semibold text-brand-cyan">{a.weightPct}%</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded bg-surface-elevated border border-surface-border ${a.beta == null ? 'text-slate-500' : ''}`}>
                        {a.beta != null ? `${a.beta}x` : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-300">
                      {a.beta != null ? ((a.weightPct / 100) * a.beta).toFixed(3) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stress Testing Scenarios Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-brand-purple" />
            <span className="font-bold text-white tracking-wide">Стресс-тестирование портфеля: исторические и макро-шоки</span>
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
                  <td className="py-3 px-2 text-slate-300 font-sans text-[11px] max-w-md">{st.description}</td>
                  <td className={`py-3 px-2 text-right font-black ${st.simulatedPnlPct >= 0 ? 'text-brand-green' : 'text-rose-400'}`}>
                    {st.simulatedPnlPct >= 0 ? '+' : ''}{st.simulatedPnlPct}%
                  </td>
                  <td className={`py-3 px-2 text-right font-bold ${st.simulatedPnlUsd >= 0 ? 'text-brand-green' : 'text-rose-400'}`}>
                    {st.simulatedPnlUsd >= 0 ? '+' : ''}${st.simulatedPnlUsd.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-bold text-white">${st.survivingValueUsd.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
