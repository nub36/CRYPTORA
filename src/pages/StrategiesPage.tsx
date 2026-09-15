import React from 'react';
import { Cpu, ShieldCheck, PlayCircle, Lock } from 'lucide-react';
import { Badge } from '@/components/common/Badge';

export const StrategiesPage: React.FC = () => {
  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-brand-purple" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              STRATEGY LAB (ЛАБОРАТОРИЯ СТРАТЕГИЙ)
            </h1>
            <Badge variant="purple" size="sm">
              АРХИТЕКТУРНЫЙ ПРОТОТИП
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Конструктор формализованных рыночных правил и условий входа/выхода без программирования.
          </p>
        </div>

        <div className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/30">
          Запланировано на Этап 13 (Strategy Engine)
        </div>
      </div>

      {/* Honest Status Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-mono font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Честный статус разработки: модуль не симулирует ложные сделки</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          CRYPTORA следует принципу честной разработки. Мы намеренно <strong>не генерируем фальшивые кнопки автоматической торговли или вымышленные графики доходности</strong> до тех пор, пока не будет развернут исторический движок данных и проверенный бэктест без заглядывания в будущее (No Look-Ahead Bias).
        </p>
      </div>

      {/* Visual Rule Builder Mockup */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-5">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <span className="font-mono font-bold text-xs uppercase tracking-wider text-white">
            Интерактивный макет конструктора логических условий
          </span>
          <span className="text-[10px] font-mono text-slate-500">YAML / Rule Definition Schema</span>
        </div>

        {/* Rule 1 Example */}
        <div className="space-y-3 font-mono text-xs">
          <div className="p-3 bg-surface-elevated/80 border border-surface-border rounded-md space-y-2">
            <div className="flex items-center justify-between text-brand-cyan font-bold">
              <span>Условие открытия позиции: LONG ENTRY</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                AND Логика
              </span>
            </div>

            <div className="space-y-1.5 pl-3 border-l-2 border-brand-cyan/40 text-slate-300 text-xs">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
                <span>Ставка Funding Rate &lt; -0.015% (Шортисты перегружены)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
                <span>Открытый интерес (OI) 24h &gt; +5.0% (Приток институционалов)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
                <span>Текущая цена &gt; Скользящая средняя SMA-200</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
                <span>Индикатор RSI (14) в диапазоне от 40 до 65</span>
              </div>
            </div>
          </div>

          {/* Exit Rules */}
          <div className="p-3 bg-surface-elevated/80 border border-surface-border rounded-md space-y-2">
            <div className="flex items-center justify-between text-rose-400 font-bold">
              <span>Правила фиксации и отмены (Risk & Exit Rules)</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                Risk Engine
              </span>
            </div>

            <div className="space-y-1.5 pl-3 border-l-2 border-rose-500/40 text-slate-300 text-xs">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Take Profit 1: +3.5% от цены входа (закрытие 50% объема)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                <span>Stop Loss: -1.8% от цены входа (жесткая инвалидация)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>Экстренный выход: если Funding переворачивается в &gt; +0.03%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button Disabled with Lock */}
        <div className="pt-2 flex items-center justify-between text-xs text-slate-400 font-mono">
          <div className="flex items-center space-x-2">
            <Lock className="w-4 h-4 text-slate-500" />
            <span>Запуск симуляции станет доступен после подключения Этапа 12 (Backtest)</span>
          </div>
          <button
            disabled
            className="px-4 py-2 bg-slate-800 text-slate-500 font-bold rounded cursor-not-allowed flex items-center space-x-2"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Запустить бэктест стратегии (Locked)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
