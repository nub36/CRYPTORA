/**
 * Линии на графике: ТОЛЬКО уровни, которые прислал сервер.
 *
 * Здесь нет ни одного вычисления уровней. Если сервер не отдал
 * `initialStopLoss` (null), линия стопа не рисуется — и уж точно не берётся
 * цена входа. Безубыток показывается только при подтверждённом
 * `progress.currentStop` (сервер доказал, что стоп переведён и действует).
 * TP1/TP2 — только из `targets`.
 */
import type { SignalView } from './api/types';

export type ChartLevelTone = 'entry' | 'stop' | 'target' | 'be';

export interface ChartLevel {
  /** Стабильный ключ для тестов и легенды: 'sl', 'tp1', 'tp2', 'be'. */
  key: string;
  label: string;
  price: number;
  tone: ChartLevelTone;
}

export interface ChartOverlay {
  /** Коридор входа сервера (не «средняя цена»). */
  zone: { low: number; high: number } | null;
  levels: ChartLevel[];
  /** Сигнал, с которого взяты уровни; null — уровней нет. */
  signalId: string | null;
}

export const EMPTY_OVERLAY: ChartOverlay = Object.freeze({ zone: null, levels: [], signalId: null });

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function chartOverlayForSignal(signal: SignalView | null | undefined): ChartOverlay {
  if (!signal) return EMPTY_OVERLAY;
  const levels: ChartLevel[] = [];
  const zone = signal.entryZone && finite(signal.entryZone.low) && finite(signal.entryZone.high)
    ? { low: signal.entryZone.low, high: signal.entryZone.high }
    : null;

  if (finite(signal.initialStopLoss)) {
    levels.push({ key: 'sl', label: 'SL', price: signal.initialStopLoss, tone: 'stop' });
  }
  for (const target of Array.isArray(signal.targets) ? signal.targets : []) {
    if (!finite(target.price)) continue;
    levels.push({
      key: `tp${target.level}`,
      label: `TP${target.level}`,
      price: target.price,
      tone: 'target',
    });
  }
  if (finite(signal.progress?.currentStop)) {
    levels.push({
      key: 'be',
      label: 'BE · действующий стоп',
      price: signal.progress.currentStop,
      tone: 'be',
    });
  }

  return { zone, levels, signalId: signal.id };
}

/**
 * Уровни берутся с самого свежего сигнала пары (сервер отдаёт ленту новыми
 * сверху). Нет сигналов — нет уровней; «примерных» линий не бывает.
 */
export function chartOverlayForLatestSignal(signals: readonly SignalView[]): ChartOverlay {
  const latest = signals.length > 0 ? signals[0] : null;
  return chartOverlayForSignal(latest ?? null);
}
