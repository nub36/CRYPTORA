import { DefiLlamaAdapter, type ChainTvl } from '@/services/data/adapters/DefiLlamaAdapter';

/**
 * Экосистемы (v0.8.30): только то, что отдаёт фактический источник — TVL по сетям (DeFiLlama, публичный API).
 * Комиссии/TPS/адреса/стейблкоины из прежнего статического набора удалены: у терминала нет их источника.
 */
export interface NetworkEcosystem {
  id: string;
  name: string;
  chainSymbol: string;
  layer: 'L1' | 'L2';
  tvlUsd: number;
  /** Δ TVL за 7 дней, %; null — истории нет. */
  tvlChange7d: number | null;
}

export interface EcosystemOverview {
  totalTvlUsd: number;
  l2TvlUsd: number;
  l2SharePct: number;
  /** Суммарный TVL всех сетей источника (не только отслеживаемых). */
  allChainsTvlUsd: number;
}

export interface EcosystemReport {
  networks: NetworkEcosystem[];
  overview: EcosystemOverview;
  source: 'defillama';
  fetchedAt: number;
}

/** Отслеживаемые сети: имя у DeFiLlama, слой. Тикер — для отображения. */
export const TRACKED_CHAINS: ReadonlyArray<{ llamaName: string; id: string; symbol: string; layer: 'L1' | 'L2' }> = [
  { llamaName: 'Ethereum', id: 'ethereum', symbol: 'ETH', layer: 'L1' },
  { llamaName: 'Solana', id: 'solana', symbol: 'SOL', layer: 'L1' },
  { llamaName: 'BSC', id: 'bsc', symbol: 'BNB', layer: 'L1' },
  { llamaName: 'Tron', id: 'tron', symbol: 'TRX', layer: 'L1' },
  { llamaName: 'Avalanche', id: 'avalanche', symbol: 'AVAX', layer: 'L1' },
  { llamaName: 'Sui', id: 'sui', symbol: 'SUI', layer: 'L1' },
  { llamaName: 'Arbitrum', id: 'arbitrum', symbol: 'ARB', layer: 'L2' },
  { llamaName: 'Base', id: 'base', symbol: 'ETH', layer: 'L2' },
  { llamaName: 'OP Mainnet', id: 'optimism', symbol: 'OP', layer: 'L2' },
  { llamaName: 'Polygon', id: 'polygon', symbol: 'POL', layer: 'L2' },
];

/** Δ7д по дневному ряду TVL: последняя точка против точки ≥7 дней назад. */
export function tvlChange7dFromHistory(hist: ReadonlyArray<{ date: number; tvl: number }>): number | null {
  if (hist.length < 2) return null;
  const last = hist[hist.length - 1];
  const target = last.date - 7 * 86400;
  let base: { date: number; tvl: number } | null = null;
  for (const p of hist) if (p.date <= target) base = p;
  if (!base || base.tvl <= 0 || last.date - base.date > 9 * 86400) return null;
  return Number((((last.tvl - base.tvl) / base.tvl) * 100).toFixed(2));
}

/** Чистая сборка отчёта из данных источника. Сети, которых нет в ответе, пропускаются. */
export function buildEcosystemReport(
  chains: readonly ChainTvl[],
  histories: Readonly<Record<string, ReadonlyArray<{ date: number; tvl: number }>>>,
  fetchedAt: number,
): EcosystemReport {
  const byName = new Map(chains.map((c) => [c.name.toLowerCase(), c]));
  const networks: NetworkEcosystem[] = [];
  for (const t of TRACKED_CHAINS) {
    const c = byName.get(t.llamaName.toLowerCase());
    if (!c || !(c.tvlUsd >= 0)) continue;
    networks.push({
      id: t.id,
      name: t.llamaName,
      chainSymbol: t.symbol,
      layer: t.layer,
      tvlUsd: c.tvlUsd,
      tvlChange7d: tvlChange7dFromHistory(histories[t.llamaName] ?? []),
    });
  }
  networks.sort((a, b) => b.tvlUsd - a.tvlUsd);
  const totalTvlUsd = networks.reduce((a, n) => a + n.tvlUsd, 0);
  const l2TvlUsd = networks.filter((n) => n.layer === 'L2').reduce((a, n) => a + n.tvlUsd, 0);
  return {
    networks,
    overview: {
      totalTvlUsd,
      l2TvlUsd,
      l2SharePct: totalTvlUsd > 0 ? Number(((l2TvlUsd / totalTvlUsd) * 100).toFixed(1)) : 0,
      allChainsTvlUsd: chains.reduce((a, c) => a + Math.max(0, c.tvlUsd), 0),
    },
    source: 'defillama',
    fetchedAt,
  };
}

export class EcosystemService {
  private static cache: { report: EcosystemReport; timestamp: number } | null = null;
  private static readonly TTL_MS = 10 * 60 * 1000;

  /** Отчёт из фактического источника; при отказе — исключение (страница показывает «источник недоступен»). */
  public static async fetchReport(adapter: DefiLlamaAdapter = new DefiLlamaAdapter(), now = Date.now()): Promise<EcosystemReport> {
    if (this.cache && now - this.cache.timestamp < this.TTL_MS) return this.cache.report;
    const chains = await adapter.fetchChains();
    const hist = await Promise.allSettled(TRACKED_CHAINS.map((t) => adapter.fetchChainHistory(t.llamaName)));
    const histories: Record<string, Array<{ date: number; tvl: number }>> = {};
    hist.forEach((r, i) => {
      if (r.status === 'fulfilled') histories[TRACKED_CHAINS[i].llamaName] = r.value;
    });
    const report = buildEcosystemReport(chains, histories, now);
    this.cache = { report, timestamp: now };
    return report;
  }

  public static resetCache(): void {
    this.cache = null;
  }
}
