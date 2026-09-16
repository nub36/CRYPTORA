import React, { useState } from 'react';
import {
  calculatePositionSize,
  calculatePnL,
  calculateLiquidationPrice,
  calculateFundingFee,
  calculateDca,
} from '@/utils/calculators';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Wrench, Shield, Calculator, Flame, DollarSign, TrendingUp } from 'lucide-react';

export const ToolsPage: React.FC = () => {
  // 1. Position Size State
  const [posAccountBalance, setPosAccountBalance] = useState('10000');
  const [posRiskPercentage, setPosRiskPercentage] = useState('2');
  const [posEntryPrice, setPosEntryPrice] = useState('64850');
  const [posStopLossPrice, setPosStopLossPrice] = useState('63200');

  // 2. PnL State
  const [pnlDirection, setPnlDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [pnlMargin, setPnlMargin] = useState('1000');
  const [pnlLeverage, setPnlLeverage] = useState('10');
  const [pnlEntryPrice, setPnlEntryPrice] = useState('64850');
  const [pnlExitPrice, setPnlExitPrice] = useState('67200');

  // 3. Liquidation Price State
  const [liqDirection, setLiqDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [liqEntryPrice, setLiqEntryPrice] = useState('64850');
  const [liqLeverage, setLiqLeverage] = useState('10');
  const [liqMmr, setLiqMmr] = useState('0.5');

  // 4. Funding Fee State
  const [feePosSize, setFeePosSize] = useState('50000');
  const [feeRate8h, setFeeRate8h] = useState('0.01');
  const [feeDays, setFeeDays] = useState('30');

  // 5. DCA State
  const [dcaPeriodic, setDcaPeriodic] = useState('200');
  const [dcaPricesStr, setDcaPricesStr] = useState('68000, 62000, 58000, 64000, 66500');

  // Calculation results
  const posResult = calculatePositionSize({
    accountBalance: Number(posAccountBalance) || 0,
    riskPercentage: Number(posRiskPercentage) || 0,
    entryPrice: Number(posEntryPrice) || 0,
    stopLossPrice: Number(posStopLossPrice) || 0,
  });

  const pnlResult = calculatePnL({
    direction: pnlDirection,
    margin: Number(pnlMargin) || 0,
    leverage: Number(pnlLeverage) || 0,
    entryPrice: Number(pnlEntryPrice) || 0,
    exitPrice: Number(pnlExitPrice) || 0,
  });

  const liqResult = calculateLiquidationPrice({
    direction: liqDirection,
    entryPrice: Number(liqEntryPrice) || 0,
    leverage: Number(liqLeverage) || 1,
    maintenanceMarginRate: (Number(liqMmr) || 0.5) / 100,
  });

  const feeResult = calculateFundingFee({
    positionSizeUsd: Number(feePosSize) || 0,
    fundingRate8hPct: Number(feeRate8h) || 0,
    holdingDays: Number(feeDays) || 0,
  });

  const dcaPrices = dcaPricesStr
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => !isNaN(n) && n > 0);

  const dcaResult = calculateDca({
    periodicInvestmentUsd: Number(dcaPeriodic) || 0,
    prices: dcaPrices.length > 0 ? dcaPrices : [64000],
  });

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {/* Title */}
      <div className="pb-3 border-b border-white/[0.08]">
        <div className="flex items-center space-x-2">
          <Wrench className="w-5 h-5 text-cyan-400" />
          <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
            КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ (TOOLS)
          </h1>
          <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
            РАБОТАЮЩИЙ РАСЧЕТНЫЙ МОДУЛЬ
          </span>
        </div>
        <p className="text-xs text-slate-400 font-sans mt-0.5">
          Математически выверенные калькуляторы размера позиции, управления риском, ликвидаций, фандинга и DCA.
        </p>
      </div>

      {/* Row 1: Position Size & PnL / ROE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calculator 1: Position Size */}
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-panel">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-white/[0.06]">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
              Калькулятор размера позиции (Position Sizing)
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Баланс депозита ($)</label>
              <input
                type="number"
                value={posAccountBalance}
                onChange={(e) => setPosAccountBalance(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Риск на сделку (%)</label>
              <input
                type="number"
                step="0.1"
                value={posRiskPercentage}
                onChange={(e) => setPosRiskPercentage(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                value={posEntryPrice}
                onChange={(e) => setPosEntryPrice(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена Stop-Loss ($)</label>
              <input
                type="number"
                value={posStopLossPrice}
                onChange={(e) => setPosStopLossPrice(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>
          </div>

          {/* Result Box */}
          <div className="bg-[#070b14] rounded-xl p-4 space-y-2.5 border border-white/[0.06] shadow-inner font-mono text-xs">
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Сумма риска (Stop Loss $)</span>
              <span className="font-bold text-rose-400">
                -{formatCurrency(posResult.riskAmountUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Дистанция до Stop-Loss</span>
              <span className="font-semibold text-slate-300">
                ${posResult.stopLossDistanceUsd.toFixed(2)} ({posResult.stopLossDistancePct.toFixed(2)}%)
              </span>
            </div>

            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Расчетный объем позиции (USD)</span>
              <span className="font-bold text-cyan-400 text-sm">
                {formatCurrency(posResult.positionUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Размер позиции в монетах</span>
              <span className="font-semibold text-slate-300">
                {posResult.positionUnits.toFixed(4)}
              </span>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-white/[0.06] tabular-nums">
              <span className="text-slate-400">Рекомендуемое плечо</span>
              <span className="font-black text-amber-400 text-sm">
                {posResult.recommendedLeverage}x
              </span>
            </div>
          </div>
        </div>

        {/* Calculator 2: PnL & ROE */}
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-panel">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-white/[0.06]">
            <Calculator className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
              Калькулятор PnL & ROE (Прибыль / Убыток)
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Направление</label>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPnlDirection('LONG')}
                  className={`flex-1 py-2 rounded-lg border transition-all min-h-[38px] font-bold ${
                    pnlDirection === 'LONG'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50 shadow-sm'
                      : 'bg-[#111a30] text-slate-400 border-white/[0.08] hover:bg-[#162342]'
                  }`}
                >
                  LONG
                </button>
                <button
                  onClick={() => setPnlDirection('SHORT')}
                  className={`flex-1 py-2 rounded-lg border transition-all min-h-[38px] font-bold ${
                    pnlDirection === 'SHORT'
                      ? 'bg-rose-950/60 text-rose-300 border-rose-500/50 shadow-sm'
                      : 'bg-[#111a30] text-slate-400 border-white/[0.08] hover:bg-[#162342]'
                  }`}
                >
                  SHORT
                </button>
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Кредитное плечо</label>
              <input
                type="number"
                value={pnlLeverage}
                onChange={(e) => setPnlLeverage(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Маржа ($)</label>
              <input
                type="number"
                value={pnlMargin}
                onChange={(e) => setPnlMargin(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                value={pnlEntryPrice}
                onChange={(e) => setPnlEntryPrice(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-slate-400 block mb-1">Ожидаемая цена выхода ($)</label>
              <input
                type="number"
                value={pnlExitPrice}
                onChange={(e) => setPnlExitPrice(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 min-h-[38px] tabular-nums"
              />
            </div>
          </div>

          {/* Result Box */}
          <div className="bg-[#070b14] rounded-xl p-4 space-y-2.5 border border-white/[0.06] shadow-inner font-mono text-xs">
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Номинальный объем позиции</span>
              <span className="font-semibold text-white">
                {formatCurrency(pnlResult.positionUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Движение базовой цены</span>
              <span
                className={`font-semibold ${
                  pnlResult.priceDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {pnlResult.priceDeltaPct >= 0 ? '+' : ''}
                {pnlResult.priceDeltaPct.toFixed(2)}%
              </span>
            </div>

            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Чистый PnL ($)</span>
              <span
                className={`font-bold text-sm ${
                  pnlResult.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {pnlResult.pnlUsd >= 0 ? '+' : ''}
                {formatCurrency(pnlResult.pnlUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-white/[0.06] tabular-nums">
              <span className="text-slate-400">Доходность на маржу (ROE %)</span>
              <span
                className={`font-black text-sm ${
                  pnlResult.roePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatPercent(pnlResult.roePct)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Liquidation Price, Funding Fee & DCA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Calculator 3: Liquidation Price */}
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-panel">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-white/[0.06]">
            <Flame className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
              Цена ликвидации (Liq Price)
            </h2>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Позиция</label>
              <div className="flex space-x-2">
                <button
                  onClick={() => setLiqDirection('LONG')}
                  className={`flex-1 py-1.5 rounded-lg border transition-all text-xs min-h-[34px] font-bold ${
                    liqDirection === 'LONG'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
                      : 'bg-[#111a30] text-slate-400 border-white/[0.08] hover:bg-[#162342]'
                  }`}
                >
                  LONG
                </button>
                <button
                  onClick={() => setLiqDirection('SHORT')}
                  className={`flex-1 py-1.5 rounded-lg border transition-all text-xs min-h-[34px] font-bold ${
                    liqDirection === 'SHORT'
                      ? 'bg-rose-950/60 text-rose-300 border-rose-500/50'
                      : 'bg-[#111a30] text-slate-400 border-white/[0.08] hover:bg-[#162342]'
                  }`}
                >
                  SHORT
                </button>
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                value={liqEntryPrice}
                onChange={(e) => setLiqEntryPrice(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Плечо (x)</label>
                <input
                  type="number"
                  value={liqLeverage}
                  onChange={(e) => setLiqLeverage(e.target.value)}
                  className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">MMR (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={liqMmr}
                  onChange={(e) => setLiqMmr(e.target.value)}
                  className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#070b14] rounded-xl p-4 space-y-2.5 border border-white/[0.06] shadow-inner font-mono text-xs">
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Расчетная цена ликвидации</span>
              <span className="font-bold text-rose-400 text-sm">
                ${liqResult.liquidationPrice.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Дистанция до ликвидации</span>
              <span className="font-semibold text-amber-400">
                {liqResult.distancePct}%
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-white/[0.06] tabular-nums">
              <span className="text-slate-400">Цена банкротства (0 маржи)</span>
              <span className="text-slate-300">
                ${liqResult.bankruptcyPrice.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Calculator 4: Funding Fee Estimator */}
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-panel">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-white/[0.06]">
            <DollarSign className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
              Оценка комиссий фандинга
            </h2>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Объем позиции ($)</label>
              <input
                type="number"
                value={feePosSize}
                onChange={(e) => setFeePosSize(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Ставка 8h фандинга (%)</label>
              <input
                type="number"
                step="0.001"
                value={feeRate8h}
                onChange={(e) => setFeeRate8h(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Срок удержания (дней)</label>
              <input
                type="number"
                value={feeDays}
                onChange={(e) => setFeeDays(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
              />
            </div>
          </div>

          <div className="bg-[#070b14] rounded-xl p-4 space-y-2.5 border border-white/[0.06] shadow-inner font-mono text-xs">
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Начислений фандинга (8h)</span>
              <span className="font-semibold text-white">
                {feeResult.totalIntervals} сессий
              </span>
            </div>
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Суммарная комиссия ($)</span>
              <span className="font-bold text-violet-400 text-sm">
                ${feeResult.totalFeeUsd.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-white/[0.06] tabular-nums">
              <span className="text-slate-400">Годовой эквивалент (APR)</span>
              <span className="font-semibold text-amber-400">
                {feeResult.annualizedCostPct}% / год
              </span>
            </div>
          </div>
        </div>

        {/* Calculator 5: DCA Simulator */}
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-panel">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-white/[0.06]">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
              DCA Симулятор усреднения
            </h2>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Сумма регулярной покупки ($)</label>
              <input
                type="number"
                value={dcaPeriodic}
                onChange={(e) => setDcaPeriodic(e.target.value)}
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400 min-h-[36px] tabular-nums"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Ряд цен покупок через запятую</label>
              <input
                type="text"
                value={dcaPricesStr}
                onChange={(e) => setDcaPricesStr(e.target.value)}
                placeholder="68000, 62000, 58000, 64000"
                className="w-full bg-[#111a30] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white text-[11px] focus:outline-none focus:border-cyan-400 min-h-[36px]"
              />
            </div>
          </div>

          <div className="bg-[#070b14] rounded-xl p-4 space-y-2.5 border border-white/[0.06] shadow-inner font-mono text-xs">
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Всего инвестировано</span>
              <span className="font-semibold text-white">
                ${dcaResult.totalInvestedUsd.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Средняя цена входа</span>
              <span className="font-bold text-cyan-400">
                ${dcaResult.averageEntryPrice.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center tabular-nums">
              <span className="text-slate-400">Оценка портфеля</span>
              <span className="font-semibold text-white">
                ${dcaResult.currentPortfolioValue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-surface-border">
              <span className="text-slate-400">Результат (ROI %)</span>
              <span
                className={`font-bold text-sm ${
                  dcaResult.roiPct >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {dcaResult.roiPct >= 0 ? '+' : ''}{dcaResult.roiPct}% (${dcaResult.netProfitUsd >= 0 ? '+' : ''}${dcaResult.netProfitUsd.toLocaleString()})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
