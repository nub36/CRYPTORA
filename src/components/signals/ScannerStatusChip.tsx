/**
 * ScannerStatusChip — ЧЕСТНЫЙ статус сканирования сигналов (BUG C).
 *
 * Прежняя плашка читала браузерный движок и показывала «LIVE-скан · каждые 60с»
 * даже когда все стратегии в PostgreSQL выключены. Здесь источник — серверный
 * `/api/strategies`, и формулировки не допускают двух чтений:
 *
 *   • 0 включённых  → «Сканирование сигналов выключено» (не «LIVE», не «скоро»);
 *   • N включённых  → «Сканирование включено: N стратегий · каждые Xс»;
 *   • ERROR         → отдельная строка с ошибкой сканирования;
 *   • запрос упал   → «Статус сканирования недоступен», а не «выключено»:
 *     отсутствие ответа сервера — не доказательство выключенного сканера.
 *
 * Плашка НИЧЕГО не переключает: эндпоинта, меняющего состояние стратегий из
 * обычного UI, нет и не будет.
 */

import React from 'react';
import { Radio, ShieldCheck, AlertTriangle, HelpCircle } from 'lucide-react';
import type { ServerScannerState } from '@/hooks/useServerScanner';
import { formatIsoTimestamp } from '@/utils/timePresentation';

export type ScannerTone = 'off' | 'on' | 'error' | 'unknown';

export interface ScannerStatusView {
  tone: ScannerTone;
  /** Основная строка — короткая, без технических токенов. */
  title: string;
  /** Уточнение: интервал, время последнего скана, текст ошибки. */
  detail: string | null;
}

/**
 * Чистая функция «состояние сервера → что показать». Покрыта юнит-тестом:
 * именно она гарантирует, что выключенный сканер никогда не назван LIVE.
 */
export function describeScannerStatus(state: ServerScannerState): ScannerStatusView {
  if (state.phase === 'error') {
    return {
      tone: 'unknown',
      title: 'Статус сканирования недоступен',
      detail: state.error?.message ?? 'Сервер не ответил на запрос состояния стратегий.',
    };
  }
  if (state.phase === 'loading') {
    return { tone: 'unknown', title: 'Уточняем состояние сканирования…', detail: null };
  }

  if (state.enabledCount === 0) {
    if (state.errorCount > 0) {
      // Защита от молчаливой поломки: сканер запущен, но каждая стратегия
      // падает. Это не «выключено» — это неисправность.
      return {
        tone: 'error',
        title: `Сканирование не работает: ошибка у ${state.errorCount} ${plural(state.errorCount, 'стратегии', 'стратегий', 'стратегий')}`,
        detail: state.lastError ?? 'Сервер отвечает, но скан стратегий завершается ошибкой.',
      };
    }
    return {
      tone: 'off',
      title: 'Сканирование сигналов выключено',
      detail:
        'Ни одна стратегия не включена — сервер не ищет новые сетапы. Ранее опубликованные сигналы продолжают отслеживаться.',
    };
  }

  const interval = state.scanIntervalSeconds;
  const parts: string[] = [];
  if (interval) parts.push(`каждые ${interval} с`);
  if (state.lastScanAt) parts.push(`последний скан ${formatIsoTimestamp(state.lastScanAt)}`);

  if (state.errorCount > 0) {
    return {
      tone: 'error',
      title: `Сканирование включено: ${state.enabledCount}, с ошибкой: ${state.errorCount}`,
      detail: state.lastError ?? 'Часть стратегий завершила скан с ошибкой.',
    };
  }

  return {
    tone: 'on',
    title: `Сканирование включено: ${state.enabledCount} ${plural(state.enabledCount, 'стратегия', 'стратегии', 'стратеги')}`,
    detail: parts.length > 0 ? parts.join(' · ') : null,
  };
}

/** Русское склонение по числу: 1 стратегия, 2 стратегии, 5 стратеги. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const TONE_CLASS: Record<ScannerTone, string> = {
  off: 'text-slate-400',
  on: 'text-emerald-400',
  error: 'text-amber-400',
  unknown: 'text-slate-500',
};

const TONE_DATA: Record<ScannerTone, string> = {
  off: 'off',
  on: 'on',
  error: 'error',
  unknown: 'unknown',
};

export const ScannerStatusChip: React.FC<{ state: ServerScannerState }> = ({ state }) => {
  const view = describeScannerStatus(state);
  const Icon =
    view.tone === 'on' ? Radio : view.tone === 'error' ? AlertTriangle : view.tone === 'off' ? ShieldCheck : HelpCircle;

  return (
    <div
      data-qa="signals-scanner-status"
      data-state={TONE_DATA[view.tone]}
      data-enabled-count={state.enabledCount}
      className="flex max-w-full flex-col gap-0.5"
    >
      <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${TONE_CLASS[view.tone]}`}>
        <Icon className={`h-3 w-3 shrink-0 ${view.tone === 'on' ? 'animate-pulse' : ''}`} aria-hidden="true" />
        <span data-qa="signals-scanner-status-title">{view.title}</span>
      </span>
      {view.detail && (
        <span className="pl-[18px] text-[11px] leading-snug text-slate-500" data-qa="signals-scanner-status-detail">
          {view.detail}
        </span>
      )}
    </div>
  );
};

export default ScannerStatusChip;
