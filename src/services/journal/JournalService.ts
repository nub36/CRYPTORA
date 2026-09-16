export interface JournalEntry {
  id: string;
  date: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  positionSizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  setupReason: string;
  reflection: string;
  disciplineScore: number; // 1 to 5
  tags: string[];
}

export interface JournalSummary {
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  winRatePct: number;
  netPnlUsd: number;
  avgDisciplineScore: number;
}

const STORAGE_KEY = 'cryptora_trade_journal';

export class JournalService {
  private static instance: JournalService | null = null;
  private entries: JournalEntry[] = [];

  constructor() {
    this.loadEntries();
  }

  public static getInstance(): JournalService {
    if (!JournalService.instance) {
      JournalService.instance = new JournalService();
    }
    return JournalService.instance;
  }

  private loadEntries(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          this.entries = JSON.parse(saved);
          return;
        }
      }
    } catch {
      // fallback to seed
    }

    // Default Seed Entries (Realistic analytical paper trades)
    this.entries = [
      {
        id: 'journal-1',
        date: '2026-09-14T14:30:00Z',
        symbol: 'BTC',
        direction: 'LONG',
        entryPrice: 63850,
        exitPrice: 65400,
        positionSizeUsd: 5000,
        pnlUsd: 121.38,
        pnlPct: 2.43,
        setupReason: 'Тест 4h уровня поддержки с бычьей дивергенцией RSI и всплеском спотового объема Z-Score +2.8σ.',
        reflection: 'Дисциплина соблюдена. Выход точно по первому расчетному тейк-профиту.',
        disciplineScore: 5,
        tags: ['RSI Divergence', 'Volume Spike', 'Take Profit'],
      },
      {
        id: 'journal-2',
        date: '2026-09-13T09:15:00Z',
        symbol: 'SOL',
        direction: 'SHORT',
        entryPrice: 157.2,
        exitPrice: 161.0,
        positionSizeUsd: 3000,
        pnlUsd: -72.52,
        pnlPct: -2.42,
        setupReason: 'Попытка зашортить локальный хай при отрицательном фандинге.',
        reflection: 'Ошибка: торговля против агрессивного притока открытого интереса (Short Squeeze). Стоп-лосс сработал четко по правилам.',
        disciplineScore: 4,
        tags: ['Stop Loss', 'Short Squeeze', 'Lesson'],
      },
      {
        id: 'journal-3',
        date: '2026-09-11T18:00:00Z',
        symbol: 'ETH',
        direction: 'LONG',
        entryPrice: 3390,
        exitPrice: 3510,
        positionSizeUsd: 4000,
        pnlUsd: 141.6,
        pnlPct: 3.54,
        setupReason: 'Пробой 200 SMA на часовом графике с ростом деривативного открытого интереса.',
        reflection: 'Отличный сетап. Не поддался соблазну закрыть позицию раньше времени.',
        disciplineScore: 5,
        tags: ['Breakout', 'SMA-200', 'Trend'],
      },
    ];
  }

  private save(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
      }
    } catch {
      // ignore
    }
  }

  public getEntries(): JournalEntry[] {
    return [...this.entries];
  }

  public addEntry(entry: Omit<JournalEntry, 'id'>): JournalEntry {
    const newEntry: JournalEntry = {
      ...entry,
      id: `journal-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    };
    this.entries.unshift(newEntry);
    this.save();
    return newEntry;
  }

  public deleteEntry(id: string): boolean {
    const initialLen = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getSummary(): JournalSummary {
    const totalTrades = this.entries.length;
    const profitableTrades = this.entries.filter((e) => e.pnlUsd > 0).length;
    const losingTrades = this.entries.filter((e) => e.pnlUsd <= 0).length;

    const winRatePct =
      totalTrades > 0 ? Number(((profitableTrades / totalTrades) * 100).toFixed(1)) : 0;

    const netPnlUsd = Number(
      this.entries.reduce((acc, e) => acc + e.pnlUsd, 0).toFixed(2)
    );

    const avgDisciplineScore =
      totalTrades > 0
        ? Number(
            (
              this.entries.reduce((acc, e) => acc + e.disciplineScore, 0) /
              totalTrades
            ).toFixed(1)
          )
        : 5.0;

    return {
      totalTrades,
      profitableTrades,
      losingTrades,
      winRatePct,
      netPnlUsd,
      avgDisciplineScore,
    };
  }
}
