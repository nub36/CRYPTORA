import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';

/**
 * Календарь (v0.8.32): только события с фактическим источником — расписание деривативов Binance Futures:
 *  - ближайшие начисления фандинга по бессрочным контрактам (premiumIndex.nextFundingTime),
 *  - экспирации квартальных контрактов (exchangeInfo.deliveryDate).
 * Прежний статический макро-календарь (FOMC/CPI/NFP/разблокировки с выдуманными прогнозами) удалён: источника нет.
 */
export type CalendarEventKind = 'FUNDING' | 'EXPIRY';

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  /** UTC ms */
  at: number;
  symbols: string[];
  detail: string;
}

export interface CalendarReport {
  source: 'binance';
  fetchedAt: number;
  events: CalendarEvent[];
}

const TRACKED_PERPS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

export function buildCalendarReport(
  input: {
    premium: Array<{ symbol: string; nextFundingTime: number; lastFundingRate: string }>;
    exchangeInfo: { symbols: Array<{ symbol: string; pair: string; contractType: string; deliveryDate: number; status: string }> };
  },
  fetchedAt: number,
): CalendarReport {
  const events: CalendarEvent[] = [];

  // Фандинг: группируем отслеживаемые перпы по моменту начисления.
  const byTime = new Map<number, Array<{ symbol: string; rate: number }>>();
  for (const p of input.premium) {
    if (!TRACKED_PERPS.includes(p.symbol) || p.nextFundingTime <= fetchedAt) continue;
    const arr = byTime.get(p.nextFundingTime) ?? [];
    arr.push({ symbol: p.symbol, rate: Number(p.lastFundingRate) });
    byTime.set(p.nextFundingTime, arr);
  }
  for (const [t, arr] of byTime) {
    arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    events.push({
      id: `funding-${t}`,
      kind: 'FUNDING',
      title: 'Начисление фандинга (бессрочные контракты)',
      at: t,
      symbols: arr.map((a) => a.symbol),
      detail: arr.map((a) => `${a.symbol.replace('USDT', '')} ${(a.rate * 100).toFixed(4)}%`).join(' · ') + ' — текущая ставка источника',
    });
  }

  // Экспирации квартальных контрактов (только торгуемые, будущие).
  const byDelivery = new Map<number, string[]>();
  for (const s of input.exchangeInfo.symbols) {
    if (s.contractType === 'PERPETUAL' || s.status !== 'TRADING' || s.deliveryDate <= fetchedAt) continue;
    // Binance помечает перпы deliveryDate далеко в будущем (год 2100); отсекаем > 2 лет.
    if (s.deliveryDate - fetchedAt > 2 * 365 * 86_400_000) continue;
    const arr = byDelivery.get(s.deliveryDate) ?? [];
    arr.push(s.symbol);
    byDelivery.set(s.deliveryDate, arr);
  }
  for (const [t, syms] of byDelivery) {
    syms.sort();
    events.push({
      id: `expiry-${t}`,
      kind: 'EXPIRY',
      title: 'Экспирация срочных контрактов',
      at: t,
      symbols: syms,
      detail: `${syms.length} контракт(ов) с поставкой по данным exchangeInfo`,
    });
  }

  events.sort((a, b) => a.at - b.at);
  return { source: 'binance', fetchedAt, events };
}

export class CalendarService {
  private static cache: { report: CalendarReport; timestamp: number } | null = null;
  private static readonly TTL_MS = 5 * 60 * 1000;

  public static async fetchReport(adapter: BinanceFuturesAdapter = new BinanceFuturesAdapter(), now = Date.now()): Promise<CalendarReport> {
    if (this.cache && now - this.cache.timestamp < this.TTL_MS) return this.cache.report;
    const [premium, exchangeInfo] = await Promise.all([adapter.fetchPremiumIndexes(), adapter.fetchExchangeInfo()]);
    const report = buildCalendarReport({ premium, exchangeInfo }, now);
    this.cache = { report, timestamp: now };
    return report;
  }

  public static resetCache(): void {
    this.cache = null;
  }
}
