/**
 * signalNotificationStorage — версионированное хранилище ленты колокольчика.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. До этого прохода в браузере лежала ОДНА лента
 * (`cryptora_signal_notifications_v1`), которую наполнял браузерный журнал
 * `SignalsAuditLedger`. После перехода колокольчика на серверную ленту старые
 * локальные записи нельзя показывать как серверные факты: у них нет серверного
 * `signal_id`, и они не подтверждены PostgreSQL. Поэтому вводится ЯВНАЯ схема с
 * версией и источником:
 *
 *   • `cryptora_signal_notifications_v2`        — лента колокольчика (server);
 *   • `cryptora_signal_notifications_local_v1`  — локальный аудит браузера;
 *   • `cryptora_signal_notifications_v1`        — ЛЕГАСИ-ключ (только чтение,
 *     подлежит карантину);
 *   • `cryptora_signal_notifications_v1_legacy_quarantine` — куда легаси-записи
 *     переносятся целиком.
 *
 * МИГРАЦИЯ НЕ УДАЛЯЕТ ДАННЫЕ. Легаси-элементы переносятся в карантинный ключ в
 * неизменном виде (для явного локального аудита/отладки) и больше НЕ читаются
 * ни одной лентой продукта. Так «старое локальное событие» не может выглядеть
 * как серверное уведомление, а журнал остаётся восстановимым.
 *
 * Модуль не знает про React и про бизнес-правила: только форма конверта и
 * безопасное чтение/запись. Работает с любым объектом `NotificationStorageLike`
 * (в тестах — фейковое хранилище, в браузере — `localStorage`).
 */

/** Минимальный контракт хранилища (`localStorage` подходит как есть). */
export interface NotificationStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** ЛЕГАСИ-ключ ленты (v1): наполнялся браузерным журналом, не сервером. */
export const LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY = 'cryptora_signal_notifications_v1';
/** Текущая лента колокольчика: только серверные уведомления. */
export const SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY = 'cryptora_signal_notifications_v2';
/** Отдельная лента локального аудита браузера (не продуктовая). */
export const LOCAL_SIGNAL_NOTIFICATIONS_STORAGE_KEY = 'cryptora_signal_notifications_local_v1';
/** Карантин легаси-записей: сохранены, но продуктом не читаются. */
export const LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY =
  'cryptora_signal_notifications_v1_legacy_quarantine';

export const SERVER_NOTIFICATIONS_SCHEMA_VERSION = 2;
export const LOCAL_NOTIFICATIONS_SCHEMA_VERSION = 1;
export const LEGACY_QUARANTINE_SCHEMA_VERSION = 0;

/** Источник ленты. `server` — PostgreSQL через `GET /api/signals`; `local-ledger` — журнал браузера. */
export type NotificationSource = 'server' | 'local-ledger' | 'local-ledger-legacy';

/**
 * Форма хранения ленты. `seen` — снапшот статусов на момент последней
 * синхронизации: без него перезагрузка страницы «забывала» бы, что уже
 * показано, и переход ACTIVE→FILLED, случившийся пока вкладка была закрыта,
 * терялся бы. Снапшот — часть СЕРВЕРНОЙ ленты; локальная лента его не ведёт.
 */
export interface NotificationEnvelope<TItem, TSeen = Record<string, unknown>> {
  schemaVersion: number;
  source: NotificationSource;
  savedAt: string;
  items: TItem[];
  seen?: TSeen;
  /** Человеческая причина переноса — только у карантинного конверта. */
  reason?: string;
}

/** То, что разрешено передать на запись: `savedAt` подставляется, если не задан. */
export type NotificationEnvelopeWrite<TItem, TSeen = Record<string, unknown>> = Omit<
  NotificationEnvelope<TItem, TSeen>,
  'savedAt'
> & { savedAt?: string };

/** Результат чтения: причина видна явно, «пусто» и «нечитаемо» не смешиваются. */
export type EnvelopeReadStatus = 'ok' | 'missing' | 'invalid' | 'version-mismatch' | 'source-mismatch';

export interface EnvelopeReadResult<TItem, TSeen> {
  status: EnvelopeReadStatus;
  items: TItem[];
  seen: TSeen | null;
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Читает конверт строго по версии и источнику.
 *
 * Несовпадение версии/источника НЕ приводит к «умному» разбору: лента честно
 * считается нечитаемой (`version-mismatch` / `source-mismatch`), потому что
 * восстановление чужой формы — это и есть путь к тому, чтобы показать
 * локальные записи как серверные.
 */
export function readNotificationEnvelope<TItem, TSeen = Record<string, unknown>>(
  storage: NotificationStorageLike,
  key: string,
  expected: { schemaVersion: number; source: NotificationSource }
): EnvelopeReadResult<TItem, TSeen> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: 'invalid', items: [], seen: null };
  }
  if (!raw) return { status: 'missing', items: [], seen: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid', items: [], seen: null };
  }
  if (!isEnvelope(parsed)) return { status: 'invalid', items: [], seen: null };
  if (parsed.schemaVersion !== expected.schemaVersion) {
    return { status: 'version-mismatch', items: [], seen: null };
  }
  if (parsed.source !== expected.source) {
    return { status: 'source-mismatch', items: [], seen: null };
  }
  const items = Array.isArray(parsed.items) ? (parsed.items as TItem[]) : [];
  const seen = isEnvelope(parsed.seen) ? (parsed.seen as TSeen) : null;
  return { status: 'ok', items, seen };
}

/** Запись конверта. Ошибка хранилища не роняет ленту: она живёт в памяти. */
export function writeNotificationEnvelope<TItem, TSeen>(
  storage: NotificationStorageLike,
  key: string,
  envelope: NotificationEnvelopeWrite<TItem, TSeen>
): boolean {
  try {
    const payload: NotificationEnvelope<TItem, TSeen> = {
      ...envelope,
      savedAt: envelope.savedAt ?? new Date().toISOString(),
    };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export interface LegacyQuarantineResult {
  /** Сколько легаси-записей перенесено (0 — если ключа не было). */
  quarantined: number;
  /** Карантин уже существовал до этого вызова (повторный запуск идемпотентен). */
  alreadyQuarantined: boolean;
}

/**
 * Карантин ЛЕГАСИ-ленты `cryptora_signal_notifications_v1`.
 *
 * Идемпотентна и без потерь: элементы переносятся в отдельный ключ с явной
 * пометкой источника и причины, после чего легаси-ключ очищается. Повторный
 * вызов ничего не меняет. Если карантин уже существует, а легаси-ключ снова
 * появился (старая версия приложения в другой вкладке), записи ДОБАВЛЯЮТСЯ к
 * карантину, а не затирают его.
 */
export function quarantineLegacySignalNotifications(
  storage: NotificationStorageLike
): LegacyQuarantineResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY);
  } catch {
    return { quarantined: 0, alreadyQuarantined: false };
  }
  if (!raw) return { quarantined: 0, alreadyQuarantined: false };

  let legacyItems: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) legacyItems = parsed;
    else if (isEnvelope(parsed) && Array.isArray(parsed.items)) legacyItems = parsed.items;
  } catch {
    legacyItems = [];
  }

  const existing = readNotificationEnvelope<unknown>(
    storage,
    LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY,
    { schemaVersion: LEGACY_QUARANTINE_SCHEMA_VERSION, source: 'local-ledger-legacy' }
  );
  const alreadyQuarantined = existing.status === 'ok';
  const merged = alreadyQuarantined ? [...existing.items, ...legacyItems] : legacyItems;

  writeNotificationEnvelope(storage, LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY, {
    schemaVersion: LEGACY_QUARANTINE_SCHEMA_VERSION,
    source: 'local-ledger-legacy',
    reason:
      'Записи легаси-ленты v1 (браузерный SignalsAuditLedger). Перенесены 2026-09 при переводе ' +
      'колокольчика на серверную ленту: у них нет серверного signal_id, они не подтверждены PostgreSQL ' +
      'и не показываются как серверные уведомления. Сохранены для локального аудита/отладки.',
    items: merged,
  });

  try {
    storage.removeItem(LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY);
  } catch {
    /* хранилище недоступно на запись — карантин всё равно уже записан */
  }

  return { quarantined: legacyItems.length, alreadyQuarantined };
}

/** `localStorage` браузера или `null` (SSR/тесты/приватный режим). */
export function browserNotificationStorage(): NotificationStorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
