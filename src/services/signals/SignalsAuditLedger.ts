/**
 * SignalsAuditLedger — append-only журнал аналитических сетапов.
 *
 * Две неизменяемые части у каждой записи:
 *
 *  1. ISSUANCE (публикация): что и когда было опубликовано — уровни входа,
 *     стоп, цели, факторы, время бара и время публикации. Хэшируется цепочкой
 *     SHA-256 (`auditHash` = sha256(issuance + prevHash)). Редактирование
 *     задним числом ломает `verifyIntegrity()`.
 *
 *  2. OUTCOME (исход): заполнение лимитного коридора и закрытие по правилам
 *     самой стратегии (TP/SL/таймаут/трейлинг), рассчитанное по ЗАКРЫТЫМ
 *     свечам биржи. Записывается ровно один раз и фиксируется отдельным
 *     хэшем `outcomeHash` = sha256(auditHash + outcome). Исход нельзя
 *     переписать: убыточные сетапы остаются в журнале навсегда.
 *
 * Хранилище — localStorage браузера (ключ `cryptora_signals_ledger_v2`).
 * Это НЕ серверный трек-рекорд: журнал существует только в том браузере, где
 * работал движок. CRYPTORA не исполняет сделки.
 */
import type { Timeframe } from '@/types/market';
import { sha256Hex } from '@/utils/sha256';

export type SetupStatus =
  /** Опубликован, ждёт исполнения лимитного коридора. */
  | 'ACTIVE'
  /** Лимит исполнен (или вход по open N+1) — позиция отслеживается. */
  | 'FILLED'
  /** Достигнута финальная цель стратегии (TP2). */
  | 'TARGET_REACHED'
  /** Сработал первоначальный стоп без TP1 — гипотеза опровергнута. */
  | 'INVALIDATED'
  /** Закрыт по иным правилам стратегии: TP1→BE, TP1→SL, таймаут, трейлинг. R может быть любым. */
  | 'CLOSED'
  /** Коридор истёк (3 бара без касания) — сделки не было. */
  | 'EXPIRED'
  /** Коридор отменён (стоп задет до исполнения / геометрия отклонена) — сделки не было. */
  | 'CANCELLED'
  /** Исход отследить невозможно (бар сетапа вышел за окно данных). */
  | 'UNRESOLVED';

export const CLOSED_STATUSES: readonly SetupStatus[] = Object.freeze([
  'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED',
]);
/** Статусы, при которых сделка реально состоялась и имеет R-результат. */
export const TRADE_CLOSED_STATUSES: readonly SetupStatus[] = Object.freeze([
  'TARGET_REACHED', 'INVALIDATED', 'CLOSED',
]);

export type EntryType = 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';

export interface SetupFill {
  price: number;
  /** ISO-время открытия бара исполнения. */
  at: string;
  barOpenTime: number;
  /** Эффективный стоп после исполнения (V2.8 сдвигает стоп на дельту исполнения). */
  stop?: number;
  /** Эффективные цели после исполнения. */
  targets?: number[];
}

/** Неизменяемая часть записи — то, что было опубликовано. */
export interface SetupIssuance {
  id: string;
  /** Идентификатор стратегии в реестре архива, напр. `V3_0_HTF_LIQUIDATION_TRAP`. */
  strategyId: string;
  /** Версия стратегии, напр. `3.0`. */
  strategyVersion: string;
  /** Инструмент в виде BASE/QUOTE, напр. `BTC/USDT`. */
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  /** Время открытия закрытого бара, на котором сформирован сетап (ms UTC). */
  setupOpenTime: number;
  entryType: EntryType;
  entryZone: [number, number];
  invalidationLevel: number;
  targets: number[];
  riskRewardRatio: number;
  confirmingFactors: string[];
  invalidationFactors: string[];
  /** Правило выхода стратегии человеческим языком. */
  exitRule: string;
  /** Срок действия лимитного коридора в барах (для LIMIT_CORRIDOR). */
  validForBars: number | null;
  /** Время публикации (ISO). */
  createdAt: string;
  /** Сколько баров прошло между закрытием бара сетапа и публикацией (0 = сразу). */
  latencyBars: number;
}

/** Исход — записывается один раз. */
export interface SetupOutcome {
  status: Exclude<SetupStatus, 'ACTIVE' | 'FILLED'>;
  /** ISO-время закрытия бара, на котором зафиксирован исход. */
  closedAt: string;
  /** Причина выхода в терминах стратегии: TP2, SL, TP1_THEN_BE, TIMEOUT, TRAIL, EXPIRED, CANCELLED… */
  exitReason: string;
  exitPrice: number | null;
  /** Результат в R (gross, без комиссий). null, если сделки не было. */
  resultR: number | null;
  /** Результат в R за вычетом комиссий по модели 2/5 bps (maker вход / taker выход). */
  netResultR: number | null;
  /** Результат в % от цены входа (gross). */
  pnlResultPct: number | null;
  barsHeld: number | null;
}

export interface AnalyticalSetup extends SetupIssuance {
  status: SetupStatus;
  fill?: SetupFill;
  closedAt?: string;
  exitReason?: string;
  exitPrice?: number | null;
  resultR?: number | null;
  netResultR?: number | null;
  pnlResultPct?: number | null;
  barsHeld?: number | null;
  /** Хэш предыдущей записи на момент публикации ('GENESIS' для первой). */
  prevHash: string;
  /** Цепочный хэш публикации = sha256(issuance + prevHash). */
  auditHash: string;
  /** Хэш исхода (есть только у закрытых записей). */
  outcomeHash?: string;
}

export type SetupInput = Omit<AnalyticalSetup, 'auditHash' | 'outcomeHash' | 'prevHash'>;

export interface SignalsPerformanceSummary {
  totalSetups: number;
  activeCount: number;
  filledCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  closedCount: number;
  expiredCount: number;
  cancelledCount: number;
  unresolvedCount: number;
  /** Сделок с исходом (TARGET_REACHED + INVALIDATED + CLOSED). */
  tradesClosed: number;
  /** Доля сделок с R > 0 среди закрытых сделок. */
  accuracyRatePct: number;
  averageRiskReward: number;
  /** Средний R (gross) по закрытым сделкам. */
  averageResultR: number;
  /** Средний net R (2/5 bps) по закрытым сделкам. */
  averageNetResultR: number;
  /** Сумма net R по закрытым сделкам. */
  totalNetResultR: number;
  averageReturnPct: number;
}

export const SIGNALS_LEDGER_STORAGE_KEY = 'cryptora_signals_ledger_v2';
const MAX_STORED = 500;

type Listener = () => void;

function canonicalIssuance(s: SetupIssuance): Record<string, unknown> {
  // Фиксированный порядок ключей: хэш не должен зависеть от порядка полей в объекте.
  return {
    id: s.id,
    strategyId: s.strategyId,
    strategyVersion: s.strategyVersion,
    symbol: s.symbol,
    direction: s.direction,
    timeframe: s.timeframe,
    setupOpenTime: s.setupOpenTime,
    entryType: s.entryType,
    entryZone: s.entryZone,
    invalidationLevel: s.invalidationLevel,
    targets: s.targets,
    riskRewardRatio: s.riskRewardRatio,
    confirmingFactors: s.confirmingFactors,
    invalidationFactors: s.invalidationFactors,
    exitRule: s.exitRule,
    validForBars: s.validForBars,
    createdAt: s.createdAt,
    latencyBars: s.latencyBars,
  };
}

function canonicalOutcome(s: AnalyticalSetup): Record<string, unknown> {
  return {
    auditHash: s.auditHash,
    status: s.status,
    fill: s.fill
      ? { price: s.fill.price, at: s.fill.at, barOpenTime: s.fill.barOpenTime, stop: s.fill.stop ?? null, targets: s.fill.targets ?? null }
      : null,
    closedAt: s.closedAt ?? null,
    exitReason: s.exitReason ?? null,
    exitPrice: s.exitPrice ?? null,
    resultR: s.resultR ?? null,
    netResultR: s.netResultR ?? null,
    pnlResultPct: s.pnlResultPct ?? null,
    barsHeld: s.barsHeld ?? null,
  };
}

export class SignalsAuditLedger {
  private static instance: SignalsAuditLedger | null = null;
  private setups: AnalyticalSetup[] = [];
  private listeners = new Set<Listener>();
  private lastRaw: string | null = null;

  constructor(initial: ReadonlyArray<SetupInput> = []) {
    this.loadFromStorage();
    for (const raw of initial) this.append(raw);
  }

  public static getInstance(): SignalsAuditLedger {
    if (!SignalsAuditLedger.instance) {
      SignalsAuditLedger.instance = new SignalsAuditLedger();
    }
    return SignalsAuditLedger.instance;
  }

  public static resetInstance(): void {
    SignalsAuditLedger.instance = null;
  }

  /* ------------------------------------------------------------------ */
  /* Хэши                                                                */
  /* ------------------------------------------------------------------ */

  private computeIssuanceHash(issuance: SetupIssuance, prevHash: string): string {
    return `sha256-${sha256Hex(JSON.stringify({ ...canonicalIssuance(issuance), prevHash }))}`;
  }

  private computeOutcomeHash(entry: AnalyticalSetup): string {
    return `sha256-${sha256Hex(JSON.stringify(canonicalOutcome(entry)))}`;
  }

  /* ------------------------------------------------------------------ */
  /* Запись                                                              */
  /* ------------------------------------------------------------------ */

  /** Append-only: запись получает хэш, сцепленный с предыдущей. Повторный id игнорируется. */
  public append(raw: SetupInput): AnalyticalSetup {
    const existing = this.setups.find((s) => s.id === raw.id);
    if (existing) return existing;

    const prev = this.setups.length ? this.setups[this.setups.length - 1]!.auditHash : 'GENESIS';
    const entry: AnalyticalSetup = { ...raw, prevHash: prev, auditHash: this.computeIssuanceHash(raw, prev) };
    if (CLOSED_STATUSES.includes(entry.status)) {
      entry.outcomeHash = this.computeOutcomeHash(entry);
    }
    this.setups.push(entry);
    this.saveToStorage();
    this.emit();
    return entry;
  }

  /** Исполнение лимита: допускается ровно один раз, только из ACTIVE. */
  public markFilled(id: string, fill: SetupFill): AnalyticalSetup | null {
    const entry = this.setups.find((s) => s.id === id);
    if (!entry || entry.status !== 'ACTIVE') return null;
    entry.status = 'FILLED';
    entry.fill = { ...fill };
    this.saveToStorage();
    this.emit();
    return entry;
  }

  /** Исход: записывается один раз; закрытую запись изменить нельзя. */
  public resolve(id: string, outcome: SetupOutcome, fill?: SetupFill): AnalyticalSetup | null {
    const entry = this.setups.find((s) => s.id === id);
    if (!entry || CLOSED_STATUSES.includes(entry.status)) return null;
    if (fill && !entry.fill) entry.fill = { ...fill };
    entry.status = outcome.status;
    entry.closedAt = outcome.closedAt;
    entry.exitReason = outcome.exitReason;
    entry.exitPrice = outcome.exitPrice;
    entry.resultR = outcome.resultR;
    entry.netResultR = outcome.netResultR;
    entry.pnlResultPct = outcome.pnlResultPct;
    entry.barsHeld = outcome.barsHeld;
    entry.outcomeHash = this.computeOutcomeHash(entry);
    this.saveToStorage();
    this.emit();
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* Чтение                                                              */
  /* ------------------------------------------------------------------ */

  public getSetups(): AnalyticalSetup[] {
    return [...this.setups];
  }

  public getById(id: string): AnalyticalSetup | undefined {
    return this.setups.find((s) => s.id === id);
  }

  public getActiveSetups(): AnalyticalSetup[] {
    return this.setups.filter((s) => s.status === 'ACTIVE' || s.status === 'FILLED');
  }

  /** Незакрытые записи конкретной серии (стратегия × инструмент × таймфрейм). */
  public getOpenSetups(strategyId: string, symbol: string, timeframe: Timeframe): AnalyticalSetup[] {
    return this.setups.filter(
      (s) => (s.status === 'ACTIVE' || s.status === 'FILLED')
        && s.strategyId === strategyId && s.symbol === symbol && s.timeframe === timeframe,
    );
  }

  public getSummary(): SignalsPerformanceSummary {
    const count = (st: SetupStatus): number => this.setups.filter((s) => s.status === st).length;
    const totalSetups = this.setups.length;
    const trades = this.setups.filter((s) => TRADE_CLOSED_STATUSES.includes(s.status));
    const resultOf = (s: AnalyticalSetup): number | null =>
      typeof s.resultR === 'number' ? s.resultR : typeof s.pnlResultPct === 'number' ? s.pnlResultPct : null;
    const withResult = trades.filter((s) => resultOf(s) !== null);
    const positive = withResult.filter((s) => (resultOf(s) as number) > 0).length;
    const accuracyRatePct = trades.length > 0 ? Number(((positive / trades.length) * 100).toFixed(1)) : 0;
    const avgRR = totalSetups > 0
      ? Number((this.setups.reduce((acc, s) => acc + s.riskRewardRatio, 0) / totalSetups).toFixed(2))
      : 0;
    const withR = trades.filter((s) => typeof s.resultR === 'number');
    const averageResultR = withR.length > 0
      ? Number((withR.reduce((acc, s) => acc + (s.resultR as number), 0) / withR.length).toFixed(3))
      : 0;
    const withNet = trades.filter((s) => typeof s.netResultR === 'number');
    const totalNetResultR = Number(withNet.reduce((acc, s) => acc + (s.netResultR as number), 0).toFixed(3));
    const averageNetResultR = withNet.length > 0 ? Number((totalNetResultR / withNet.length).toFixed(3)) : 0;
    const withPnl = trades.filter((s) => typeof s.pnlResultPct === 'number');
    const averageReturnPct = withPnl.length > 0
      ? Number((withPnl.reduce((acc, s) => acc + (s.pnlResultPct as number), 0) / withPnl.length).toFixed(2))
      : 0;

    return {
      totalSetups,
      activeCount: count('ACTIVE'),
      filledCount: count('FILLED'),
      targetReachedCount: count('TARGET_REACHED'),
      invalidatedCount: count('INVALIDATED'),
      closedCount: count('CLOSED'),
      expiredCount: count('EXPIRED'),
      cancelledCount: count('CANCELLED'),
      unresolvedCount: count('UNRESOLVED'),
      tradesClosed: trades.length,
      accuracyRatePct,
      averageRiskReward: avgRR,
      averageResultR,
      averageNetResultR,
      totalNetResultR,
      averageReturnPct,
    };
  }

  /**
   * Проверка цепочки публикаций и хэшей исходов. Первая хранимая запись может
   * ссылаться на предшественника, вытесненного лимитом хранилища, поэтому её
   * prevHash принимается как есть; дальше цепочка обязана быть непрерывной.
   */
  public verifyIntegrity(): boolean {
    let prev: string | null = null;
    for (const setup of this.setups) {
      const expectedPrev = prev ?? (typeof setup.prevHash === 'string' ? setup.prevHash : 'GENESIS');
      if (setup.prevHash !== undefined && setup.prevHash !== expectedPrev) return false;
      if (this.computeIssuanceHash(setup, expectedPrev) !== setup.auditHash) return false;
      prev = setup.auditHash;
      if (CLOSED_STATUSES.includes(setup.status)) {
        if (!setup.outcomeHash) return false;
        if (this.computeOutcomeHash(setup) !== setup.outcomeHash) return false;
      } else if (setup.outcomeHash) {
        return false;
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Подписка / хранилище                                                */
  /* ------------------------------------------------------------------ */

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* слушатель не должен ломать журнал */ }
    }
  }

  /**
   * Перечитать хранилище, если его изменила другая вкладка (движок работает
   * только в одной вкладке — см. LiveSignalEngine). Возвращает true при изменении.
   */
  public reload(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const raw = localStorage.getItem(SIGNALS_LEDGER_STORAGE_KEY);
      if (raw === this.lastRaw) return false;
      const parsed = raw ? (JSON.parse(raw) as AnalyticalSetup[]) : [];
      if (!Array.isArray(parsed)) return false;
      this.setups = parsed;
      this.lastRaw = raw;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const toStore = this.setups.slice(-MAX_STORED);
        const raw = JSON.stringify(toStore);
        localStorage.setItem(SIGNALS_LEDGER_STORAGE_KEY, raw);
        this.lastRaw = raw;
      }
    } catch {
      // localStorage недоступен или переполнен — журнал продолжает жить в памяти
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SIGNALS_LEDGER_STORAGE_KEY);
        this.lastRaw = raw;
        if (raw) {
          const parsed = JSON.parse(raw) as AnalyticalSetup[];
          if (Array.isArray(parsed) && parsed.length > 0) this.setups = parsed;
        }
      }
    } catch {
      this.setups = [];
    }
  }
}
