import React from 'react';

/**
 * Маркер происхождения Δ OI.
 * ACTUAL — из исторического ряда OI биржи (Binance openInterestHist, шаг 1h);
 * ESTIMATED — эвристика от изменения цены (устаревший, не используется в v0.8.44+);
 * UNAVAILABLE — ряд OI недоступен, значение null (не заменяется нулём или эвристикой).
 */
export const OiDeltaBadge: React.FC<{ source?: 'ACTUAL' | 'ESTIMATED' | 'UNAVAILABLE' }> = ({ source }) => {
  if (source === 'ACTUAL') return null;
  if (source === 'UNAVAILABLE') {
    return (
      <span
        data-qa="oi-delta-unavailable"
        title="UNAVAILABLE: исторический ряд OI недоступен — данные отсутствуют"
        className="ml-1 rounded border border-white/[0.12] bg-white/[0.06] px-1 py-px font-mono text-[11px] font-semibold text-slate-500"
      >
        Нет данных
      </span>
    );
  }
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
