/**
 * CRYPTORA — Strategy Lab · кнопка ОБУЧЕНИЕ (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Phase 1A: только кнопка + краткая памятка. Полноценное перемещаемое окно
 * обучения (draggable за шапку, Pointer Events) и Lab-тест — СЛЕДУЮЩИЙ этап
 * (§23–§25). Здесь НЕТ глобального tutorial-компонента и НЕТ правок shared UI —
 * всё локально в src/components/strategyLab.
 */

import React, { useState } from 'react';
import { GraduationCap, X } from 'lucide-react';

const TOPICS = [
  'выбор стратегии, рынка, символа, таймфрейма и диапазона дат',
  'параметры индикаторов и стратегии (EMA, ATR, Stop, Target R, комиссия, проскальзывание)',
  'запуск бэктеста и чтение графика (LONG/SHORT, вход, стоп, TP)',
  'вкладки ОБЗОР / СДЕЛКИ / ОТКАЗЫ и смысл метрик (net R, win rate, profit factor)',
  'что такое look-ahead и почему решение на баре i не видит будущее',
  'RESEARCH ONLY: Lab не меняет production-стратегии и не создаёт сигналы',
];

export const LabTutorialButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-lab-tutorial="tutorial-button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-[13px] font-semibold text-violet-200 hover:bg-violet-500/25"
      >
        <GraduationCap className="h-4 w-4" />
        Обучение
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-white/[0.12] bg-surface-elevated p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Обучение по Лаборатории</h4>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-slate-400">
            Полноценное интерактивное обучение с перемещаемым окном и тестом появится
            на следующем этапе. Оно объяснит:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-slate-300">
            {TOPICS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
