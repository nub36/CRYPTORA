import { z } from 'zod';
import { AdapterNetworkError, AdapterValidationError } from './errors';

/**
 * Alternative.me Crypto Fear & Greed Index — публичный endpoint без ключа.
 * https://api.alternative.me/fng/?limit=1
 * Ответ: { data: [{ value: "62", value_classification: "Greed", timestamp: "1726531200", time_until_update: "..." }] }
 * Индекс обновляется раз в сутки; кэшируем 10 мин.
 */
const FngResponseSchema = z.object({
  data: z
    .array(
      z.object({
        value: z.string(),
        value_classification: z.string(),
        timestamp: z.string(),
      })
    )
    .min(1),
});

export type FearGreedSentiment = 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';

export interface FearGreedReading {
  value: number;
  sentiment: FearGreedSentiment;
  /** Unix ms момента расчёта индекса источником. */
  timestamp: number;
  source: 'alternative.me';
}

/** Классификация по официальным порогам Alternative.me (0–24 / 25–44 / 45–55 / 56–75 / 76–100). */
export function classifyFearGreed(value: number): FearGreedSentiment {
  if (value <= 24) return 'Extreme Fear';
  if (value <= 44) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

export class AlternativeMeAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.alternative.me';
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  public async fetchLatest(): Promise<FearGreedReading> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}/fng/?limit=1`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new AdapterNetworkError('alternative.me', new Error(`HTTP ${res.status}`));
      const parsed = FngResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new AdapterValidationError('alternative.me', parsed.error.message);
      const row = parsed.data.data[0];
      const value = Number.parseInt(row.value, 10);
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new AdapterValidationError('alternative.me', `value ${row.value}`);
      return {
        value,
        // Классифицируем сами по порогам источника, чтобы не зависеть от локали строки value_classification.
        sentiment: classifyFearGreed(value),
        timestamp: Number.parseInt(row.timestamp, 10) * 1000,
        source: 'alternative.me',
      };
    } catch (e) {
      if (e instanceof AdapterNetworkError || e instanceof AdapterValidationError) throw e;
      throw new AdapterNetworkError('alternative.me', e instanceof Error ? e : new Error(String(e)));
    } finally {
      clearTimeout(timer);
    }
  }
}
