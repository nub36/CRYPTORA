import React from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { PLAN_DEFINITIONS, PlanTier, PlanManager } from '@/services/subscription/PlanManager';
import { ShieldCheck, X, Check, Sparkles, Zap, Building2, User } from 'lucide-react';

export const PlanModal: React.FC = () => {
  const { isPlanModalOpen, closePlanModal, userPlan, setUserPlan } = useMarketData();

  if (!isPlanModalOpen) return null;

  const tiers: PlanTier[] = ['FREE', 'PRO', 'ENTERPRISE'];

  const handleSelectTier = (tier: PlanTier) => {
    setUserPlan(tier);
    PlanManager.setPlan(tier);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl bg-surface border border-surface-border rounded-xl shadow-2xl p-6 text-slate-200 overflow-hidden">
        <button
          onClick={closePlanModal}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2.5 rounded-full bg-brand-purple/20 text-brand-purple border border-brand-purple/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight font-sans">
              Тарифные планы и аналитический доступ
            </h3>
            <p className="text-xs text-slate-400 font-sans">
              Масштабируемый терминал рыночной информации. CRYPTORA не исполняет ордера и не требует торговых ключей.
            </p>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {tiers.map((tierKey) => {
            const plan = PLAN_DEFINITIONS[tierKey];
            const isCurrent = userPlan === tierKey;

            return (
              <div
                key={tierKey}
                className={`rounded-lg p-5 flex flex-col justify-between border transition-all ${
                  isCurrent
                    ? 'bg-surface-elevated border-brand-cyan shadow-lg shadow-sky-500/10'
                    : 'bg-surface border-surface-border hover:border-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-sans text-xs uppercase font-bold text-slate-300 flex items-center space-x-1.5">
                      {tierKey === 'FREE' && <User className="w-3.5 h-3.5 text-slate-400" />}
                      {tierKey === 'PRO' && <Zap className="w-3.5 h-3.5 text-brand-cyan" />}
                      {tierKey === 'ENTERPRISE' && <Building2 className="w-3.5 h-3.5 text-brand-purple" />}
                      <span>{plan.name}</span>
                    </span>
                    {isCurrent && (
                      <span className="text-[11px] font-sans text-brand-cyan bg-brand-cyan/15 px-2 py-0.5 rounded border border-brand-cyan/30 font-bold">
                        АКТИВЕН
                      </span>
                    )}
                  </div>

                  <div className="mb-4">
                    <div className="flex items-baseline space-x-1 font-sans">
                      <span className="text-2xl font-black text-white">
                        ${plan.priceMonthlyUsd}
                      </span>
                      <span className="text-xs text-slate-400">/ месяц</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-sans mt-1">
                      {plan.description}
                    </p>
                  </div>

                  <div className="space-y-2 border-t border-surface-border/60 pt-3 mb-6">
                    <span className="text-[11px] font-sans text-slate-400 tracking-wide block">
                      Возможности тарифа:
                    </span>
                    <ul className="space-y-1.5 text-xs font-sans text-slate-300">
                      {plan.features.map((feat, i) => (
                        <li key={i} className="flex items-start space-x-2 text-[11px]">
                          <Check className="w-3.5 h-3.5 text-brand-green flex-shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  onClick={() => handleSelectTier(tierKey)}
                  className={`w-full py-2 rounded text-xs font-mono font-bold transition-all ${
                    isCurrent
                      ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40 cursor-default'
                      : 'bg-surface-elevated hover:bg-surface-hover text-white border border-surface-border'
                  }`}
                >
                  {isCurrent ? 'Текущий план' : 'Переключить на ' + plan.name}
                </button>
              </div>
            );
          })}
        </div>

        {/* Disclaimer Footer */}
        <div className="p-3 bg-surface-elevated/50 rounded-lg border border-surface-border flex items-center justify-between text-xs font-sans text-slate-400">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-brand-green flex-shrink-0" />
            <span className="text-[11px]">
              Тарифы определяют пропускную способность WebSocket, лимиты алертов и глубину аналитических моделей. Терминал не взимает комиссий за сделки.
            </span>
          </div>

          <button
            onClick={closePlanModal}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded transition-colors ml-4 whitespace-nowrap"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
