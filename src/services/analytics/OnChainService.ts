export interface OnChainMacroMetric {
  id: string;
  name: string;
  symbol: 'BTC' | 'ETH';
  value: string;
  numericValue: number;
  change24h: number;
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'EXTREME_GREED' | 'EXTREME_FEAR';
  interpretation: string;
}

export interface ExchangeFlowItem {
  exchange: string;
  inflowBtc: number;
  outflowBtc: number;
  netflowBtc: number;
  netflowUsd: number;
}

export class OnChainService {
  public static getMacroMetrics(): OnChainMacroMetric[] {
    return [
      {
        id: 'btc-mvrv',
        name: 'MVRV Z-Score',
        symbol: 'BTC',
        value: '2.14σ',
        numericValue: 2.14,
        change24h: 0.05,
        signal: 'NEUTRAL',
        interpretation: 'Оценка отношения рыночной капитализации к реализованной. Исторические вершины > 6.0σ, зоны накопления < 0.1σ.',
      },
      {
        id: 'btc-nupl',
        name: 'Net Unrealized Profit/Loss (NUPL)',
        symbol: 'BTC',
        value: '0.48',
        numericValue: 0.48,
        change24h: 0.02,
        signal: 'BULLISH',
        interpretation: 'Фаза «Оптимизм / Вера». Подавляющая часть монет в сети находится в нереализованной прибыли.',
      },
      {
        id: 'btc-hashrate',
        name: 'Хешрейт сети (Hashrate)',
        symbol: 'BTC',
        value: '674 EH/s',
        numericValue: 674,
        change24h: 1.4,
        signal: 'BULLISH',
        interpretation: 'Исторический максимум вычислительной мощности и безопасности блокчейна Bitcoin.',
      },
      {
        id: 'btc-active-addrs',
        name: 'Активные адреса (24h)',
        symbol: 'BTC',
        value: '842,500',
        numericValue: 842500,
        change24h: 3.8,
        signal: 'NEUTRAL',
        interpretation: 'Стабильная суточная транзакционная активность пользователей в базовом слое.',
      },
      {
        id: 'eth-staking-ratio',
        name: 'Доля застейканного ETH',
        symbol: 'ETH',
        value: '28.6%',
        numericValue: 28.6,
        change24h: 0.1,
        signal: 'BULLISH',
        interpretation: 'Более 34.3M ETH заблокировано валидаторами Proof-of-Stake, снижая ликвидное предложение на биржах.',
      },
      {
        id: 'eth-gas-median',
        name: 'Медианный Gas Fee',
        symbol: 'ETH',
        value: '8.4 Gwei',
        numericValue: 8.4,
        change24h: -15.2,
        signal: 'NEUTRAL',
        interpretation: 'Низкие комиссии в основной сети за счет миграции розничной активности в Layer-2 роллапы.',
      },
    ];
  }

  public static getExchangeFlows(): ExchangeFlowItem[] {
    return [
      {
        exchange: 'Binance',
        inflowBtc: 4210,
        outflowBtc: 6180,
        netflowBtc: -1970,
        netflowUsd: -127065000,
      },
      {
        exchange: 'Coinbase Pro',
        inflowBtc: 1840,
        outflowBtc: 3420,
        netflowBtc: -1580,
        netflowUsd: -101910000,
      },
      {
        exchange: 'Bitfinex',
        inflowBtc: 820,
        outflowBtc: 690,
        netflowBtc: 130,
        netflowUsd: 8385000,
      },
      {
        exchange: 'OKX',
        inflowBtc: 1450,
        outflowBtc: 2110,
        netflowBtc: -660,
        netflowUsd: -42570000,
      },
    ];
  }
}
