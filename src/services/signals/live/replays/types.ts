/**
 * Общие типы для LIVE-реплеев архивных стратегий.
 *
 * Реплей — детерминированная функция от окна ЗАКРЫТЫХ свечей: он проходит окно
 * бар за баром ровно так, как это делал исследовательский раннер стратегии, и
 * возвращает все сетапы окна с тем состоянием жизненного цикла, которое
 * известно по закрытым свечам (коридор ждёт / исполнен / отменён / истёк,
 * позиция открыта / закрыта с результатом в R).
 *
 * Движок публикует в журнал только сетапы ПОСЛЕДНЕГО закрытого бара (задержка
 * 0 баров). Остальные записи окна — ретроспектива: они показываются отдельно и
 * никогда не попадают в журнал аудита.
 */
import type { ArchiveDirection } from '@/services/strategyArchive/types';

export type ReplayEntryType = 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';

export type ReplayFinalStatus =
  | 'TARGET_REACHED'
  | 'INVALIDATED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNRESOLVED';

export interface ReplayFill {
  barOpenTime: number;
  price: number;
  /** Стоп после исполнения (для V2.8 — сдвинут на дельту исполнения). */
  stop: number;
  /** Цели после исполнения. */
  targets: number[];
}

export interface ReplayOutcome {
  status: ReplayFinalStatus;
  /** openTime бара, на котором зафиксирован исход. */
  barOpenTime: number;
  /** Причина в терминах стратегии (SL, TP2, TP1_THEN_BE, TRAIL, EXPIRED, …). */
  exitReason: string;
  exitPrice: number | null;
  /** Gross R (без комиссий). null, если сделки не было. */
  grossR: number | null;
  /** Net R по модели 2/5 bps (maker вход / taker выход). null, если сделки не было. */
  netR: number | null;
  barsHeld: number | null;
}

export interface ReplayRecord {
  strategyId: string;
  strategyVersion: string;
  /** Базовый актив (BTC, ETH, …). */
  symbol: string;
  direction: ArchiveDirection;
  setupOpenTime: number;
  setupCloseTime: number;
  setupClose: number;
  entryType: ReplayEntryType;
  entryZone: [number, number];
  stop: number;
  targets: number[];
  riskRewardRatio: number;
  validForBars: number | null;
  exitRule: string;
  confirmingFactors: string[];
  invalidationFactors: string[];
  fill: ReplayFill | null;
  outcome: ReplayOutcome | null;
  /**
   * Пригодность к публикации в журнал на баре сетапа: геометрия (стоп с нужной
   * стороны, TP1 впереди, TP2 дальше TP1) выполняется при ХУДШЕМ исполнении в
   * коридоре. Исследовательский раннер создаёт такие «pending» и отклоняет их
   * на баре исполнения (`REJECTED_GEOMETRY`); в журнал они не публикуются, но
   * остаются в ретроспективе, чтобы счётчики сходились с воронкой исследования.
   */
  publishable: boolean;
  publishNote: string | null;
  /**
   * Структурный контекст сетапа (для диагностики окна и тестов): например,
   * openTime 4H-бара, с которого известна зона V3.3, и openTime бара её митигации.
   */
  meta?: Readonly<Record<string, number | string | null>>;
}

export interface ReplayOutput {
  records: ReplayRecord[];
  /** Сколько закрытых баров реально оценено (после прогрева). */
  evaluatedBars: number;
  firstEvaluatedOpenTime: number | null;
  lastEvaluatedOpenTime: number | null;
  /** Ограничения окна, о которых стоит знать читателю (усечение истории и т.п.). */
  notes: string[];
}

export const EMPTY_REPLAY: ReplayOutput = Object.freeze({
  records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [],
}) as ReplayOutput;
