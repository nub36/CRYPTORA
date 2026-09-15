import { AssetCategory } from '@/types/market';

export interface CanonicalAsset {
  readonly symbol: string;
  readonly name: string;
  readonly category: Exclude<AssetCategory, 'all'>;
  readonly rank: number;
  readonly binanceSymbol: string | null;
  readonly kucoinSymbol: string | null;
  readonly description: string;
  readonly circulatingSupply: number;
}

export const CANONICAL_ASSETS: readonly CanonicalAsset[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'l1',
    rank: 1,
    binanceSymbol: 'BTCUSDT',
    kucoinSymbol: 'BTC-USDT',
    description: 'Первая децентрализованная пиринговая криптовалюта и ключевой бенчмарк крипторынка.',
    circulatingSupply: 19780000,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    category: 'l1',
    rank: 2,
    binanceSymbol: 'ETHUSDT',
    kucoinSymbol: 'ETH-USDT',
    description: 'Ведущая платформа смарт-контрактов для децентрализованных приложений и институционального DeFi.',
    circulatingSupply: 120400000,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    category: 'l1',
    rank: 3,
    binanceSymbol: 'SOLUSDT',
    kucoinSymbol: 'SOL-USDT',
    description: 'Высокопроизводительный монолитный L1 блокчейн с механизмом консенсуса Proof-of-History.',
    circulatingSupply: 468000000,
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    category: 'l1',
    rank: 4,
    binanceSymbol: 'BNBUSDT',
    kucoinSymbol: 'BNB-USDT',
    description: 'Нативный токен экосистемы BNB Chain с регулярным ончейн-сжиганием и высокой пропускной способностью.',
    circulatingSupply: 145900000,
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    category: 'l1',
    rank: 5,
    binanceSymbol: 'XRPUSDT',
    kucoinSymbol: 'XRP-USDT',
    description: 'Цифровой расчетный актив для трансграничных межбанковских платежей в реестре XRP Ledger.',
    circulatingSupply: 56300000000,
  },
  {
    symbol: 'ADA',
    name: 'Cardano',
    category: 'l1',
    rank: 6,
    binanceSymbol: 'ADAUSDT',
    kucoinSymbol: 'ADA-USDT',
    description: 'Научно-верифицируемый блокчейн третьего поколения на базе протокола Ouroboros PoS.',
    circulatingSupply: 35600000000,
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    category: 'meme',
    rank: 7,
    binanceSymbol: 'DOGEUSDT',
    kucoinSymbol: 'DOGE-USDT',
    description: 'Крупнейший по ликвидности мемкоин на базе алгоритма Scrypt с широким розничным признанием.',
    circulatingSupply: 146000000000,
  },
  {
    symbol: 'AVAX',
    name: 'Avalanche',
    category: 'l1',
    rank: 8,
    binanceSymbol: 'AVAXUSDT',
    kucoinSymbol: 'AVAX-USDT',
    description: 'Многоцепочечная смарт-контрактная платформа с мгновенной финализацией на базе подсетей (Subnets).',
    circulatingSupply: 395000000,
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    category: 'defi',
    rank: 9,
    binanceSymbol: 'LINKUSDT',
    kucoinSymbol: 'LINK-USDT',
    description: 'Стандарт индустрии децентрализованных оракулов данных и протокол межсетевого взаимодействия CCIP.',
    circulatingSupply: 608000000,
  },
  {
    symbol: 'DOT',
    name: 'Polkadot',
    category: 'l1',
    rank: 10,
    binanceSymbol: 'DOTUSDT',
    kucoinSymbol: 'DOT-USDT',
    description: 'Гетерогенная мультичейн-архитектура с разделяемой безопасностью Relay Chain и парачейнами.',
    circulatingSupply: 1430000000,
  },
  {
    symbol: 'SUI',
    name: 'Sui',
    category: 'l1',
    rank: 11,
    binanceSymbol: 'SUIUSDT',
    kucoinSymbol: 'SUI-USDT',
    description: 'L1 блокчейн на языке Move с объектно-ориентированной моделью данных и параллельным исполнением.',
    circulatingSupply: 2850000000,
  },
  {
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    category: 'l1',
    rank: 12,
    binanceSymbol: 'NEARUSDT',
    kucoinSymbol: 'NEAR-USDT',
    description: 'Шардированный L1 блокчейн с технологией Nightshade и инфраструктурой Chain Abstraction.',
    circulatingSupply: 1210000000,
  },
  {
    symbol: 'APT',
    name: 'Aptos',
    category: 'l1',
    rank: 13,
    binanceSymbol: 'APTUSDT',
    kucoinSymbol: 'APT-USDT',
    description: 'Высокопроизводительный L1 блокчейн на языке Move с конвейерным параллельным движком Block-STM.',
    circulatingSupply: 512000000,
  },
  {
    symbol: 'RENDER',
    name: 'Render',
    category: 'ai',
    rank: 14,
    binanceSymbol: 'RENDERUSDT',
    kucoinSymbol: 'RENDER-USDT',
    description: 'Децентрализованная сеть распределенных вычислений GPU для 3D-рендеринга и обучения нейросетей.',
    circulatingSupply: 518000000,
  },
  {
    symbol: 'TAO',
    name: 'Bittensor',
    category: 'ai',
    rank: 15,
    binanceSymbol: 'TAOUSDT',
    kucoinSymbol: 'TAO-USDT',
    description: 'Децентрализованная сеть машинного интеллекта и рынок обмена знаниями моделей подсетей.',
    circulatingSupply: 7380000,
  },
  {
    symbol: 'INJ',
    name: 'Injective',
    category: 'defi',
    rank: 16,
    binanceSymbol: 'INJUSDT',
    kucoinSymbol: 'INJ-USDT',
    description: 'Специализированный блокчейн для ончейн-деривативов и стаканов заявок институционального уровня.',
    circulatingSupply: 98000000,
  },
  {
    symbol: 'UNI',
    name: 'Uniswap',
    category: 'defi',
    rank: 17,
    binanceSymbol: 'UNIUSDT',
    kucoinSymbol: 'UNI-USDT',
    description: 'Эталонный автоматизированный маркет-мейкер (AMM) с концентрированной ликвидностью v3 и хуками v4.',
    circulatingSupply: 600000000,
  },
  {
    symbol: 'AAVE',
    name: 'Aave',
    category: 'defi',
    rank: 18,
    binanceSymbol: 'AAVEUSDT',
    kucoinSymbol: 'AAVE-USDT',
    description: 'Крупнейший мультичейн денежный рынок и протокол децентрализованного кредитования.',
    circulatingSupply: 14900000,
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    category: 'l2',
    rank: 19,
    binanceSymbol: 'OPUSDT',
    kucoinSymbol: 'OP-USDT',
    description: 'Optimistic Rollup для масштабирования Ethereum и основа экосистемы Superchain.',
    circulatingSupply: 1250000000,
  },
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    category: 'l2',
    rank: 20,
    binanceSymbol: 'ARBUSDT',
    kucoinSymbol: 'ARB-USDT',
    description: 'L2 Optimistic Rollup с наибольшим объемом TVL и развитой экосистемой деривативов на базе Nitro.',
    circulatingSupply: 3600000000,
  },
  {
    symbol: 'TIA',
    name: 'Celestia',
    category: 'l1',
    rank: 21,
    binanceSymbol: 'TIAUSDT',
    kucoinSymbol: 'TIA-USDT',
    description: 'Модульный блокчейн доступности данных (Data Availability, DA) с технологией выборки DAS.',
    circulatingSupply: 220000000,
  },
  {
    symbol: 'FET',
    name: 'Artificial Superintelligence',
    category: 'ai',
    rank: 22,
    binanceSymbol: 'FETUSDT',
    kucoinSymbol: 'FET-USDT',
    description: 'Альянс децентрализованного искусственного интеллекта (Fetch.ai, SingularityNET, Ocean Protocol).',
    circulatingSupply: 2600000000,
  },
  {
    symbol: 'KAS',
    name: 'Kaspa',
    category: 'l1',
    rank: 23,
    binanceSymbol: 'KASUSDT',
    kucoinSymbol: 'KAS-USDT',
    description: 'Быстрый PoW протокол на базе BlockDAG (GHOSTDAG) с высокой частотой формирования блоков.',
    circulatingSupply: 24900000000,
  },
  {
    symbol: 'RUNE',
    name: 'THORChain',
    category: 'defi',
    rank: 24,
    binanceSymbol: 'RUNEUSDT',
    kucoinSymbol: 'RUNE-USDT',
    description: 'Кросс-чейн протокол децентрализованного обмена нативных криптоактивов без обертывания (no wrapping).',
    circulatingSupply: 335000000,
  },
  {
    symbol: 'SEI',
    name: 'Sei',
    category: 'l1',
    rank: 25,
    binanceSymbol: 'SEIUSDT',
    kucoinSymbol: 'SEI-USDT',
    description: 'Специализированный параллельный EVM L1 блокчейн для скоростной торговли и биржевой ликвидности.',
    circulatingSupply: 3100000000,
  },
];

export function getCanonicalAssets(): readonly CanonicalAsset[] {
  return CANONICAL_ASSETS;
}

export function getAssetBySymbol(symbol: string): CanonicalAsset | undefined {
  const norm = symbol.toUpperCase().trim();
  return CANONICAL_ASSETS.find((a) => a.symbol === norm);
}

export function getBinanceSymbol(canonicalSymbol: string): string | null {
  const asset = getAssetBySymbol(canonicalSymbol);
  return asset?.binanceSymbol ?? null;
}

export function getKuCoinSymbol(canonicalSymbol: string): string | null {
  const asset = getAssetBySymbol(canonicalSymbol);
  return asset?.kucoinSymbol ?? null;
}

export function getCanonicalByBinanceSymbol(binanceSymbol: string): CanonicalAsset | undefined {
  const norm = binanceSymbol.toUpperCase().trim();
  return CANONICAL_ASSETS.find((a) => a.binanceSymbol === norm);
}

export function getCanonicalByKuCoinSymbol(kucoinSymbol: string): CanonicalAsset | undefined {
  const norm = kucoinSymbol.toUpperCase().trim();
  return CANONICAL_ASSETS.find((a) => a.kucoinSymbol === norm);
}

export const getAssetByBinanceSymbol = getCanonicalByBinanceSymbol;
export const getAssetByKuCoinSymbol = getCanonicalByKuCoinSymbol;
