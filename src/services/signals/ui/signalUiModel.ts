/**
 * signalUiModel — единственная точка отображения `SignalDto` (сервер) в модель UI.
 *
 * Зачем отдельный слой: Signals V2 показывает ТОЛЬКО то, что сохранил сервер
 * (`GET /api/signals`). Если раскладывать DTO по компонентам, «удобные»
 * округления и досчёты уровней расползутся по экранам, а проверить их тестами
 * станет невозможно. Отображение здесь одно, оно чистое (без React) и покрыто
 * юнит-тестами: произвольная длина `targets[]`, отсутствующие поля, статусы,
 * которые сервер не знает, и запрет на выдуманные уровни.
 *
 * Инварианты (проверяются тестами tests/unit/signalUiModel.test.ts):
 *   • ни одна цена не вычисляется: `entryMin/entryMax/stopLoss/targets[i]`,
 *     а после исполнения `fillPrice/fillStop/fillTargets[i]` — как пришли;
 *   • `targets` произвольной длины: 0, 1, 3, 5 — рендерится фактический массив,
 *     UI не захардкожен под «ровно TP1/TP2»;
 *   • `tp1`/`tp2` из DTO используются ТОЛЬКО как запасной путь для строк
 *     миграции 007 (`targets === null`), что соответствует `resolveLevels()`
 *     на сервере: массив целей имеет приоритет;
 *   • R показывается только у состояний со сделкой; `null` → «сделки не было»;
 *   • неизвестный серверу статус не подменяется нейтральным словом.
 */

import type { SignalDto, SignalProvenanceStatus } from '@/services/strategyOps';
import { OPEN_SIGNAL_STATUSES } from '@/services/strategyOps';
import {
  describeServerSignalOutcome,
  directionHint,
  directionText,
  entryTypeText,
  entryZoneText,
  formatSignalPrice,
  isKnownServerStatus,
  resultSummary,
  serverStatusHint,
  serverStatusLabel,
  serverStatusShortLabel,
  serverStatusTone,
  signalBaseSymbol,
  signalPairText,
  statusHasTrade,
  stopSign,
  strategyText,
  targetLabel,
  timeframeText,
  type ServerStatusTone,
} from '@/utils/serverSignalText';
import { exitReasonLabelRu, strategyShortLabel } from '@/utils/signalText';

/** Строка уровня: то, что показывается в панели и рисуется линией на графике. */
export interface SignalLevelRow {
  /** Стабильный идентификатор — ключ React и id линии графика. */
  id: string;
  kind: 'entry' | 'stop' | 'target';
  /** Человеческая подпись: «Вход (низ зоны)», «Стоп», «Цель 3». */
  label: string;
  /** Цена КАК ЕЁ СОХРАНИЛ СЕРВЕР. Никаких средних по зоне и округлений. */
  price: number;
  tone: 'cyan' | 'red' | 'green';
  /** Для стопа — знак сравнения относительно входа (LONG '<', SHORT '>'). */
  comparator?: '<' | '>';
  /** Индекс цели (0-based) — только для kind === 'target'. */
  targetIndex?: number;
  /** Уровни после исполнения (ядро сдвигает стоп/цели, например V2.8). */
  effective?: boolean;
}

export interface SignalUiModel {
  id: string;
  /** «BTC/USDT» — форма, в которой сигнал хранится в БД. */
  pair: string;
  /** «BTC» — для селектора монет и запроса свечей. */
  baseSymbol: string;
  direction: 'LONG' | 'SHORT';
  directionText: string;
  directionHint: string;
  strategyId: string;
  strategyShort: string;
  /** «V3.0 · v3.0» — короткое имя + версия на момент публикации. */
  strategyText: string;
  /** Таймфрейм СИГНАЛА (исполнения) как его отдал сервер; у всех трёх стратегий '1h'. */
  timeframe: string;
  status: string;
  statusLabel: string;
  statusShortLabel: string;
  statusTone: ServerStatusTone;
  statusHint: string;
  /** Статус из известного серверу домена (иначе подпись помечена как неизвестная). */
  statusKnown: boolean;
  /** Сделка была (есть R)? Тот же домен, что у сервера. */
  hasTrade: boolean;
  /** Открыт ли сигнал (ACTIVE | FILLED) — домен из ответа API. */
  isOpen: boolean;

  /** ISO-строки: форматирование LOCAL/UTC делает компонент (переключатель времени). */
  signalCandleTs: string;
  createdAt: string;
  updatedAt: string;
  filledAt: string | null;
  closedAt: string | null;

  entry: {
    min: number | null;
    max: number | null;
    /** «115 200,50 – 115 480,25 (лимитный вход в коридоре)». */
    text: string;
    typeText: string;
    validForBars: number | null;
  };
  stop: {
    price: number | null;
    text: string;
    sign: '<' | '>';
  };
  /** Фактическая лестница целей — произвольной длины. */
  targets: Array<{ index: number; price: number; label: string; text: string }>;
  hasTargets: boolean;

  /** Публикационные уровни (то, что стратегия посчитала в момент публикации). */
  levels: SignalLevelRow[];
  /**
   * Эффективные уровни после исполнения (`fillStop`/`fillTargets`) — отдельный
   * набор: оба честны, подменять один другим нельзя.
   */
  effectiveLevels: SignalLevelRow[];
  fill: { price: number | null; priceText: string; at: string | null } | null;

  outcome: {
    summaryLine: string;
    gross: string;
    net: string;
    pnlPct: string;
    closePriceText: string;
    closeReasonText: string | null;
    barsHeld: number | null;
  };

  analytics: {
    riskRewardRatio: number | null;
    confirmingFactors: string[];
    invalidationFactors: string[];
    latencyBars: number | null;
    engineVersion: string | null;
    exitRule: string | null;
    publishedAt: string | null;
  };

  integrity: {
    chainVersion: number;
    hash: string;
    previousHash: string;
    outcomeHash: string | null;
    /** Короткая форма для компактного индикатора (§7: хэши не доминируют). */
    hashShort: string;
  };

  /** Происхождение сигнала (миграция 011), скопированное дословно из SignalDto. */
  provenanceStatus: SignalProvenanceStatus;
}

/** Обрезка хэша до читаемого префикса — полные значения остаются в деталях. */
export function shortHash(hash: string | null | undefined, size = 10): string {
  if (typeof hash !== 'string' || hash.length === 0) return '—';
  return hash.length <= size ? hash : `${hash.slice(0, size)}…`;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Цели сигнала: канонический массив `targets[]`.
 *
 * `tp1`/`tp2` используются только если сервер не отдал массив (строки формы
 * миграции 007, `targets === null`) — ровно как в `resolveLevels()` на сервере:
 * массив в приоритете. ПУСТОЙ массив — это честное «целей нет», из наследия он
 * не достраивается.
 */
export function resolveTargetPrices(signal: SignalDto): number[] {
  if (Array.isArray(signal.targets)) {
    return signal.targets.map(finiteOrNull).filter((v): v is number => v !== null);
  }
  const legacy = [signal.tp1, signal.tp2].map(finiteOrNull).filter((v): v is number => v !== null);
  return legacy;
}

/** Публикационные уровни: вход (границы зоны как отдельные уровни), стоп, цели. */
export function buildLevelRows(signal: SignalDto): SignalLevelRow[] {
  const rows: SignalLevelRow[] = [];
  const entryMin = finiteOrNull(signal.entryMin);
  const entryMax = finiteOrNull(signal.entryMax);

  if (entryMin !== null && entryMax !== null && entryMin !== entryMax) {
    // Зона входа — ДВЕ сохранённые сервером цены: усреднять их запрещено (инвариант §1).
    rows.push({ id: 'entry-low', kind: 'entry', label: 'Вход (низ зоны)', price: entryMin, tone: 'cyan' });
    rows.push({ id: 'entry-high', kind: 'entry', label: 'Вход (верх зоны)', price: entryMax, tone: 'cyan' });
  } else if (entryMin !== null || entryMax !== null) {
    const price = entryMin ?? entryMax;
    if (price !== null) rows.push({ id: 'entry', kind: 'entry', label: 'Вход', price, tone: 'cyan' });
  }

  const stop = finiteOrNull(signal.stopLoss);
  if (stop !== null) {
    rows.push({
      id: 'stop',
      kind: 'stop',
      label: 'Стоп',
      price: stop,
      tone: 'red',
      comparator: stopSign(signal.direction),
    });
  }

  resolveTargetPrices(signal).forEach((price, index) => {
    rows.push({
      id: `target-${index + 1}`,
      kind: 'target',
      label: targetLabel(index),
      price,
      tone: 'green',
      targetIndex: index,
    });
  });

  return rows;
}

/** Эффективные уровни после исполнения — только если сервер их отдал. */
export function buildEffectiveLevelRows(signal: SignalDto): SignalLevelRow[] {
  if (signal.fillPrice === null && signal.fillStop === null && !Array.isArray(signal.fillTargets)) {
    return [];
  }
  const rows: SignalLevelRow[] = [];
  const fillPrice = finiteOrNull(signal.fillPrice);
  if (fillPrice !== null) {
    rows.push({
      id: 'fill-price',
      kind: 'entry',
      label: 'Факт входа',
      price: fillPrice,
      tone: 'cyan',
      effective: true,
    });
  }
  const fillStop = finiteOrNull(signal.fillStop);
  if (fillStop !== null) {
    rows.push({
      id: 'fill-stop',
      kind: 'stop',
      label: 'Эффективный стоп',
      price: fillStop,
      tone: 'red',
      comparator: stopSign(signal.direction),
      effective: true,
    });
  }
  if (Array.isArray(signal.fillTargets)) {
    signal.fillTargets
      .map(finiteOrNull)
      .forEach((price, index) => {
        if (price === null) return;
        rows.push({
          id: `fill-target-${index + 1}`,
          kind: 'target',
          label: `${targetLabel(index)} (эффективная)`,
          price,
          tone: 'green',
          targetIndex: index,
          effective: true,
        });
      });
  }
  return rows;
}

/** Полное отображение DTO → модель UI. */
export function toSignalUiModel(signal: SignalDto): SignalUiModel {
  const metadata = signal.metadata ?? {};
  const targets = resolveTargetPrices(signal);
  const result = resultSummary(signal);
  const entryMin = finiteOrNull(signal.entryMin);
  const entryMax = finiteOrNull(signal.entryMax);
  const stopPrice = finiteOrNull(signal.stopLoss);

  return {
    id: signal.id,
    pair: signalPairText(signal.symbol),
    baseSymbol: signalBaseSymbol(signal.symbol),
    direction: signal.direction,
    directionText: directionText(signal.direction),
    directionHint: directionHint(signal.direction),
    strategyId: signal.strategyId,
    strategyShort: strategyShortLabel(signal.strategyId),
    strategyText: strategyText(signal.strategyId, signal.strategyVersion),
    timeframe: timeframeText(signal.timeframe),
    status: signal.status,
    statusLabel: serverStatusLabel(signal.status),
    statusShortLabel: serverStatusShortLabel(signal.status),
    statusTone: serverStatusTone(signal.status),
    statusHint: serverStatusHint(signal.status),
    statusKnown: isKnownServerStatus(signal.status),
    hasTrade: statusHasTrade(signal.status),
    isOpen: (OPEN_SIGNAL_STATUSES as readonly string[]).includes(signal.status),

    signalCandleTs: signal.signalCandleTs,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    filledAt: signal.filledAt,
    closedAt: signal.closedAt,

    entry: {
      min: entryMin,
      max: entryMax,
      text: entryZoneText(signal.entryMin, signal.entryMax, signal.entryType),
      typeText: entryTypeText(signal.entryType, signal.validForBars),
      validForBars: signal.validForBars,
    },
    stop: {
      price: stopPrice,
      text: stopPrice === null ? '—' : `${stopSign(signal.direction)} ${formatSignalPrice(stopPrice)}`,
      sign: stopSign(signal.direction),
    },
    targets: targets.map((price, index) => ({
      index,
      price,
      label: targetLabel(index),
      text: formatSignalPrice(price),
    })),
    hasTargets: targets.length > 0,

    levels: buildLevelRows(signal),
    effectiveLevels: buildEffectiveLevelRows(signal),
    fill:
      signal.fillPrice !== null || signal.filledAt !== null
        ? {
            price: finiteOrNull(signal.fillPrice),
            priceText: formatSignalPrice(signal.fillPrice),
            at: signal.filledAt,
          }
        : null,

    outcome: {
      summaryLine: describeServerSignalOutcome(signal),
      gross: result.gross,
      net: result.net,
      pnlPct: result.pnlPct,
      closePriceText: formatSignalPrice(signal.closePrice),
      closeReasonText: signal.closeReason ? exitReasonLabelRu(signal.closeReason) : null,
      barsHeld: typeof signal.barsHeld === 'number' && Number.isFinite(signal.barsHeld) ? signal.barsHeld : null,
    },

    analytics: {
      riskRewardRatio: finiteOrNull(metadata.riskRewardRatio ?? null),
      confirmingFactors: Array.isArray(metadata.confirmingFactors) ? metadata.confirmingFactors : [],
      invalidationFactors: Array.isArray(metadata.invalidationFactors) ? metadata.invalidationFactors : [],
      latencyBars: finiteOrNull(metadata.latencyBars ?? null),
      engineVersion: typeof metadata.engineVersion === 'string' ? metadata.engineVersion : null,
      exitRule: signal.exitRule,
      publishedAt: typeof metadata.publishedAt === 'string' ? metadata.publishedAt : null,
    },

    integrity: {
      chainVersion: signal.chainVersion,
      hash: signal.hash,
      previousHash: signal.previousHash,
      outcomeHash: signal.outcomeHash,
      hashShort: shortHash(signal.hash),
    },

    provenanceStatus: signal.provenanceStatus,
  };
}

export function toSignalUiModels(signals: readonly SignalDto[]): SignalUiModel[] {
  return signals.map(toSignalUiModel);
}

/**
 * Последний сигнал выбранного инструмента.
 *
 * Порядок сервера (`created_at DESC, id DESC`) НЕ пересортировывается: первый
 * элемент ленты и есть самый свежий. Если лента пуста — null, и это пустое
 * состояние, а не ошибка.
 */
export function latestSignal(models: readonly SignalUiModel[]): SignalUiModel | null {
  return models.length > 0 ? models[0]! : null;
}

/**
 * Символы, по которым в ЗАГРУЖЕННОЙ ленте есть сигналы.
 *
 * Отдельный запрос «все монеты с сигналами» не делается: достаточно distinct по
 * уже полученной странице (иначе селектор породил бы веер запросов).
 */
export function symbolsWithSignals(signals: readonly SignalDto[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of signals) {
    const pair = signalPairText(s.symbol);
    if (!seen.has(pair)) {
      seen.add(pair);
      out.push(pair);
    }
  }
  return out;
}

/**
 * Сигнал, уровни которого рисуются на графике.
 *
 * Явный выбор пользователя важнее «последнего»: если выбран сигнал из истории,
 * линии переключаются на него, и смешения уровней разных сигналов не происходит.
 * `selectedId`, которого нет в ленте (например, лента перезагрузилась), — null.
 */
export function resolveActiveSignal(
  models: readonly SignalUiModel[],
  selectedId: string | null
): SignalUiModel | null {
  if (selectedId) {
    const found = models.find((m) => m.id === selectedId);
    if (found) return found;
  }
  return latestSignal(models);
}
