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
      // повреждённое хранилище — начинаем с пустого журнала
    }
    // Журнал личный и пуст по умолчанию (v0.8.34): выдуманные «бумажные сделки» в него не подставляются.
    this.entries = [];
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
