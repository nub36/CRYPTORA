import {
  AssetSummary,
  AssetDetail,
  AssetCategory,
  OHLCV,
  Timeframe,
  FuturesAsset,
  LiquidationData,
  RadarEvent,
  MarketOverviewData,
  ScreenerFilters,
} from '@/types/market';
import { MarketDataProvider } from './MarketDataProvider';

// Deterministic mock datasets
const DEMO_TIMESTAMP = '2026-09-15T12:00:00Z';

export const DEMO_ASSETS: AssetSummary[] = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'l1',
    rank: 1,
    price: 64850.25,
    change1h: 0.42,
    change24h: 3.18,
    change7d: 8.45,
    volume24h: 38450120000,
    marketCap: 1280450000000,
    circulatingSupply: 19750000,
    sparkline: [60100, 60800, 61400, 61200, 62300, 63100, 64200, 64850],
    isDemo: true,
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    category: 'l1',
    rank: 2,
    price: 3450.6,
    change1h: -0.15,
    change24h: 2.45,
    change7d: 5.8,
    volume24h: 18230500000,
    marketCap: 414800000000,
    circulatingSupply: 120200000,
    sparkline: [3280, 3310, 3350, 3320, 3390, 3410, 3430, 3450],
    isDemo: true,
  },
  {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    category: 'l1',
    rank: 3,
    price: 154.2,
    change1h: 1.25,
    change24h: 6.84,
    change7d: 14.2,
    volume24h: 5420100000,
    marketCap: 72150000000,
    circulatingSupply: 468000000,
    sparkline: [135, 137, 141, 139, 146, 148, 151, 154.2],
    isDemo: true,
  },
  {
    id: 'binancecoin',
    symbol: 'BNB',
    name: 'BNB',
    category: 'l1',
    rank: 4,
    price: 588.4,
    change1h: 0.12,
    change24h: 1.15,
    change7d: 3.4,
    volume24h: 1120000000,
    marketCap: 85900000000,
    circulatingSupply: 146000000,
    sparkline: [570, 574, 578, 575, 580, 583, 585, 588.4],
    isDemo: true,
  },
  {
    id: 'ripple',
    symbol: 'XRP',
    name: 'XRP',
    category: 'l1',
    rank: 5,
    price: 0.584,
    change1h: -0.32,
    change24h: -1.24,
    change7d: 2.15,
    volume24h: 980500000,
    marketCap: 33120000000,
    circulatingSupply: 56700000000,
    sparkline: [0.57, 0.575, 0.582, 0.591, 0.588, 0.585, 0.582, 0.584],
    isDemo: true,
  },
  {
    id: 'cardano',
    symbol: 'ADA',
    name: 'Cardano',
    category: 'l1',
    rank: 6,
    price: 0.385,
    change1h: 0.22,
    change24h: 1.85,
    change7d: 4.1,
    volume24h: 412000000,
    marketCap: 13800000000,
    circulatingSupply: 35800000000,
    sparkline: [0.368, 0.372, 0.375, 0.373, 0.379, 0.381, 0.383, 0.385],
    isDemo: true,
  },
  {
    id: 'dogecoin',
    symbol: 'DOGE',
    name: 'Dogecoin',
    category: 'meme',
    rank: 7,
    price: 0.118,
    change1h: 1.82,
    change24h: 5.42,
    change7d: 11.2,
    volume24h: 1240000000,
    marketCap: 17200000000,
    circulatingSupply: 146000000000,
    sparkline: [0.106, 0.109, 0.112, 0.111, 0.114, 0.115, 0.116, 0.118],
    isDemo: true,
  },
  {
    id: 'avalanche',
    symbol: 'AVAX',
    name: 'Avalanche',
    category: 'l1',
    rank: 8,
    price: 28.75,
    change1h: 0.65,
    change24h: 4.12,
    change7d: 9.35,
    volume24h: 685000000,
    marketCap: 11400000000,
    circulatingSupply: 396000000,
    sparkline: [26.2, 26.8, 27.4, 27.1, 27.9, 28.2, 28.5, 28.75],
    isDemo: true,
  },
  {
    id: 'chainlink',
    symbol: 'LINK',
    name: 'Chainlink',
    category: 'defi',
    rank: 9,
    price: 12.4,
    change1h: -0.18,
    change24h: 3.25,
    change7d: 7.1,
    volume24h: 345000000,
    marketCap: 7450000000,
    circulatingSupply: 608000000,
    sparkline: [11.5, 11.8, 12.0, 11.9, 12.2, 12.3, 12.35, 12.4],
    isDemo: true,
  },
  {
    id: 'sui',
    symbol: 'SUI',
    name: 'Sui',
    category: 'l1',
    rank: 10,
    price: 1.62,
    change1h: 2.14,
    change24h: 12.45,
    change7d: 28.5,
    volume24h: 890000000,
    marketCap: 4350000000,
    circulatingSupply: 2680000000,
    sparkline: [1.25, 1.32, 1.38, 1.42, 1.49, 1.54, 1.58, 1.62],
    isDemo: true,
  },
  {
    id: 'near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    category: 'ai',
    rank: 11,
    price: 4.85,
    change1h: 0.85,
    change24h: 5.82,
    change7d: 13.4,
    volume24h: 512000000,
    marketCap: 5620000000,
    circulatingSupply: 1160000000,
    sparkline: [4.25, 4.38, 4.52, 4.46, 4.65, 4.72, 4.78, 4.85],
    isDemo: true,
  },
  {
    id: 'polkadot',
    symbol: 'DOT',
    name: 'Polkadot',
    category: 'l1',
    rank: 12,
    price: 4.65,
    change1h: -0.25,
    change24h: 1.12,
    change7d: 2.8,
    volume24h: 185000000,
    marketCap: 6650000000,
    circulatingSupply: 1430000000,
    sparkline: [4.52, 4.55, 4.58, 4.56, 4.61, 4.63, 4.64, 4.65],
    isDemo: true,
  },
  {
    id: 'polygon',
    symbol: 'POL',
    name: 'Polygon',
    category: 'l2',
    rank: 13,
    price: 0.412,
    change1h: 0.18,
    change24h: 2.05,
    change7d: 4.15,
    volume24h: 165000000,
    marketCap: 3890000000,
    circulatingSupply: 9440000000,
    sparkline: [0.395, 0.401, 0.405, 0.402, 0.408, 0.41, 0.411, 0.412],
    isDemo: true,
  },
  {
    id: 'aptos',
    symbol: 'APT',
    name: 'Aptos',
    category: 'l1',
    rank: 14,
    price: 7.42,
    change1h: 1.15,
    change24h: 6.18,
    change7d: 15.2,
    volume24h: 320000000,
    marketCap: 3620000000,
    circulatingSupply: 488000000,
    sparkline: [6.42, 6.65, 6.85, 6.78, 7.05, 7.22, 7.35, 7.42],
    isDemo: true,
  },
  {
    id: 'injective',
    symbol: 'INJ',
    name: 'Injective',
    category: 'defi',
    rank: 15,
    price: 21.8,
    change1h: -0.45,
    change24h: -1.82,
    change7d: 3.45,
    volume24h: 142000000,
    marketCap: 2140000000,
    circulatingSupply: 98000000,
    sparkline: [21.1, 21.5, 22.3, 22.8, 22.4, 22.1, 21.9, 21.8],
    isDemo: true,
  },
  {
    id: 'uniswap',
    symbol: 'UNI',
    name: 'Uniswap',
    category: 'defi',
    rank: 16,
    price: 7.85,
    change1h: 0.32,
    change24h: 2.45,
    change7d: 6.12,
    volume24h: 215000000,
    marketCap: 4710000000,
    circulatingSupply: 600000000,
    sparkline: [7.4, 7.52, 7.65, 7.58, 7.72, 7.78, 7.81, 7.85],
    isDemo: true,
  },
  {
    id: 'aave',
    symbol: 'AAVE',
    name: 'Aave',
    category: 'defi',
    rank: 17,
    price: 156.4,
    change1h: 1.45,
    change24h: 7.25,
    change7d: 18.4,
    volume24h: 298000000,
    marketCap: 2330000000,
    circulatingSupply: 14900000,
    sparkline: [132, 137, 142, 140, 148, 151, 154, 156.4],
    isDemo: true,
  },
  {
    id: 'optimism',
    symbol: 'OP',
    name: 'Optimism',
    category: 'l2',
    rank: 18,
    price: 1.74,
    change1h: -0.12,
    change24h: 3.12,
    change7d: 7.8,
    volume24h: 184000000,
    marketCap: 2180000000,
    circulatingSupply: 1250000000,
    sparkline: [1.61, 1.64, 1.69, 1.67, 1.71, 1.72, 1.73, 1.74],
    isDemo: true,
  },
  {
    id: 'arbitrum',
    symbol: 'ARB',
    name: 'Arbitrum',
    category: 'l2',
    rank: 19,
    price: 0.592,
    change1h: 0.28,
    change24h: 2.85,
    change7d: 5.4,
    volume24h: 224000000,
    marketCap: 2070000000,
    circulatingSupply: 3500000000,
    sparkline: [0.56, 0.568, 0.575, 0.572, 0.582, 0.587, 0.589, 0.592],
    isDemo: true,
  },
  {
    id: 'render',
    symbol: 'RENDER',
    name: 'Render',
    category: 'ai',
    rank: 20,
    price: 6.15,
    change1h: 1.84,
    change24h: 8.42,
    change7d: 21.5,
    volume24h: 310000000,
    marketCap: 3180000000,
    circulatingSupply: 517000000,
    sparkline: [5.05, 5.25, 5.5, 5.42, 5.75, 5.92, 6.05, 6.15],
    isDemo: true,
  },
  {
    id: 'artificial-superintelligence-alliance',
    symbol: 'FET',
    name: 'Artificial Superintelligence',
    category: 'ai',
    rank: 21,
    price: 1.48,
    change1h: 0.92,
    change24h: 6.85,
    change7d: 17.2,
    volume24h: 245000000,
    marketCap: 3720000000,
    circulatingSupply: 2520000000,
    sparkline: [1.26, 1.31, 1.36, 1.34, 1.41, 1.44, 1.46, 1.48],
    isDemo: true,
  },
  {
    id: 'bittensor',
    symbol: 'TAO',
    name: 'Bittensor',
    category: 'ai',
    rank: 22,
    price: 432.5,
    change1h: 2.45,
    change24h: 11.2,
    change7d: 34.8,
    volume24h: 198000000,
    marketCap: 3190000000,
    circulatingSupply: 7380000,
    sparkline: [320, 345, 370, 362, 395, 412, 424, 432.5],
    isDemo: true,
  },
  {
    id: 'celestia',
    symbol: 'TIA',
    name: 'Celestia',
    category: 'l1',
    rank: 23,
    price: 6.25,
    change1h: -0.85,
    change24h: -3.42,
    change7d: -6.8,
    volume24h: 168000000,
    marketCap: 1350000000,
    circulatingSupply: 216000000,
    sparkline: [6.7, 6.65, 6.55, 6.45, 6.38, 6.32, 6.28, 6.25],
    isDemo: true,
  },
  {
    id: 'pepe',
    symbol: 'PEPE',
    name: 'Pepe',
    category: 'meme',
    rank: 24,
    price: 0.00000985,
    change1h: 1.15,
    change24h: 7.84,
    change7d: 19.5,
    volume24h: 780000000,
    marketCap: 4140000000,
    circulatingSupply: 420690000000000,
    sparkline: [0.0000082, 0.0000086, 0.0000091, 0.0000089, 0.0000094, 0.0000096, 0.0000097, 0.00000985],
    isDemo: true,
  },
  {
    id: 'shiba-inu',
    symbol: 'SHIB',
    name: 'Shiba Inu',
    category: 'meme',
    rank: 25,
    price: 0.0000148,
    change1h: 0.35,
    change24h: 3.12,
    change7d: 8.4,
    volume24h: 420000000,
    marketCap: 8720000000,
    circulatingSupply: 589000000000000,
    sparkline: [0.0000136, 0.0000139, 0.0000142, 0.0000141, 0.0000144, 0.0000146, 0.0000147, 0.0000148],
    isDemo: true,
  },
  {
    id: 'dogwifhat',
    symbol: 'WIF',
    name: 'dogwifhat',
    category: 'meme',
    rank: 26,
    price: 1.82,
    change1h: 2.85,
    change24h: 9.64,
    change7d: 26.2,
    volume24h: 450000000,
    marketCap: 1820000000,
    circulatingSupply: 998000000,
    sparkline: [1.44, 1.51, 1.59, 1.56, 1.68, 1.74, 1.79, 1.82],
    isDemo: true,
  },
  {
    id: 'bonk',
    symbol: 'BONK',
    name: 'Bonk',
    category: 'meme',
    rank: 27,
    price: 0.0000192,
    change1h: 0.84,
    change24h: 4.82,
    change7d: 12.8,
    volume24h: 195000000,
    marketCap: 1380000000,
    circulatingSupply: 71800000000000,
    sparkline: [0.000017, 0.0000175, 0.0000181, 0.0000179, 0.0000186, 0.0000189, 0.0000191, 0.0000192],
    isDemo: true,
  },
  {
    id: 'kaspa',
    symbol: 'KAS',
    name: 'Kaspa',
    category: 'l1',
    rank: 28,
    price: 0.168,
    change1h: -0.15,
    change24h: 0.95,
    change7d: 3.8,
    volume24h: 75000000,
    marketCap: 4150000000,
    circulatingSupply: 24700000000,
    sparkline: [0.162, 0.164, 0.166, 0.165, 0.167, 0.167, 0.168, 0.168],
    isDemo: true,
  },
  {
    id: 'sei-network',
    symbol: 'SEI',
    name: 'Sei',
    category: 'l1',
    rank: 29,
    price: 0.345,
    change1h: 1.12,
    change24h: 5.14,
    change7d: 14.2,
    volume24h: 165000000,
    marketCap: 1240000000,
    circulatingSupply: 3600000000,
    sparkline: [0.302, 0.312, 0.324, 0.32, 0.334, 0.339, 0.342, 0.345],
    isDemo: true,
  },
  {
    id: 'floki',
    symbol: 'FLOKI',
    name: 'Floki',
    category: 'meme',
    rank: 30,
    price: 0.000142,
    change1h: 0.45,
    change24h: 3.85,
    change7d: 9.4,
    volume24h: 185000000,
    marketCap: 1380000000,
    circulatingSupply: 9680000000000,
    sparkline: [0.00013, 0.000133, 0.000137, 0.000135, 0.000139, 0.00014, 0.000141, 0.000142],
    isDemo: true,
  },
];

export const DEMO_OVERVIEW: MarketOverviewData = {
  totalMarketCap: 2380450000000,
  marketCapChange24h: 2.85,
  totalVolume24h: 84620000000,
  volumeChange24h: 14.3,
  btcDominance: 53.8,
  ethDominance: 17.4,
  fearAndGreed: {
    value: 64,
    sentiment: 'Greed',
  },
  marketBreadth: {
    advancing: 24,
    declining: 6,
    unchanged: 0,
  },
  isDemo: true,
  timestamp: DEMO_TIMESTAMP,
};

export const DEMO_FUTURES: FuturesAsset[] = [
  {
    symbol: 'BTC/USDT',
    markPrice: 64855.1,
    indexPrice: 64850.25,
    fundingRate: 0.0125,
    predictedFundingRate: 0.0118,
    annualizedFundingRate: 13.68,
    openInterest: 18450000000,
    openInterestChange1h: 1.45,
    openInterestChange24h: 7.24,
    futuresVolume24h: 46200000000,
    longLiquidations24h: 14850000,
    shortLiquidations24h: 48920000,
    basisPct: 0.048,
    isDemo: true,
  },
  {
    symbol: 'ETH/USDT',
    markPrice: 3451.2,
    indexPrice: 3450.6,
    fundingRate: 0.0084,
    predictedFundingRate: 0.0091,
    annualizedFundingRate: 9.19,
    openInterest: 8940000000,
    openInterestChange1h: 0.62,
    openInterestChange24h: 4.15,
    futuresVolume24h: 22150000000,
    longLiquidations24h: 8450000,
    shortLiquidations24h: 19800000,
    basisPct: 0.035,
    isDemo: true,
  },
  {
    symbol: 'SOL/USDT',
    markPrice: 154.35,
    indexPrice: 154.2,
    fundingRate: 0.0215,
    predictedFundingRate: 0.0245,
    annualizedFundingRate: 23.54,
    openInterest: 2680000000,
    openInterestChange1h: 3.12,
    openInterestChange24h: 12.8,
    futuresVolume24h: 7450000000,
    longLiquidations24h: 2950000,
    shortLiquidations24h: 14600000,
    basisPct: 0.097,
    isDemo: true,
  },
  {
    symbol: 'SUI/USDT',
    markPrice: 1.623,
    indexPrice: 1.62,
    fundingRate: -0.0185,
    predictedFundingRate: -0.012,
    annualizedFundingRate: -20.25,
    openInterest: 540000000,
    openInterestChange1h: 4.85,
    openInterestChange24h: 24.5,
    futuresVolume24h: 1450000000,
    longLiquidations24h: 420000,
    shortLiquidations24h: 6850000,
    basisPct: 0.185,
    isDemo: true,
  },
  {
    symbol: 'TAO/USDT',
    markPrice: 433.1,
    indexPrice: 432.5,
    fundingRate: -0.024,
    predictedFundingRate: -0.019,
    annualizedFundingRate: -26.28,
    openInterest: 320000000,
    openInterestChange1h: 2.15,
    openInterestChange24h: 18.2,
    futuresVolume24h: 840000000,
    longLiquidations24h: 180000,
    shortLiquidations24h: 4120000,
    basisPct: 0.138,
    isDemo: true,
  },
  {
    symbol: 'DOGE/USDT',
    markPrice: 0.1182,
    indexPrice: 0.118,
    fundingRate: 0.0105,
    predictedFundingRate: 0.011,
    annualizedFundingRate: 11.49,
    openInterest: 940000000,
    openInterestChange1h: 1.15,
    openInterestChange24h: 6.8,
    futuresVolume24h: 1850000000,
    longLiquidations24h: 1250000,
    shortLiquidations24h: 3450000,
    basisPct: 0.052,
    isDemo: true,
  },
  {
    symbol: 'AVAX/USDT',
    markPrice: 28.78,
    indexPrice: 28.75,
    fundingRate: 0.0075,
    predictedFundingRate: 0.008,
    annualizedFundingRate: 8.21,
    openInterest: 480000000,
    openInterestChange1h: 0.45,
    openInterestChange24h: 3.9,
    futuresVolume24h: 920000000,
    longLiquidations24h: 680000,
    shortLiquidations24h: 1420000,
    basisPct: 0.041,
    isDemo: true,
  },
  {
    symbol: 'PEPE/USDT',
    markPrice: 0.00000987,
    indexPrice: 0.00000985,
    fundingRate: 0.0165,
    predictedFundingRate: 0.018,
    annualizedFundingRate: 18.06,
    openInterest: 620000000,
    openInterestChange1h: 2.4,
    openInterestChange24h: 11.4,
    futuresVolume24h: 1280000000,
    longLiquidations24h: 890000,
    shortLiquidations24h: 4200000,
    basisPct: 0.082,
    isDemo: true,
  },
  {
    symbol: 'NEAR/USDT',
    markPrice: 4.855,
    indexPrice: 4.85,
    fundingRate: 0.0112,
    predictedFundingRate: 0.012,
    annualizedFundingRate: 12.26,
    openInterest: 380000000,
    openInterestChange1h: 1.35,
    openInterestChange24h: 8.4,
    futuresVolume24h: 720000000,
    longLiquidations24h: 450000,
    shortLiquidations24h: 1890000,
    basisPct: 0.061,
    isDemo: true,
  },
  {
    symbol: 'WIF/USDT',
    markPrice: 1.824,
    indexPrice: 1.82,
    fundingRate: 0.0195,
    predictedFundingRate: 0.021,
    annualizedFundingRate: 21.35,
    openInterest: 310000000,
    openInterestChange1h: 3.8,
    openInterestChange24h: 14.6,
    futuresVolume24h: 680000000,
    longLiquidations24h: 520000,
    shortLiquidations24h: 2840000,
    basisPct: 0.098,
    isDemo: true,
  },
  {
    symbol: 'TIA/USDT',
    markPrice: 6.242,
    indexPrice: 6.25,
    fundingRate: -0.0315,
    predictedFundingRate: -0.028,
    annualizedFundingRate: -34.49,
    openInterest: 290000000,
    openInterestChange1h: -1.2,
    openInterestChange24h: -4.5,
    futuresVolume24h: 420000000,
    longLiquidations24h: 2450000,
    shortLiquidations24h: 380000,
    basisPct: -0.128,
    isDemo: true,
  },
  {
    symbol: 'XRP/USDT',
    markPrice: 0.5842,
    indexPrice: 0.584,
    fundingRate: 0.0052,
    predictedFundingRate: 0.0055,
    annualizedFundingRate: 5.69,
    openInterest: 780000000,
    openInterestChange1h: -0.4,
    openInterestChange24h: 0.8,
    futuresVolume24h: 1350000000,
    longLiquidations24h: 1120000,
    shortLiquidations24h: 890000,
    basisPct: 0.024,
    isDemo: true,
  },
];

export const DEMO_LIQUIDATIONS: LiquidationData = {
  totalLong24h: 38400000,
  totalShort24h: 112800000,
  total24h: 151200000,
  eventsCount24h: 6,
  lastEventAt: '2026-09-15T11:58:12Z',
  dataStatus: 'DEMO',
  largestEvent: {
    id: 'liq-whale-01',
    timestamp: '2026-09-15T10:42:15Z',
    symbol: 'BTC/USDT',
    side: 'SHORT',
    amountUsd: 4850000,
    price: 64200,
    exchange: 'Binance',
    isDemo: true,
  },
  recentEvents: [
    {
      id: 'liq-001',
      timestamp: '2026-09-15T11:58:12Z',
      symbol: 'SOL/USDT',
      side: 'SHORT',
      amountUsd: 485000,
      price: 153.8,
      exchange: 'Binance',
      isDemo: true,
    },
    {
      id: 'liq-002',
      timestamp: '2026-09-15T11:54:33Z',
      symbol: 'BTC/USDT',
      side: 'SHORT',
      amountUsd: 1250000,
      price: 64780,
      exchange: 'Bybit',
      isDemo: true,
    },
    {
      id: 'liq-003',
      timestamp: '2026-09-15T11:49:05Z',
      symbol: 'ETH/USDT',
      side: 'SHORT',
      amountUsd: 820000,
      price: 3448,
      exchange: 'OKX',
      isDemo: true,
    },
    {
      id: 'liq-004',
      timestamp: '2026-09-15T11:41:22Z',
      symbol: 'SUI/USDT',
      side: 'SHORT',
      amountUsd: 310000,
      price: 1.61,
      exchange: 'Binance',
      isDemo: true,
    },
    {
      id: 'liq-005',
      timestamp: '2026-09-15T11:32:18Z',
      symbol: 'TIA/USDT',
      side: 'LONG',
      amountUsd: 640000,
      price: 6.27,
      exchange: 'Bybit',
      isDemo: true,
    },
    {
      id: 'liq-006',
      timestamp: '2026-09-15T11:21:40Z',
      symbol: 'TAO/USDT',
      side: 'SHORT',
      amountUsd: 590000,
      price: 430.2,
      exchange: 'Binance',
      isDemo: true,
    },
    {
      id: 'liq-007',
      timestamp: '2026-09-15T11:10:11Z',
      symbol: 'WIF/USDT',
      side: 'SHORT',
      amountUsd: 280000,
      price: 1.81,
      exchange: 'OKX',
      isDemo: true,
    },
    {
      id: 'liq-008',
      timestamp: '2026-09-15T10:55:04Z',
      symbol: 'BTC/USDT',
      side: 'SHORT',
      amountUsd: 2400000,
      price: 64520,
      exchange: 'Binance',
      isDemo: true,
    },
  ],
  assetBreakdown: [
    { symbol: 'BTC', totalUsd: 63770000, longUsd: 14850000, shortUsd: 48920000 },
    { symbol: 'ETH', totalUsd: 28250000, longUsd: 8450000, shortUsd: 19800000 },
    { symbol: 'SOL', totalUsd: 17550000, longUsd: 2950000, shortUsd: 14600000 },
    { symbol: 'SUI', totalUsd: 7270000, longUsd: 420000, shortUsd: 6850000 },
    { symbol: 'PEPE', totalUsd: 5090000, longUsd: 890000, shortUsd: 4200000 },
    { symbol: 'TAO', totalUsd: 4300000, longUsd: 180000, shortUsd: 4120000 },
    { symbol: 'DOGE', totalUsd: 4700000, longUsd: 1250000, shortUsd: 3450000 },
    { symbol: 'TIA', totalUsd: 2830000, longUsd: 2450000, shortUsd: 380000 },
  ],
  exchangeBreakdown: [
    { exchange: 'Binance', totalUsd: 81650000, percentage: 54.0 },
    { exchange: 'Bybit', totalUsd: 45360000, percentage: 30.0 },
    { exchange: 'OKX', totalUsd: 24190000, percentage: 16.0 },
  ],
  timeline: [
    { timestamp: '00:00', longUsd: 1200000, shortUsd: 3100000 },
    { timestamp: '03:00', longUsd: 2400000, shortUsd: 4800000 },
    { timestamp: '06:00', longUsd: 3800000, shortUsd: 7900000 },
    { timestamp: '09:00', longUsd: 9100000, shortUsd: 32400000 },
    { timestamp: '12:00', longUsd: 6500000, shortUsd: 21800000 },
    { timestamp: '15:00', longUsd: 4900000, shortUsd: 18200000 },
    { timestamp: '18:00', longUsd: 5800000, shortUsd: 14600000 },
    { timestamp: '21:00', longUsd: 4700000, shortUsd: 10000000 },
  ],
  isDemo: true,
};

export const DEMO_RADAR_EVENTS: RadarEvent[] = [
  {
    id: 'radar-01',
    timestamp: '2026-09-15T11:48:00Z',
    symbol: 'SOL',
    type: 'VOLUME_SPIKE',
    severity: 'HIGH',
    metricValue: '3.8x 15m Avg Vol',
    observation: 'Аномальный всплеск спотового и фьючерсного объема с пробитием локального сопротивления $152.0. Дельта покупателей +$42M.',
    isDemo: true,
  },
  {
    id: 'radar-02',
    timestamp: '2026-09-15T11:35:00Z',
    symbol: 'BTC',
    type: 'OI_SPIKE',
    severity: 'HIGH',
    metricValue: '+7.2% OI / 1h',
    observation: 'Агрессивный приток открытого интереса на сумму +$1.25B за 60 минут при росте цены выше $64,500. Признак инициативы крупного покупателя.',
    isDemo: true,
  },
  {
    id: 'radar-03',
    timestamp: '2026-09-15T11:12:00Z',
    symbol: 'SUI',
    type: 'FUNDING_EXTREME',
    severity: 'MEDIUM',
    metricValue: '-0.0185% Funding',
    observation: 'Ставка финансирования опустилась в отрицательную зону при непрерывном росте цены (+12.4% 24h). Высокая вероятность шорт-сквиза.',
    isDemo: true,
  },
  {
    id: 'radar-04',
    timestamp: '2026-09-15T10:45:00Z',
    symbol: 'BTC',
    type: 'LIQUIDATION_BURST',
    severity: 'HIGH',
    metricValue: '$48.9M Short Liqs',
    observation: 'Каскадная ликвидация коротких позиций в диапазоне $64,000–$64,400. Крупнейшая одиночная ликвидация на $4.85M (Binance).',
    isDemo: true,
  },
  {
    id: 'radar-05',
    timestamp: '2026-09-15T10:15:00Z',
    symbol: 'TAO',
    type: 'PRICE_MOVE',
    severity: 'MEDIUM',
    metricValue: '+11.2% in 2h',
    observation: 'Импульсное ускорение цены сектора AI с отрывом от скользящей средней EMA-50. Индикатор RSI-14 достиг отметки 74.2.',
    isDemo: true,
  },
  {
    id: 'radar-06',
    timestamp: '2026-09-15T09:40:00Z',
    symbol: 'ETH',
    type: 'VOLATILITY_EXPANSION',
    severity: 'INFO',
    metricValue: 'BB Width +45%',
    observation: 'Выход из многодневной консолидации в диапазоне $3,380–$3,420 с расширением границ полос Боллинджера на 4-часовом таймфрейме.',
    isDemo: true,
  },
  {
    id: 'radar-07',
    timestamp: '2026-09-15T09:10:00Z',
    symbol: 'TIA',
    type: 'FUNDING_EXTREME',
    severity: 'MEDIUM',
    metricValue: '-0.0315% Funding',
    observation: 'Глубокий отрицательный фандинг (годовой -34.5%). Доминирование коротких позиций на фоне локального падения.',
    isDemo: true,
  },
  {
    id: 'radar-08',
    timestamp: '2026-09-15T08:25:00Z',
    symbol: 'WIF',
    type: 'VOLUME_SPIKE',
    severity: 'INFO',
    metricValue: '2.4x Volume',
    observation: 'Повышенный интерес в мем-секторе с параллельным ростом открытого интереса на +14.6% за 24 часа.',
    isDemo: true,
  },
];

// Helper to generate deterministic historical candles for any asset and timeframe
function generateDeterministicCandles(basePrice: number, timeframe: Timeframe): OHLCV[] {
  const count = 100;
  let intervalSec = 3600; // 1h default
  if (timeframe === '15m') intervalSec = 900;
  if (timeframe === '4h') intervalSec = 14400;
  if (timeframe === '1D') intervalSec = 86400;
  if (timeframe === '1W') intervalSec = 604800;

  const baseTime = 1789473600 - count * intervalSec; // Fixed anchor timestamp
  const candles: OHLCV[] = [];

  let currentPrice = basePrice * 0.92; // start slightly lower

  for (let i = 0; i < count; i++) {
    const time = baseTime + i * intervalSec;
    // Deterministic sinusoidal wave + upward trend
    const wave1 = Math.sin((i / 8) * Math.PI) * 0.015;
    const wave2 = Math.cos((i / 3) * Math.PI) * 0.008;
    const trend = (i / count) * 0.09;
    const factor = 1 + wave1 + wave2 + trend;

    const open = Number((currentPrice).toFixed(4));
    const close = Number((basePrice * 0.92 * factor).toFixed(4));
    const high = Number((Math.max(open, close) * (1 + 0.006 * Math.sin(i * 1.7))).toFixed(4));
    const low = Number((Math.min(open, close) * (1 - 0.005 * Math.cos(i * 1.3))).toFixed(4));
    const volume = Math.round(15000000 + Math.sin(i * 0.8) * 6000000 + (close > open ? 3000000 : 0));

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  // Ensure last close matches current demo price
  if (candles.length > 0) {
    candles[candles.length - 1].close = basePrice;
  }

  return candles;
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly isDemo = true;

  async getMarketOverview(): Promise<MarketOverviewData> {
    return DEMO_OVERVIEW;
  }

  async getAssets(category?: AssetCategory): Promise<AssetSummary[]> {
    if (!category || category === 'all') {
      return [...DEMO_ASSETS];
    }
    return DEMO_ASSETS.filter((a) => a.category === category);
  }

  async getAssetDetail(symbol: string): Promise<AssetDetail | null> {
    const asset = DEMO_ASSETS.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase() || a.id.toLowerCase() === symbol.toLowerCase()
    );

    if (!asset) return null;

    const high24h = Number((asset.price * 1.042).toFixed(4));
    const low24h = Number((asset.price * 0.968).toFixed(4));

    return {
      ...asset,
      description: `${asset.name} (${asset.symbol}) — один из ключевых активов криптовалютного рынка. Демонстрационная карточка отражает детерминированные параметры спотовой цены, деривативных дельт и технических индикаторов.`,
      ath: Number((asset.price * 1.35).toFixed(2)),
      athDate: '2024-03-14',
      atl: Number((asset.price * 0.12).toFixed(2)),
      atlDate: '2022-11-21',
      high24h,
      low24h,
      indicators: {
        rsi14: asset.change24h > 5 ? 68.4 : asset.change24h < 0 ? 38.2 : 54.6,
        macd: {
          macd: Number((asset.price * 0.008).toFixed(2)),
          signal: Number((asset.price * 0.006).toFixed(2)),
          hist: Number((asset.price * 0.002).toFixed(2)),
        },
        sma20: Number((asset.price * 0.985).toFixed(2)),
        sma50: Number((asset.price * 0.962).toFixed(2)),
        sma200: Number((asset.price * 0.895).toFixed(2)),
        bollinger: {
          upper: Number((asset.price * 1.05).toFixed(2)),
          middle: Number(asset.price.toFixed(2)),
          lower: Number((asset.price * 0.95).toFixed(2)),
        },
      },
      pairs: [
        { exchange: 'Binance', pair: `${asset.symbol}/USDT`, price: asset.price, volume24h: asset.volume24h * 0.45, spreadPct: 0.01 },
        { exchange: 'Bybit', pair: `${asset.symbol}/USDT`, price: Number((asset.price * 1.0002).toFixed(4)), volume24h: asset.volume24h * 0.32, spreadPct: 0.015 },
        { exchange: 'OKX', pair: `${asset.symbol}/USDT`, price: Number((asset.price * 0.9998).toFixed(4)), volume24h: asset.volume24h * 0.18, spreadPct: 0.02 },
      ],
    };
  }

  async getCandles(symbol: string, timeframe: Timeframe): Promise<OHLCV[]> {
    const asset = DEMO_ASSETS.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase() || a.id.toLowerCase() === symbol.toLowerCase()
    );
    const basePrice = asset ? asset.price : 64850.25;
    return generateDeterministicCandles(basePrice, timeframe);
  }

  async getFuturesList(): Promise<FuturesAsset[]> {
    return [...DEMO_FUTURES];
  }

  async getLiquidations(): Promise<LiquidationData> {
    return DEMO_LIQUIDATIONS;
  }

  async getRadarEvents(symbol?: string): Promise<RadarEvent[]> {
    if (!symbol) return [...DEMO_RADAR_EVENTS];
    return DEMO_RADAR_EVENTS.filter((e) => e.symbol.toUpperCase() === symbol.toUpperCase());
  }

  async getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]> {
    return DEMO_ASSETS.filter((asset) => {
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const matches = asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q);
        if (!matches) return false;
      }

      if (filters.category && filters.category !== 'all' && asset.category !== filters.category) {
        return false;
      }

      if (filters.minPriceChange24h !== undefined && asset.change24h < filters.minPriceChange24h) {
        return false;
      }

      if (filters.maxPriceChange24h !== undefined && asset.change24h > filters.maxPriceChange24h) {
        return false;
      }

      if (filters.minVolume24h !== undefined && asset.volume24h < filters.minVolume24h) {
        return false;
      }

      if (filters.minMarketCap !== undefined && asset.marketCap < filters.minMarketCap) {
        return false;
      }

      // Funding filter check using DEMO_FUTURES mapping
      if (filters.fundingFilter && filters.fundingFilter !== 'all') {
        const futures = DEMO_FUTURES.find((f) => f.symbol.startsWith(asset.symbol));
        if (futures) {
          if (filters.fundingFilter === 'positive' && futures.fundingRate <= 0) return false;
          if (filters.fundingFilter === 'negative' && futures.fundingRate >= 0) return false;
        }
      }

      return true;
    });
  }
}
