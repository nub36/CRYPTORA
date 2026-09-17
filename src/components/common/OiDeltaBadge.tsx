import React from 'react';

/**
 * Маркер происхождения Δ OI. ACTUAL — из исторического ряда OI биржи (Binance openInterestHist, шаг 1h);
 * ESTIMATED — эвристика от изменения цены (когда ряд недоступен). Без маркера ESTIMATED пользователь
 * принимал бы оценку за факт.
 */
export const OiDeltaBadge: React.FC<{ source?: 'ACTUAL' | 'ESTIMATED' }> = ({ source }) => {
  if (source === 'ACTUAL') return null;
  return (
    <span
      data-qa="oi-delta-estimated"
      title="MODEL / ESTIMATED: исторический ряд OI недоступен — значение оценено по изменению цены"
      className="ml-1 rounded border border-white/[0.12] bg-white/[0.06] px-1 py-px font-mono text-[11px] font-semibold text-slate-400"
    >
      EST.
    </span>
  );
};
