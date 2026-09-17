import { z } from 'zod';
import { AdapterNetworkError, AdapterValidationError } from './errors';

/**
 * DeFiLlama — публичный API без ключа.
 * `GET https://api.llama.fi/v2/chains` → [{ gecko_id, tvl, tokenSymbol, cmcId, name, chainId }]
 * `GET https://api.llama.fi/v2/historicalChainTvl/{chain}` → [{ date (unix s), tvl }] — для Δ7д.
 */
const ChainSchema = z.object({
  name: z.string(),
  tvl: z.number(),
  tokenSymbol: z.string().nullable().optional(),
  gecko_id: z.string().nullable().optional(),
});
const ChainsSchema = z.array(ChainSchema);
const HistSchema = z.array(z.object({ date: z.number(), tvl: z.number() }));

export interface ChainTvl {
  name: string;
  tokenSymbol: string | null;
  tvlUsd: number;
}

export class DefiLlamaAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.llama.fi';
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new AdapterNetworkError('defillama', new Error(`HTTP ${res.status}`));
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) throw new AdapterValidationError('defillama', parsed.error.message);
      return parsed.data;
    } catch (e) {
      if (e instanceof AdapterNetworkError || e instanceof AdapterValidationError) throw e;
      throw new AdapterNetworkError('defillama', e instanceof Error ? e : new Error(String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchChains(): Promise<ChainTvl[]> {
    const rows = await this.get('/v2/chains', ChainsSchema);
    return rows.map((r) => ({ name: r.name, tokenSymbol: r.tokenSymbol ?? null, tvlUsd: r.tvl }));
  }

  /** Дневной ряд TVL сети (по возрастанию даты). */
  public async fetchChainHistory(chain: string): Promise<Array<{ date: number; tvl: number }>> {
    const rows = await this.get(`/v2/historicalChainTvl/${encodeURIComponent(chain)}`, HistSchema);
    return [...rows].sort((a, b) => a.date - b.date);
  }
}
