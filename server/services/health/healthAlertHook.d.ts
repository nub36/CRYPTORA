/** Декларации для server/services/health/healthAlertHook.js. */

import type { HealthAlerter } from './healthAlerts.js';

export function registerHealthAlertHook(fn: (() => unknown) | null): void;
/** Никогда не бросает: Telegram не имеет права уронить цикл монитора. */
export function notifyHealthCycle(): void;
export function createThrottledHealthAlertHook(options: {
  buildReport: () => Promise<unknown>;
  alerter: Pick<HealthAlerter, 'evaluate'>;
  minIntervalMs?: number;
  now?: () => number;
}): () => Promise<void>;
