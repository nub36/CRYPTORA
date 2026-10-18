/**
 * CRYPTORA — События жизненного цикла сигнала и их персистентная
 * дедупликация.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Telegram-уведомления обязаны покрывать полный жизненный
 * цикл сигнала, и каждое событие должно уходить пользователю РОВНО ОДИН
 * РАЗ. Источник фактов — ТОЛЬКО то, что сервер записал в `signals`
 * (`server/services/signalRepository.js`): переход статуса, fill
 * (цена/время/эффективные уровни), исход (status, closeReason, exitPrice,
 * R). Никаких собственных расчётов уровней или исходов здесь нет и быть не
 * может (DONT_DO §4: запрет серверной копии математики стратегий).
 *
 * ПРОМЕЖУТОЧНЫЕ СОБЫТИЯ ОТКРЫТОЙ ПОЗИЦИИ (2026-10-05, PR #56, §6
 * docs/SIGNAL_LIFECYCLE_PROGRESS_EVENTS_2026-10-05.md). Frozen-ядро теперь
 * ЭКСПОРТИРУЕТ свой внутренний прогресс: `trackPublishedSetup` в
 * FILLED-результате несёт аддитивное `progress { tp1Booked, tp1At, beArmed,
 * beArmedAt }` — состояние ТОГО ЖЕ степпера, который считает терминальный
 * исход (inspectTrade/inspectTrailing), а не вторая реализация правил.
 * `dispatchSignalProgressEvents` превращает его в события:
 *
 *   • TP1       ⇔ progress.tp1Booked (V3.x, правило R2: включая ветку
 *                 TP2-на-баре-TP1; V2.8 tp1Booked всегда false);
 *   • BREAKEVEN ⇔ progress.beArmed (V3.x: armed-стоп реально действовал на
 *                 обработанном баре — R3 «строго после бара TP1»; V2.8:
 *                 состояние `armed` frozen-трейлинга при MFE ≥ 1R).
 *
 * ТЕРМИНАЛЬНЫЙ ПУТЬ ОСТАЁТСЯ FALLBACK и ИСТИННОЙ ПОСЛЕДНЕЙ ИНСТАНЦИЕЙ:
 * если промежуточные тики пропущены, исход по-прежнему ДОКАЗЫВАЕТ события
 * по правилам frozen-ядра:
 *
 *   • TP1 доказан  ⇔ exitReason ∈ {TP2, TP1_THEN_BE, TP1_THEN_SL,
 *                    TP1_THEN_TIMEOUT} — правило R2 V3.x («TP1 books before
 *                    TP2», включая ветку одновременного касания) и сами
 *                    причины вида «TP1_THEN_*»;
 *   • BREAKEVEN    ⇔ сделка реально ЗАКРЫТА по безубытку: exitReason
 *                    TP1_THEN_BE (V3.x) или BE (V2.8 trail);
 *   • TP2          ⇔ статус TARGET_REACHED (managedStatus('TP2'));
 *   • TP3+         — frozen-ведение целей за пределами TP2 не отслеживает
 *                    (docs/SIGNALS.md §3.1), поэтому такие события не
 *                    создаются искусственно; домен таблицы допускает TPn
 *                    на случай будущей реальной поддержки стратегией.
 *
 * Смешение путей безопасно: если TP1/BREAKEVEN уже записаны progress-путём,
 * терминальная классификация тех же событий гасится PK (signal_id,
 * event_type); если прогресс был пропущен — терминальный путь его
 * восстанавливает. BREAKEVEN для закрытой TP2-сделки НЕ создаётся ни одним
 * из путей (armed-стоп мог не сработать — доказательства нет).
 *
 * ДЕДУПЛИКАЦИЯ — ПЕРСИСТЕНТНАЯ, НЕ В ПАМЯТИ ПРОЦЕССА:
 *   • таблица `signal_lifecycle_events` (миграция 018),
 *     PK (signal_id, event_type);
 *   • `recordSignalLifecycleEvent` делает INSERT … ON CONFLICT DO NOTHING —
 *     уведомление отправляет ТОЛЬКО тот вызов, который ВСТАВИЛ строку;
 *   • рестарт cryptora.service, повторный тик монитора, повторный скан и
 *     гонка параллельных писателей дают ON CONFLICT, а не второе сообщение;
 *   • первая линия защиты остаётся прежней (монотонность `writeLifecycle`:
 *     changed=true только победившему писателю) — эта таблица закрывает
 *     случаи, когда одно событие выводится из РАЗНЫХ переходов
 *     (например, FILL из ACTIVE→FILLED и из «прямого» ACTIVE→терминал).
 *
 * ОТКАЗ НЕ ПРОРУШИВАЕТ НАБЛЮДЕНИЕ. Все функции этого модуля проглатывают
 * собственные ошибки (лог + пропуск отправки): сбой журнала уведомлений не
 * имеет права уронить тик монитора или скан стратегии. Пропуск уведомления
 * при сбое — осознанный выбор в пользу «не более одного раза» (at-most-once):
 * дубликат хуже тишины, а повторная попытка не выдумывается.
 */

import { query } from '../db/pool.js';
import { CLOSED_SIGNAL_STATUSES, NO_TRADE_STATUSES, TRADE_CLOSED_STATUSES } from './signalRepository.js';
import { emitSignalNotification } from './notificationEvents.js';

/** Фиксированные типы событий (без лестницы TPn — она распознаётся отдельно). */
export const SIGNAL_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'NEW_SIGNAL',
  'FILL',
  'BREAKEVEN',
  'STOP_LOSS',
  'CANCELLED',
  'CLOSED',
]);

/** Событие принадлежит лестнице целей (TP1, TP2, … TPn)? */
export function isSignalTargetEventType(eventType) {
  return /^TP[1-9]\d*$/.test(String(eventType ?? ''));
}

/** Значение входит в домен event_type таблицы signal_lifecycle_events? */
export function isSignalLifecycleEventType(eventType) {
  return SIGNAL_LIFECYCLE_EVENT_TYPES.includes(eventType) || isSignalTargetEventType(eventType);
}

/**
 * Причины выхода frozen-ядра, ДОКАЗЫВАЮЩИЕ достижение TP1.
 *
 * Источник — правила V3.x, а не оценка: TP2 невозможен без бронирования TP1
 * (`hitT1`/`!hitTp1 && hitT2` обе ветки ставят hitTp1=true до finish('TP2')),
 * а префикс «TP1_THEN_» означает «TP1 был достигнут, затем …». V2.8 причин
 * TP-класса не имеет (управление — трейлинг, не цели).
 */
const TP1_PROVEN_EXIT_REASONS = Object.freeze([
  'TP2',
  'TP1_THEN_BE',
  'TP1_THEN_SL',
  'TP1_THEN_TIMEOUT',
]);

/** Сделка реально закрыта по безубытку (стоп стоял на уровне входа). */
const BREAKEVEN_EXIT_REASONS = Object.freeze(['TP1_THEN_BE', 'BE']);

/**
 * Причины выхода, ДОКАЗЫВАЮЩИЕ достижение TP1 — экспорт для READ-ONLY
 * проекции прогресса (`projectSignalLifecycleProgress`, ниже): UI обязан
 * выводить TP1-факт из тех же frozen-правил, а не из собственной копии.
 */
export { TP1_PROVEN_EXIT_REASONS, BREAKEVEN_EXIT_REASONS };

/**
 * Стратегии V3.x с коридорным входом: armed-стоп после TP1 стоит РОВНО на
 * цене входа (frozen-правило R3/R4: `stopNow = beArmed ? entry : stop` —
 * `v30Core.ts` / `v33Core.ts`; V3.4 ведётся степпером V3.3, `lifecycle.ts`).
 *
 * Список закрытый сознательно (fail-closed): V2.8 ведёт трейлинг-стоп,
 * значение которого API неизвестно (не равно цене входа), а неизвестная
 * стратегия не имеет доказанного правила — для них действующий стоп НЕ
 * выводится никогда (см. `projectSignalLifecycleProgress`).
 */
export const V3_CORRIDOR_STRATEGY_IDS = Object.freeze([
  'V3_0_HTF_LIQUIDATION_TRAP',
  'V3_3_HTF_ZONE_MITIGATION',
  'V3_4_HTF_ZONE_MITIGATION_QUALITY',
]);

/**
 * Время факта → ISO-строка или честный null.
 *
 * Принимает Date (форма pg-драйвера) и ISO-строку (форма после JSON).
 * Невалидное время — null, а не «сейчас»: выдуманное время здесь запрещено
 * той же политикой, что у `occurred_at` в миграции 018.
 */
function occurredAtIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/**
 * READ-ONLY проекция lifecycle-прогресса для отображения (Signals UI V1).
 *
 * Чистая функция от двух persisted-источников — строки `signals` в форме
 * mapRow и событий её журнала `signal_lifecycle_events`. Ничего не читает из
 * БД, ничего не пишет, стратегию не replay'ит, цену не смотрит: только
 * интерпретирует УЖЕ зафиксированные факты.
 *
 * Правила (каждое — из persisted-данных, выдуманного нет):
 *
 *   • tp1Hit — событие TP1 в журнале ЛИБО терминальный исход с TP1-доказанной
 *     причиной (`TP1_PROVEN_EXIT_REASONS` — строки, закрытые до журнала 018).
 *     Время — только из события; доказанному без времени факту — null.
 *   • tp2Hit — событие TP2 ЛИБО статус TARGET_REACHED (ядро ставит его только
 *     на TP2-выходе, `managedStatus`). Время — из события, иначе `closedAt`
 *     TARGET_REACHED-строки (момент TP2-выхода по построению ядра).
 *   • breakevenArmed — событие BREAKEVEN у ОТКРЫТОЙ (FILLED) строки. У
 *     терминальной строки armed-стоп — прошлое: исход читается из
 *     `closeReason`, а не из флага (событие и исход не смешиваются).
 *   • stopHit — событие STOP_LOSS ЛИБО статус INVALIDATED. Время — из
 *     события, иначе `closedAt` INVALIDATED-строки.
 *   • currentStop — действующий стоп, ТОЛЬКО когда доказуем: armed-стоп
 *     открытой V3.x-коридорной позиции стоит на цене входа (R3/R4), а вход —
 *     это persisted `fill_price`. Во всех остальных случаях (V2.8 трейлинг,
 *     неизвестная стратегия, нет входа, позиция закрыта) — null: выдуманный
 *     уровень хуже его отсутствия. `currentStopBasis` фиксирует основание.
 *
 * @param {object} row строка signals в форме mapRow (достаточно status,
 *   strategyId, closeReason, fillPrice, closedAt)
 * @param {Array<{eventType: string, occurredAt: Date|string|null}>} events
 *   события журнала ЭТОГО сигнала (порядок не важен — PK гарантирует
 *   единственность типа; посторонние записи игнорируются)
 * @returns {{tp1Hit: boolean, tp1HitAt: string|null, tp2Hit: boolean,
 *   tp2HitAt: string|null, breakevenArmed: boolean, breakevenArmedAt: string|null,
 *   stopHit: boolean, stopHitAt: string|null, currentStop: number|null,
 *   currentStopBasis: 'BE_AT_ENTRY'|null}}
 */
export function projectSignalLifecycleProgress(row, events) {
  const r = row && typeof row === 'object' ? row : {};
  const byType = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const t = e.eventType;
    if (typeof t !== 'string' || t.length === 0 || byType.has(t)) continue;
    byType.set(t, e);
  }
  const at = (eventType) => {
    const e = byType.get(eventType);
    return e ? occurredAtIso(e.occurredAt) : null;
  };

  const status = r.status;
  const closeReason = r.closeReason ?? null;
  const tradeClosed = TRADE_CLOSED_STATUSES.includes(status);

  const tp1Hit = byType.has('TP1')
    || (tradeClosed && TP1_PROVEN_EXIT_REASONS.includes(closeReason));
  const tp2Hit = byType.has('TP2') || status === 'TARGET_REACHED';
  const breakevenArmed = byType.has('BREAKEVEN') && status === 'FILLED';
  const stopHit = byType.has('STOP_LOSS') || status === 'INVALIDATED';

  let currentStop = null;
  let currentStopBasis = null;
  const fillPrice = r.fillPrice;
  if (
    breakevenArmed
    && V3_CORRIDOR_STRATEGY_IDS.includes(r.strategyId)
    && typeof fillPrice === 'number'
    && Number.isFinite(fillPrice)
  ) {
    currentStop = fillPrice;
    currentStopBasis = 'BE_AT_ENTRY';
  }

  return {
    tp1Hit,
    tp1HitAt: at('TP1'),
    tp2Hit,
    tp2HitAt: at('TP2') ?? (status === 'TARGET_REACHED' ? occurredAtIso(r.closedAt) : null),
    breakevenArmed,
    breakevenArmedAt: breakevenArmed ? at('BREAKEVEN') : null,
    stopHit,
    stopHitAt: at('STOP_LOSS') ?? (status === 'INVALIDATED' ? occurredAtIso(r.closedAt) : null),
    currentStop,
    currentStopBasis,
  };
}

/**
 * Какие события несёт переход «было → стало».
 *
 * Чистая функция от двух снапшотов строки `signals` (форма mapRow). Ничего
 * не вычисляет по рыночным данным: только интерпретирует ТО, что уже
 * записано. Порядок событий = порядок нарратива для пользователя:
 * вход → цель → исход.
 *
 * @param {{status?: string, fillPrice?: number|null}|null} previous снапшот ДО перехода
 * @param {object|null} next строка ПОСЛЕ перехода (форма mapRow)
 * @returns {string[]} упорядоченные типы событий (может быть пустым)
 */
export function classifyLifecycleTransition(previous, next) {
  if (!next || typeof next !== 'object') return [];
  const events = [];

  const prevEntered = previous?.status === 'FILLED' || previous?.fillPrice != null;
  const entered = next.fillPrice != null;

  // 1) Вход: факт исполнения появился только что (в т.ч. «прямым» переходом
  //    ACTIVE → терминал, когда сделка завершилась до первой синхронизации).
  if (!prevEntered && entered) events.push('FILL');

  // 2) Терминальный исход — ровно ОДИН финальный класс события,
  //    чтобы CLOSED не превращался в дубль сразу после TP/SL.
  if (CLOSED_SIGNAL_STATUSES.includes(next.status)) {
    if (NO_TRADE_STATUSES.includes(next.status)) {
      // Безсделковый терминал: отмена/истечение до входа (guard БД
      // гарантирует, что у таких строк входа нет — инцидент PEPE 561186ba).
      events.push('CANCELLED');
    } else if (next.status === 'TARGET_REACHED') {
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason)) events.push('TP1');
      events.push('TP2');
    } else if (next.status === 'INVALIDATED') {
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason)) events.push('TP1');
      events.push('STOP_LOSS');
    } else if (BREAKEVEN_EXIT_REASONS.includes(next.closeReason)) {
      if (next.closeReason === 'TP1_THEN_BE') events.push('TP1');
      events.push('BREAKEVEN');
    } else {
      // CLOSED: таймаут / трейлинг / иные закрытия по правилам стратегии.
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason)) events.push('TP1');
      events.push('CLOSED');
    }
  }

  return events;
}

/**
 * Какие ПРОМЕЖУТОЧНЫЕ события несёт прогресс ОТКРЫТОЙ позиции.
 *
 * Чистая функция от `LifecycleResult.progress` (frozen-ядро, §6). Порядок —
 * причинный (TP1 → BREAKEVEN): TP1 бронируется раньше, чем взводится BE
 * (правило R3 V3.x); у V2.8 tp1Booked всегда false, поэтому только BE.
 * Ничего не вычисляется по рыночным данным: интерпретируется ТО, что уже
 * посчитал frozen-степпер.
 *
 * @param {{tp1Booked?: boolean, tp1At?: number|null, beArmed?: boolean, beArmedAt?: number|null}|null} progress
 * @returns {string[]} упорядоченные типы событий ('TP1', 'BREAKEVEN')
 */
export function classifyProgressEvents(progress) {
  if (!progress || typeof progress !== 'object') return [];
  const events = [];
  if (progress.tp1Booked === true) events.push('TP1');
  if (progress.beArmed === true) events.push('BREAKEVEN');
  return events;
}

/**
 * Время факта прогресс-события — closeTime подтверждающего бара из
 * frozen-прогресса (ms), а не «сейчас». Не выдумывается: null = ядро не отдало.
 */
function progressOccurredAt(progress, eventType) {
  if (!progress || typeof progress !== 'object') return null;
  const ms = eventType === 'TP1' ? progress.tp1At : progress.beArmedAt;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

/**
 * Отправляет ПРОМЕЖУТОЧНЫЕ уведомления об ОТКРЫТОЙ позиции: прогресс из
 * FILLED-результата frozen-ядра → события TP1/BREAKEVEN → персистентный
 * дедуп → emit (fire-and-forget).
 *
 * Вызывается на КАЖДОМ тике с открытой позицией (не только при изменении
 * строки: syncSignalLifecycle честно вернёт NO_TRANSITION, когда вход был
 * зафиксирован раньше, а TP1 состоялся только что) — повторы гасятся
 * PK (signal_id, event_type), поэтому лишних сообщений не бывает.
 *
 * Никогда не бросает (как dispatchSignalLifecycleEvents): сбой журнала
 * логируется, наблюдение продолжается.
 *
 * @param {object|null} signal строка ОТКРЫТОГО сигнала (форма mapRow; достаточно id)
 * @param {{tp1Booked?: boolean, tp1At?: number|null, beArmed?: boolean, beArmedAt?: number|null}|null} progress
 * @returns {Promise<string[]> события, которые УШЛИ в отправку (уже записанные — нет)
 */
export async function dispatchSignalProgressEvents(signal, progress = null) {
  if (!signal?.id) return [];
  const events = classifyProgressEvents(progress);
  const dispatched = [];
  for (const eventType of events) {
    try {
      const occurredAt = progressOccurredAt(progress, eventType);
      const { recorded } = await recordSignalLifecycleEvent(signal.id, {
        eventType,
        occurredAt,
      });
      if (recorded) {
        // Время факта (closeTime подтверждающего бара) передаётся в полезной
        // нагрузке уведомления: терминальных полей у открытой строки ещё нет.
        emitSignalNotification(
          { ...signal, progressAt: occurredAt ? occurredAt.toISOString() : null },
          eventType
        );
        dispatched.push(eventType);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        '[signal-lifecycle-events]',
        JSON.stringify({
          signalId: signal.id,
          eventType,
          result: 'failure',
          errorCode: 'EVENT_RECORD_FAILED',
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
  return dispatched;
}

/** Время факта для события — из строки сигнала, не «сейчас». */
function occurredAtFor(signal, eventType) {
  if (!signal || typeof signal !== 'object') return null;
  if (eventType === 'NEW_SIGNAL') return signal.createdAt ?? null;
  if (eventType === 'FILL') return signal.filledAt ?? null;
  return signal.closedAt ?? null;
}

/**
 * Фиксирует событие в журнале. Идемпотентно: повторная запись того же
 * (signal_id, event_type) НЕ вставляется и возвращает recorded=false.
 *
 * @param {string} signalId
 * @param {{eventType: string, occurredAt?: Date|string|null}} input
 * @returns {Promise<{recorded: boolean}>} recorded=true — этот вызов первый
 */
export async function recordSignalLifecycleEvent(signalId, { eventType, occurredAt = null } = {}) {
  if (!isSignalLifecycleEventType(eventType)) {
    throw new Error(`Unknown signal lifecycle event type: ${String(eventType)}`);
  }
  const id = String(signalId ?? '').trim();
  if (!id) return { recorded: false };
  const at = occurredAt instanceof Date ? occurredAt : (occurredAt ?? null);
  const { rows } = await query(
    `INSERT INTO signal_lifecycle_events (signal_id, event_type, occurred_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (signal_id, event_type) DO NOTHING
     RETURNING signal_id, event_type`,
    [id, eventType, at]
  );
  return { recorded: rows.length > 0 };
}

/**
 * Отправляет уведомления о переходе жизненного цикла: классификация →
 * персистентный дедуп → emit (fire-and-forget, как раньше).
 *
 * Никогда не бросает: сбой журнала/отправки логируется и съедается —
 * наблюдение сигналов важнее уведомления о нём.
 *
 * @param {object|null} signal строка ПОСЛЕ перехода (форма mapRow)
 * @param {{status?: string, fillPrice?: number|null}|null} previous снапшот ДО перехода
 * @returns {Promise<string[]> события, которые УШЛИ в отправку (уже записанные — нет)
 */
export async function dispatchSignalLifecycleEvents(signal, previous = null) {
  if (!signal?.id) return [];
  const events = classifyLifecycleTransition(previous, signal);
  const dispatched = [];
  for (const eventType of events) {
    try {
      const { recorded } = await recordSignalLifecycleEvent(signal.id, {
        eventType,
        occurredAt: occurredAtFor(signal, eventType),
      });
      if (recorded) {
        emitSignalNotification(signal, eventType);
        dispatched.push(eventType);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        '[signal-lifecycle-events]',
        JSON.stringify({
          signalId: signal.id,
          eventType,
          result: 'failure',
          errorCode: 'EVENT_RECORD_FAILED',
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
  return dispatched;
}

/**
 * Уведомление о новом сигнале. Первичная дедупликация — UNIQUE-ключ вставки
 * самой строки (`insertSignal` возвращает inserted=true один раз); журнал
 * событий дублирует защиту и даёт единый аудит всех отправленных событий.
 *
 * @param {object|null} signal вставленная строка (форма mapRow)
 * @returns {Promise<{recorded: boolean}>}
 */
export async function dispatchNewSignalEvent(signal) {
  if (!signal?.id) return { recorded: false };
  try {
    const { recorded } = await recordSignalLifecycleEvent(signal.id, {
      eventType: 'NEW_SIGNAL',
      occurredAt: occurredAtFor(signal, 'NEW_SIGNAL'),
    });
    if (recorded) emitSignalNotification(signal, 'NEW_SIGNAL');
    return { recorded };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      '[signal-lifecycle-events]',
      JSON.stringify({
        signalId: signal.id,
        eventType: 'NEW_SIGNAL',
        result: 'failure',
        errorCode: 'EVENT_RECORD_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
    );
    return { recorded: false };
  }
}
