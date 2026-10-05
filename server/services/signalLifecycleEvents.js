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
 * ГРАНИЦА НАБЛЮДАЕМОСТИ (честное ограничение модели). Frozen-ядро
 * (`trackPublishedSetup`) отдаёт только УЖЕ СОСТОЯВШИЕСЯ факты: fill и
 * терминальный исход. Промежуточный прогресс открытой позиции (момент
 * касания TP1, перевод стопа в BE «на баре») ядро не отдаёт и в БД не
 * пишет — поэтому события TP1/BREAKEVEN фиксируются ТОГДА, когда исход
 * сделки их ДОКАЗЫВАЕТ по правилам frozen-ядра:
 *
 *   • TP1 доказан  ⇔ exitReason ∈ {TP2, TP1_THEN_BE, TP1_THEN_SL,
 *                    TP1_THEN_TIMEOUT} — правило R2 V3.x («TP1 books before
 *                    TP2», включая ветку одновременного касания) и сами
 *                    причины вида «TP1_THEN_*»;
 *   • BREAKEVEN    ⇔ сделка реально ЗАКРЫТА по безубытку: exitReason
 *                    TP1_THEN_BE (V3.x: BE взводится баром позже TP1,
 *                    правило R3) или BE (V2.8 trail: стоп = цена входа);
 *   • TP2          ⇔ статус TARGET_REACHED (managedStatus('TP2'));
 *   • TP3+         — frozen-ведение целей за пределами TP2 не отслеживает
 *                    (docs/SIGNALS.md §3.1), поэтому такие события не
 *                    создаются искусственно; домен таблицы допускает TPn
 *                    на случай будущей реальной поддержки стратегией.
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
import { CLOSED_SIGNAL_STATUSES, NO_TRADE_STATUSES } from './signalRepository.js';
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
