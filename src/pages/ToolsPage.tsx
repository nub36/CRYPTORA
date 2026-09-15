import React, { useState } from 'react';
import {
  calculatePositionSize,
  calculatePnL,
} from '@/utils/calculators';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Wrench, Shield, Calculator, Clock } from 'lucide-react';

export const ToolsPage: React.FC = () => {
  // Position Size State
  const [posAccountBalance, setPosAccountBalance] = useState('10000');
  const [posRiskPercentage, setPosRiskPercentage] = useState('2');
  const [posEntryPrice, setPosEntryPrice] = useState('64850');
  const [posStopLossPrice, setPosStopLossPrice] = useState('63200');

  // PnL State
  const [pnlDirection, setPnlDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [pnlMargin, setPnlMargin] = useState('1000');
  const [pnlLeverage, setPnlLeverage] = useState('10');
  const [pnlEntryPrice, setPnlEntryPrice] = useState('64850');
  const [pnlExitPrice, setPnlExitPrice] = useState('67200');

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

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="pb-3 border-b border-surface-border">
        <div className="flex items-center space-x-2">
          <Wrench className="w-5 h-5 text-brand-cyan" />
          <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
            КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ (TOOLS)
          </h1>
          <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
            РАБОТАЮЩИЙ РАСЧЕТНЫЙ МОДУЛЬ
          </span>
        </div>
        <p className="text-xs text-slate-400 font-sans mt-0.5">
          Математически выверенные калькуляторы размера позиции, управления риском и моделирования PnL.
        </p>
      </div>

      {/* Working Calculators Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calculator 1: Position Size */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-brand-green" />
              <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
                Калькулятор размера позиции (Position Size)
              </h2>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Risk First Model</span>
          </div>

          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            Рассчитывает точный объем сделки на основе допустимого убытка в процентах от депозита при срабатывании Stop-Loss.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Баланс депозита ($)</label>
              <input
                type="number"
                value={posAccountBalance}
                onChange={(e) => setPosAccountBalance(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Риск на сделку (%)</label>
              <input
                type="number"
                step="0.5"
                value={posRiskPercentage}
                onChange={(e) => setPosRiskPercentage(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                value={posEntryPrice}
                onChange={(e) => setPosEntryPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена Stop-Loss ($)</label>
              <input
                type="number"
                value={posStopLossPrice}
                onChange={(e) => setPosStopLossPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>
          </div>

          {/* Result Box */}
          <div className="p-4 bg-surface-elevated/70 border border-surface-border rounded-md font-mono text-xs space-y-2.5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold border-b border-surface-border pb-1">
              Результат расчета риска
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Сумма риска (Stop Loss $)</span>
              <span className="font-bold text-rose-400">
                {formatCurrency(posResult.riskAmountUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Дистанция до стопа</span>
              <span className="text-slate-200">
                {formatCurrency(posResult.stopLossDistanceUsd)} ({posResult.stopLossDistancePct.toFixed(2)}%)
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Объем позиции (в монетах)</span>
              <span className="font-bold text-white">
                {posResult.positionUnits.toFixed(4)} Units
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Номинал позиции ($ Notional)</span>
              <span className="font-bold text-brand-cyan text-sm">
                {formatCurrency(posResult.positionUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-surface-border">
              <span className="text-slate-400">Мин. плечо без довнесения</span>
              <span className="font-bold text-amber-400">
                {posResult.recommendedLeverage}x
              </span>
            </div>
          </div>
        </div>

        {/* Calculator 2: Futures PnL & ROE */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-2">
              <Calculator className="w-4 h-4 text-brand-cyan" />
              <h2 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
                Калькулятор PnL & ROE (Futures)
              </h2>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Profit / Loss</span>
          </div>

          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            Симуляция финансового результата сделки с учетом направления, маржи и кредитного плеча.
          </p>

          <div className="flex items-center space-x-2 font-mono text-xs">
            <button
              onClick={() => setPnlDirection('LONG')}
              className={`flex-1 py-1.5 rounded font-bold transition-colors ${
                pnlDirection === 'LONG'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-surface-elevated text-slate-400 hover:text-white'
              }`}
            >
              LONG (Покупка)
            </button>
            <button
              onClick={() => setPnlDirection('SHORT')}
              className={`flex-1 py-1.5 rounded font-bold transition-colors ${
                pnlDirection === 'SHORT'
                  ? 'bg-rose-600 text-white'
                  : 'bg-surface-elevated text-slate-400 hover:text-white'
              }`}
            >
              SHORT (Продажа)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Выделенная маржа ($)</label>
              <input
                type="number"
                value={pnlMargin}
                onChange={(e) => setPnlMargin(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Кредитное плечо (x)</label>
              <input
                type="number"
                value={pnlLeverage}
                onChange={(e) => setPnlLeverage(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена входа ($)</label>
              <input
                type="number"
                value={pnlEntryPrice}
                onChange={(e) => setPnlEntryPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Цена выхода ($)</label>
              <input
                type="number"
                value={pnlExitPrice}
                onChange={(e) => setPnlExitPrice(e.target.value)}
                className="w-full bg-surface-elevated border border-surface-border rounded px-3 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
              />
            </div>
          </div>

          {/* PnL Result Box */}
          <div className="p-4 bg-surface-elevated/70 border border-surface-border rounded-md font-mono text-xs space-y-2.5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold border-b border-surface-border pb-1">
              Результат симуляции
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Объем позиции ($)</span>
              <span className="text-white font-semibold">
                {formatCurrency(pnlResult.positionUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Изменение базовой цены</span>
              <span
                className={`font-semibold ${
                  pnlResult.priceDeltaPct >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {formatPercent(pnlResult.priceDeltaPct)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Чистый PnL ($)</span>
              <span
                className={`font-bold text-sm ${
                  pnlResult.pnlUsd >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {pnlResult.pnlUsd >= 0 ? '+' : ''}
                {formatCurrency(pnlResult.pnlUsd)}
              </span>
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-surface-border">
              <span className="text-slate-400">Доходность на маржу (ROE %)</span>
              <span
                className={`font-black text-sm ${
                  pnlResult.roePct >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {formatPercent(pnlResult.roePct)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Roadmap of Upcoming Specialized Tools */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-3">
        <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
          <Clock className="w-4 h-4 text-brand-purple" />
          <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
            Дорожная карта следующих калькуляторов
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-sans text-slate-400">
          <div className="p-3 rounded bg-surface-elevated/40 border border-surface-border space-y-1">
            <strong className="text-slate-200 block font-mono">Liquidation Price Calculator</strong>
            <p className="text-[11px]">
              Моделирование точной цены маржин-колла с учетом поддерживающей маржи биржи (Maintenance Margin Rate).
            </p>
          </div>

          <div className="p-3 rounded bg-surface-elevated/40 border border-surface-border space-y-1">
            <strong className="text-slate-200 block font-mono">Funding Fee Estimator</strong>
            <p className="text-[11px]">
              Расчет накопленных комиссий за удержание бессрочного фьючерса на горизонтах 7d, 30d, 90d.
            </p>
          </div>

          <div className="p-3 rounded bg-surface-elevated/40 border border-surface-border space-y-1">
            <strong className="text-slate-200 block font-mono">DCA Simulator</strong>
            <p className="text-[11px]">
              Симуляция стратегии усреднения долларовой стоимости (Dollar-Cost Averaging) с ребалансировкой.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
