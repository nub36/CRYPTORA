import { z } from 'zod';
import { AdapterNetworkError, AdapterValidationError } from './errors';

/**
 * mempool.space — публичный REST API сети Bitcoin без ключа.
 *  GET /api/v1/mining/hashrate/3d      → { hashrates:[{timestamp,avgHashrate}], currentHashrate, currentDifficulty }
 *  GET /api/v1/difficulty-adjustment   → { progressPercent, difficultyChange, remainingBlocks, estimatedRetargetDate, ... }
 *  GET /api/v1/fees/recommended        → { fastestFee, halfHourFee, hourFee, economyFee, minimumFee } (sat/vB)
 *  GET /api/mempool                    → { count, vsize, total_fee }
 *  GET /api/blocks/tip/height          → number
 */
const HashrateSchema = z.object({
  hashrates: z.array(z.object({ timestamp: z.number(), avgHashrate: z.number() })),
  currentHashrate: z.number(),
  currentDifficulty: z.number(),
});
const DifficultySchema = z.object({
  progressPercent: z.number(),
  difficultyChange: z.number(),
  remainingBlocks: z.number(),
  estimatedRetargetDate: z.number(),
});
const FeesSchema = z.object({
  fastestFee: z.number(),
  halfHourFee: z.number(),
  hourFee: z.number(),
  economyFee: z.number(),
  minimumFee: z.number(),
});
const MempoolSchema = z.object({ count: z.number(), vsize: z.number(), total_fee: z.number() });
const HeightSchema = z.number().int().nonnegative();

export type BtcHashrate = z.infer<typeof HashrateSchema>;
export type BtcDifficultyAdjustment = z.infer<typeof DifficultySchema>;
export type BtcRecommendedFees = z.infer<typeof FeesSchema>;
export type BtcMempool = z.infer<typeof MempoolSchema>;

export class MempoolSpaceAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = config.baseUrl ?? 'https://mempool.space';
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (!res.ok) throw new AdapterNetworkError('mempool.space', new Error(`HTTP ${res.status}`));
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new AdapterValidationError('mempool.space', `non-JSON body for ${path}`);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new AdapterValidationError('mempool.space', parsed.error.message);
      return parsed.data;
    } catch (e) {
      if (e instanceof AdapterNetworkError || e instanceof AdapterValidationError) throw e;
      throw new AdapterNetworkError('mempool.space', e instanceof Error ? e : new Error(String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  public fetchHashrate3d(): Promise<BtcHashrate> {
    return this.get('/api/v1/mining/hashrate/3d', HashrateSchema);
  }
  public fetchDifficultyAdjustment(): Promise<BtcDifficultyAdjustment> {
    return this.get('/api/v1/difficulty-adjustment', DifficultySchema);
  }
  public fetchRecommendedFees(): Promise<BtcRecommendedFees> {
    return this.get('/api/v1/fees/recommended', FeesSchema);
  }
  public fetchMempool(): Promise<BtcMempool> {
    return this.get('/api/mempool', MempoolSchema);
  }
  public fetchTipHeight(): Promise<number> {
    return this.get('/api/blocks/tip/height', HeightSchema);
  }
}
