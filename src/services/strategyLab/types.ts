/**
 * CRYPTORA — Strategy Lab · shared contracts (Phase 2A Constructor)
 * ---------------------------------------------------------------------------
 * RESEARCH ONLY. Ничего из этого модуля не участвует в production-стратегиях
 * (V2.8/V3.0/V3.3/V3.4), production-сигналах, scheduler или БД. Это отдельный
 * исследовательский контур.
 *
 * Модуль библиотечно-независимый (нет React, нет lightweight-charts): те же
 * типы используются исследовательским движком, который СЕРВЕР исполняет через
 * esbuild-бандл (см. server/services/strategyLab/labCoreBundle.js), и фронтендом
 * только для визуализации ответа. Формулы существуют в ОДНОМ месте (engine),
 * копии в React нет.
 *
 * Единицы времени: ВСЕ поля времени — Unix-СЕКУНДЫ (как OHLCV.time и как ждёт
 * lightweight-charts). Так фронтенд отдаёт свечи в CandleChart без конвертации.
 */

import type { StrategyGraph } from './graph/types';

/** Таймфреймы, разрешённые в Lab (собственный список; НЕ production `Timeframe`). */
export const LAB_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type LabTimeframe = (typeof LAB_TIMEFRAMES)[number];

/** Длительность бара в СЕКУНДАХ — для проверки диапазона и семантики закрытия. */
export const LAB_TF_SECONDS: Readonly<Record<LabTimeframe, number>> = Object.freeze({
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
});

export type LabMarket = 'spot' | 'futures';
export type LabSide = 'LONG' | 'SHORT';

/** Источник-специфичные потолки; сервер применяет их после выбора источника. */
export const REST_MAX_CANDLES = 5000;
export const LOCAL_MAX_CANDLES = 120000;
/** @deprecated Совместимый alias старого REST-лимита. */
export const LAB_MAX_CANDLES = REST_MAX_CANDLES;

/**
 * Свеча Lab. `time`/`closeTime` — Unix-секунды. `closeTime` = последняя секунда
 * интервала (openTime + span − 1). Формирующаяся свеча в Lab не попадает СЮДА
 * вовсе (её отбрасывает server/services/strategyLab/historicalCandles.js).
 */
export interface LabCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Конструктор стратегий (Phase 2A: Декларативный Draft Definition)
// ─────────────────────────────────────────────────────────────────────────────

export type IndicatorType = 'EMA' | 'ATR' | 'RSI' | 'FRACTALS';
export type IndicatorSource = 'close' | 'open' | 'high' | 'low';

export interface IndicatorDefinition {
  id: string;
  type: IndicatorType;
  name?: string;
  period: number;
  source?: IndicatorSource;
  visible?: boolean;
}

export type LogicOperator = 'crossesAbove' | 'crossesBelow';

export type CrossCondition = { kind?: 'cross'; left: string; operator: LogicOperator; right: string };
export type ThresholdCondition = { kind: 'threshold'; left: string; right: string; indicatorId: string; operator: 'above' | 'below'; threshold: number };
export type FractalCondition = { kind: 'fractal'; left: string; right: string; indicatorId: string; operator: 'fractalHigh' | 'fractalLow' };
export type StrategyCondition = CrossCondition | ThresholdCondition | FractalCondition;
export type LogicRule = StrategyCondition;

export interface StopDefinition {
  type: 'atrMultiple';
  indicatorId: string; // ID индикатора ATR
  multiplier: number;
}

export interface TargetDefinition {
  type: 'rMultiple';
  multiple: number;
}

export interface ExecutionSettings {
  /** Комиссия в базисных пунктах (bps) НА СТОРОНУ (вход и выход). */
  feeBps: number;
  /** Проскальзывание в bps, применяется к цене входа/выхода. */
  slippageBps: number;
}

/** Декларативное определение стратегии, собранной в Конструкторе. */
export interface StrategyDraftDefinition {
  name: string;
  indicators: IndicatorDefinition[];
  long: LogicRule;
  short: LogicRule;
  stop: StopDefinition;
  target: TargetDefinition;
  execution?: ExecutionSettings;
}

/** Исследовательская конфигурация (Legacy Phase 1A формат для обратной совместимости). */
export interface ResearchConfig {
  indicators: {
    emaFast: number;
    emaSlow: number;
    atrPeriod: number;
  };
  strategy: {
    stopAtrMult: number;
    targetR: number;
  };
  execution: {
    feeBps: number;
    slippageBps: number;
  };
}

export type LabEventKind =
  | 'CANDIDATE'
  | 'ENTRY'
  | 'FILL'
  | 'STOP'
  | 'TP1'
  | 'EXIT'
  | 'REJECTION';

/**
 * Диагностическое событие Lab.
 *
 * КРИТИЧЕСКИ (§15): `knownAt >= candleTime`. Решение на баре i использует только
 * бары ≤ i; `knownAt` — момент, когда событие стало известно (обычно closeTime
 * бара решения). При будущем replayTime=T событие с `knownAt > T` не показывается.
 */
export interface LabEvent {
  id: string;
  kind: LabEventKind;
  /** openTime бара, к которому событие привязано (секунды). */
  candleTime: number;
  /** Когда событие стало известно (секунды). Всегда ≥ candleTime. */
  knownAt: number;
  side?: LabSide;
  price?: number;
  /** Зона входа [min, max] (например коридор/диапазон). */
  zone?: [number, number];
  /** Причина (для REJECTION/EXIT) в терминах движка стратегии. */
  reason?: string;
  payload?: Record<string, unknown>;
}

export type LabTradeOutcome = 'TARGET' | 'STOP' | 'EXIT';

export interface LabTrade {
  id: string;
  side: LabSide;
  /** openTime бара сигнала (решение), секунды. */
  signalTime: number;
  /** openTime бара исполнения (вход по open следующего бара), секунды. */
  entryTime: number;
  entryPrice: number;
  stop: number;
  target: number;
  exitTime: number;
  exitPrice: number;
  outcome: LabTradeOutcome;
  /** TARGET / STOP / END_OF_DATA / SAME_BAR_STOP_FIRST. */
  exitReason: string;
  /** Валовой R (без комиссий/проскальзывания в R). */
  grossR: number;
  /** Чистый R (после комиссии; проскальзывание уже в ценах). */
  netR: number;
  barsHeld: number;
}

export interface LabRejection {
  id: string;
  candleTime: number;
  knownAt: number;
  side?: LabSide;
  /** Реальная причина движка стратегии (NO_ATR / ZERO_ATR / NO_ENTRY_BAR). */
  reason: string;
  diagnostics: Record<string, number | string | null>;
}

/** Индикаторы, ВЫРОВНЕННЫЕ по индексу свечей (null во время прогрева). */
export interface LabIndicatorSeries {
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  atr: (number | null)[];
  /** Полная карта серий по id индикаторов для конструктора. */
  byIndicatorId?: Record<string, (number | null)[]>;
  /** Список определений индикаторов (с флагами visible/period/name). */
  indicatorsList?: IndicatorDefinition[];
  fractalEvents?: Array<{ indicatorId: string; kind: 'HIGH' | 'LOW'; sourceIndex: number; sourceCandleTime: number; confirmationIndex: number; knownAt: number; price: number }>;
}

export interface LabMetrics {
  totalCandidates: number;
  accepted: number;
  rejected: number;
  trades: number;
  resolved: number;
  profitable: number;
  losing: number;
  breakEven: number;
  /** Доля выигрышных среди разрешённых, 0..1. null — если считать не из чего. */
  winRate: number | null;
  /** Средний чистый R по сделкам. null — если сделок нет. */
  averageNetR: number | null;
  /** Матожидание в R на сделку. null — если сделок нет. */
  expectancy: number | null;
  /** Profit factor (сумма плюсов / |сумма минусов|). null — если нет минусов/сделок. */
  profitFactor: number | null;
  /** Максимальная просадка кривой суммарного R (в R, ≥ 0). null — если сделок нет. */
  maxDrawdownR: number | null;
}

export interface LabReplayMeta {
  /** Server replay source; pure engine calls may omit it before orchestration. */
  dataSource?: 'local-dataset' | 'binance-rest';
  dataset?: {
    version: string;
    manifestGeneratedAt: string;
    coverageFrom: string;
    coverageTo: string;
    seriesSha256: string;
  };
  strategyId: string;
  strategyName: string;
  market: LabMarket;
  symbol: string;
  timeframe: LabTimeframe;
  from: number;
  to: number;
  candleCount: number;
  evaluatedBars: number;
  warmupBars: number;
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  /** Документированное правило одинаковой свечи SL/TP. */
  sameBarRule: string;
  researchOnly: true;
  generatedAt: number;
  notes: string[];
}

export interface LabReplayResult {
  meta: LabReplayMeta;
  candles: LabCandle[];
  indicators: LabIndicatorSeries;
  events: LabEvent[];
  trades: LabTrade[];
  rejections: LabRejection[];
  metrics: LabMetrics;
}

/** Вход исследовательского движка (чистая функция, без сети). */
export interface LabReplayInput {
  strategyId?: string;
  strategyDefinition?: StrategyDraftDefinition;
  /**
   * Блок-схема (режим «БЛОК-СХЕМА»). Движок компилирует её в
   * `StrategyDraftDefinition` ОДИН раз за реплей и дальше исполняет тот же
   * существующий код — второго движка стратегий не существует.
   */
  strategyGraph?: StrategyGraph;
  market: LabMarket;
  symbol: string;
  timeframe: LabTimeframe;
  from: number;
  to: number;
  candles: LabCandle[];
  researchConfig?: ResearchConfig;
}
