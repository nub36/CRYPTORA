export interface NetworkEcosystem {
  id: string;
  name: string;
  chainSymbol: string;
  layer: 'L1' | 'L2';
  tvlUsd: number;
  tvlChange7d: number;
  dailyFeesUsd: number;
  tps: number;
  activeAddresses24h: number;
  stablecoinSupplyUsd: number;
}

export interface EcosystemOverview {
  totalTvlUsd: number;
  totalDailyFeesUsd: number;
  l2TvlUsd: number;
  l2SharePct: number;
}

export class EcosystemService {
  private static networks: NetworkEcosystem[] = [
    {
      id: 'ethereum',
      name: 'Ethereum',
      chainSymbol: 'ETH',
      layer: 'L1',
      tvlUsd: 58400000000,
      tvlChange7d: 3.2,
      dailyFeesUsd: 3850000,
      tps: 14.8,
      activeAddresses24h: 420000,
      stablecoinSupplyUsd: 82500000000,
    },
    {
      id: 'solana',
      name: 'Solana',
      chainSymbol: 'SOL',
      layer: 'L1',
      tvlUsd: 5920000000,
      tvlChange7d: 8.4,
      dailyFeesUsd: 1940000,
      tps: 1850.0,
      activeAddresses24h: 1250000,
      stablecoinSupplyUsd: 3850000000,
    },
    {
      id: 'arbitrum',
      name: 'Arbitrum One',
      chainSymbol: 'ARB',
      layer: 'L2',
      tvlUsd: 3450000000,
      tvlChange7d: 4.1,
      dailyFeesUsd: 280000,
      tps: 28.4,
      activeAddresses24h: 310000,
      stablecoinSupplyUsd: 4400000000,
    },
    {
      id: 'base',
      name: 'Base',
      chainSymbol: 'ETH',
      layer: 'L2',
      tvlUsd: 1980000000,
      tvlChange7d: 12.8,
      dailyFeesUsd: 210000,
      tps: 38.6,
      activeAddresses24h: 480000,
      stablecoinSupplyUsd: 3100000000,
    },
    {
      id: 'optimism',
      name: 'OP Mainnet',
      chainSymbol: 'OP',
      layer: 'L2',
      tvlUsd: 1240000000,
      tvlChange7d: 1.8,
      dailyFeesUsd: 95000,
      tps: 11.2,
      activeAddresses24h: 140000,
      stablecoinSupplyUsd: 1150000000,
    },
    {
      id: 'polygon',
      name: 'Polygon PoS',
      chainSymbol: 'POL',
      layer: 'L1',
      tvlUsd: 1120000000,
      tvlChange7d: -1.2,
      dailyFeesUsd: 65000,
      tps: 34.0,
      activeAddresses24h: 360000,
      stablecoinSupplyUsd: 1420000000,
    },
    {
      id: 'avalanche',
      name: 'Avalanche C-Chain',
      chainSymbol: 'AVAX',
      layer: 'L1',
      tvlUsd: 1050000000,
      tvlChange7d: 2.1,
      dailyFeesUsd: 82000,
      tps: 12.4,
      activeAddresses24h: 95000,
      stablecoinSupplyUsd: 1680000000,
    },
  ];

  public static getNetworks(): NetworkEcosystem[] {
    return [...this.networks];
  }

  public static getOverview(): EcosystemOverview {
    const totalTvlUsd = this.networks.reduce((acc, n) => acc + n.tvlUsd, 0);
    const totalDailyFeesUsd = this.networks.reduce((acc, n) => acc + n.dailyFeesUsd, 0);
    const l2TvlUsd = this.networks
      .filter((n) => n.layer === 'L2')
      .reduce((acc, n) => acc + n.tvlUsd, 0);
    const l2SharePct = totalTvlUsd > 0 ? Number(((l2TvlUsd / totalTvlUsd) * 100).toFixed(1)) : 0;

    return {
      totalTvlUsd,
      totalDailyFeesUsd,
      l2TvlUsd,
      l2SharePct,
    };
  }
}
