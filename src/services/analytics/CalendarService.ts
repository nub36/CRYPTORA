export type EventImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventCategory = 'MACRO_ECONOMICS' | 'CRYPTO_CATALYST' | 'TOKEN_UNLOCK' | 'CENTRAL_BANK';

export interface CalendarEvent {
  id: string;
  title: string;
  category: EventCategory;
  date: string; // ISO date string
  impact: EventImpact;
  forecast?: string;
  previous?: string;
  description: string;
  affectedAssets: string[];
}

export class CalendarService {
  private static events: CalendarEvent[] = [
    {
      id: 'cal-fomc-1',
      title: 'Решение ФРС США по процентной ставке (FOMC)',
      category: 'CENTRAL_BANK',
      date: '2026-09-17T18:00:00Z',
      impact: 'HIGH',
      forecast: '5.25%',
      previous: '5.50%',
      description: 'Ключевое заседание Федерального комитета по открытым рынкам. Ожидается первое снижение учетной ставки на 25 б.п., что окажет сильное влияние на долларовую ликвидность.',
      affectedAssets: ['BTC', 'ETH', 'SOL'],
    },
    {
      id: 'cal-cpi-2',
      title: 'Индекс потребительских цен в США (CPI Inflation MoM/YoY)',
      category: 'MACRO_ECONOMICS',
      date: '2026-09-18T12:30:00Z',
      impact: 'HIGH',
      forecast: '2.5%',
      previous: '2.9%',
      description: 'Главный индикатор американской инфляции. Замедление роста цен усиливает спрос на рисковые активы.',
      affectedAssets: ['BTC', 'SP500', 'GOLD'],
    },
    {
      id: 'cal-eth-dencun-3',
      title: 'Ethereum Core Devs AllCoreDevs Call',
      category: 'CRYPTO_CATALYST',
      date: '2026-09-19T14:00:00Z',
      impact: 'MEDIUM',
      description: 'Обсуждение дорожной карты следующего хардфорка Pectra и масштабирования blob-транзакций (EIP-4844).',
      affectedAssets: ['ETH', 'ARB', 'OP'],
    },
    {
      id: 'cal-unlock-sol-4',
      title: 'Разблокировка токенов экосистемы (Cliff Unlock)',
      category: 'TOKEN_UNLOCK',
      date: '2026-09-21T00:00:00Z',
      impact: 'MEDIUM',
      forecast: '$42.5M',
      previous: '$38.0M',
      description: 'Плановый разлок линейной вестинг-эмиссии для ранних инвесторов и разработчиков.',
      affectedAssets: ['SOL', 'SUI', 'APT'],
    },
    {
      id: 'cal-nfp-5',
      title: 'Отчет по занятости США вне с/х (Non-Farm Payrolls)',
      category: 'MACRO_ECONOMICS',
      date: '2026-09-25T12:30:00Z',
      impact: 'HIGH',
      forecast: '165K',
      previous: '142K',
      description: 'Барометр устойчивости американского рынка труда, определяющий жесткость монетарной политики.',
      affectedAssets: ['BTC', 'ETH'],
    },
  ];

  public static getEvents(filterCategory?: EventCategory, filterImpact?: EventImpact): CalendarEvent[] {
    return this.events.filter((e) => {
      if (filterCategory && e.category !== filterCategory) return false;
      if (filterImpact && e.impact !== filterImpact) return false;
      return true;
    });
  }

  public static getNextMajorEvent(): CalendarEvent | null {
    const highImpact = this.events.filter((e) => e.impact === 'HIGH');
    return highImpact[0] || null;
  }
}
