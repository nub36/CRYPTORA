/**
 * serverSignalNotifications — ПРОДАКШН-лента колокольчика: только серверные сигналы.
 *
 * Источник истины продакшна — PostgreSQL через `GET /api/signals`
 * (`SignalDto`). Колокольчик обязан показывать те же сигналы, что и `/signals`,
 * с той же идентичностью: `id` строки `signals`, символ, стратегия, направление,
 * время бара сетапа, вход/стоп/цели и статус — как их отдал сервер.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ МОДУЛЬ. Раньше события колокольчика производил
 * браузерный `SignalsAuditLedger` (`signalNotifications.ts`). Журнал браузера —
 * ЛОКАЛЬНЫЙ: он не пишет в PostgreSQL и не подтверждён сервером, поэтому его
 * события не являются продакшн-сигналами. Инцидент 2026-09-25 с RUNE показал,
 * как это выглядит для владельца: колокольчик «звонил» по сетапу, которого в
 * серверной БД нет (`GET /api/signals?symbol=RUNE%2FUSDT` → `count = 0`).
 * Разделение теперь жёсткое:
 *
 *   • `serverSignalNotifications` (этот файл) — ПРОДАКШН-лента колокольчика;
 *   • `localSignalNotifications` (`signalNotifications.ts`) — локальный аудит
 *     браузера для отладки; продакшн-уведомлений не создаёт.
 *
 * ЧТО ГАРАНТИРУЕТ МОДУЛЬ:
 *  1. ПРОИСХОЖДЕНИЕ (provenance). В продакшн-ленту попадают ТОЛЬКО строки
 *     `provenanceStatus === 'VERIFIED'` (карантин миграции 011: запись согласна
 *     с генератором — см. `docs/incidents/2026-09-24-signal-provenance.md`).
 *     `MISMATCH` и `UNKNOWN` не показываются как продакшн-сигналы: первые
 *     доказанно перемаркированы, вторые — fail-closed без доказательства.
 *     Исключённые считаются и доступны аудиту (`getAudit()`), чтобы «пустой
 *     колокольчик» не выглядел как «сигналов нет».
 *  2. ИДЕНТИЧНОСТЬ. У уведомления есть серверный `signalId`; ссылка ведёт на
 *     `/signals?symbol=<BASE>&signal=<signalId>`, а не «в журнал вообще».
 *  3. ТОЛЬКО НОВЫЕ СОБЫТИЯ. Первая синхронизация НЕ порождает событий по уже
 *     существующим сигналам (иначе после каждого F5 колокольчик «звонил» бы по
 *     всей ленте). Дальше сравниваются статусы: ACTIVE→FILLED даёт «ВХОД
 *     ИСПОЛНЕН», переход в терминальное состояние — «ИСХОД».
 *  4. ЧЕСТНЫЙ `at`. Время берётся из DTO (`createdAt` / `filledAt` / `closedAt`),
 *     а не «сейчас».
 *  5. ИДЕМПОТЕНТНОСТЬ. Ключ уведомления — `srv-<signalId>-<KIND>`; повторная
 *     синхронизация не создаёт дублей.
 *
 * Модуль НЕ считает уровни, НЕ выдумывает сигналы и НЕ создаёт их на клиенте:
 * он только отображает то, что уже записано сервером.
 */

import type { SignalDto, SignalStatus } from '@/services/strategyOps';
import {
  describeServerSignalOutcome,
  directionText,
  entryZoneText,
  formatSignalPrice,
  strategyText,
} from '@/utils/serverSignalText';
import {
  SERVER_NOTIFICATIONS_SCHEMA_VERSION,
  SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY,
  browserNotificationStorage,
  quarantineLegacySignalNotifications,
  readNotificationEnvelope,
  writeNotificationEnvelope,
  type NotificationStorageLike,
} from './signalNotificationStorage';

export type ServerNotificationKind = 'NEW_SIGNAL' | 'FILL' | 'OUTCOME';

/** Домен `signals.provenance_status` (миграция 011). */
export type SignalProvenanceStatus = 'VERIFIED' | 'MISMATCH' | 'UNKNOWN';

/**
 * Строка серверной ленты, допущенная в продакшн-колокольчик.
 *
 * Поля уровней/времени дублируют DTO НАМЕРЕННО: это неизменяемый снимок того,
 * что именно объявил колокольчик. Тест «страница и колокольчик — один и тот же
 * сигнал» сравнивает эти поля с `SignalDto` по одному полю.
 */
export interface ServerSignalNotification {
  /** `srv-<signalId>-<KIND>` — детерминированный ключ (никакого Math.random). */
  id: string;
  kind: ServerNotificationKind;
  /** `signals.id` в PostgreSQL — идентичность уведомления и deep-link. */
  signalId: string;
  /** Пара как в БД: «RUNE/USDT». */
  symbol: string;
  /** «RUNE» — для маршрута `/signals?symbol=`. */
  baseSymbol: string;
  strategyId: string;
  strategyVersion: string | null;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  status: SignalStatus;
  /** Всегда `VERIFIED`: иные статусы в продакшн-ленту не попадают. */
  provenance: 'VERIFIED';
  signalCandleTs: string;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  targets: number[] | null;
  title: string;
  detail: string;
  /** ISO-время события ИЗ СЕРВЕРНОГО DTO. */
  at: string;
  read: boolean;
  /** `/signals?symbol=RUNE&signal=<signalId>`. */
  href: string;
  source: 'server';
}

export interface ServerNotificationAudit {
  /** Unix ms последней синхронизации с серверной лентой. */
  lastSyncAt: number | null;
  /** Сколько строк пришло в последней синхронизации. */
  considered: number;
  /** Сколько из них допущено политикой (VERIFIED). */
  eligible: number;
  /** Сколько исключено как MISMATCH / UNKNOWN. */
  excludedMismatch: number;
  excludedUnknown: number;
  /** Последняя ошибка источника серверной ленты (или null). */
  lastError: string | null;
  /** Сколько легаси-записей v1 перенесено в карантин при старте. */
  quarantinedLegacy: number;
}

/** Снапшот статусов между синхронизациями (часть конверта v2). */
export type ServerSignalSeenMap = Record<string, { status: string; provenance: string }>;

const MAX_ITEMS = 50;
/** Граница снапшота статусов: лента не растёт бесконечно вместе с историей. */
export const MAX_SEEN_ENTRIES = 500;

type Listener = () => void;

function emptyAudit(): ServerNotificationAudit {
  return {
    lastSyncAt: null,
    considered: 0,
    eligible: 0,
    excludedMismatch: 0,
    excludedUnknown: 0,
    lastError: null,
    quarantinedLegacy: 0,
  };
}

/**
 * Изменилось ли в аудите то, что ВИДИТ интерфейс.
 *
 * `lastSyncAt` меняется на каждом цикле опроса, но сам по себе не повод
 * перерисовывать страницу: опрос раз в минуту не должен обновлять состояние
 * React «просто так». Числа строк и ошибка источника — повод.
 */
function auditVisibleChange(prev: ServerNotificationAudit, next: ServerNotificationAudit): boolean {
  return (
    prev.considered !== next.considered ||
    prev.eligible !== next.eligible ||
    prev.excludedMismatch !== next.excludedMismatch ||
    prev.excludedUnknown !== next.excludedUnknown ||
    prev.quarantinedLegacy !== next.quarantinedLegacy ||
    prev.lastError !== next.lastError
  );
}

/**
 * Политика допуска серверных сигналов в продакшн-колокольчик.
 *
 * Fail-closed: допускается ТОЛЬКО `VERIFIED`. Отсутствующий статус (например,
 * строка, прочитанная без колонки карантина) читается как `UNKNOWN` — никогда
 * не повышается до `VERIFIED` автоматически (то же правило, что в
 * `server/services/signalProvenance.js`).
 */
export function provenanceOfSignal(
  dto: Pick<SignalDto, 'provenanceStatus'> | null | undefined
): SignalProvenanceStatus {
  const raw = dto?.provenanceStatus;
  if (raw === 'VERIFIED' || raw === 'MISMATCH' || raw === 'UNKNOWN') return raw;
  return 'UNKNOWN';
}

export function isProductionPolicySignal(dto: Pick<SignalDto, 'provenanceStatus'>): boolean {
  return provenanceOfSignal(dto) === 'VERIFIED';
}

export interface ProvenancePartition {
  eligible: SignalDto[];
  excludedMismatch: number;
  excludedUnknown: number;
}

/** Разделение ленты по политике происхождения — чистая функция (тестируется). */
export function partitionByProvenance(signals: readonly SignalDto[]): ProvenancePartition {
  const eligible: SignalDto[] = [];
  let excludedMismatch = 0;
  let excludedUnknown = 0;
  for (const s of signals) {
    const p = provenanceOfSignal(s);
    if (p === 'VERIFIED') eligible.push(s);
    else if (p === 'MISMATCH') excludedMismatch += 1;
    else excludedUnknown += 1;
  }
  return { eligible, excludedMismatch, excludedUnknown };
}

/** «RUNE/USDT» → «RUNE» (без реестра: только разбор строки сервера). */
export function signalBase(symbol: string): string {
  const raw = (symbol ?? '').trim().toUpperCase();
  if (!raw) return '';
  const base = raw.includes('/') ? raw.split('/')[0] : raw;
  return (base ?? '').replace(/(USDT|USDC|BUSD|PERP)$/, '') || base;
}

/** Ссылка «открыть сигнал»: символ + серверный id (страница инициализируется из URL). */
export function serverSignalHref(symbol: string, signalId: string): string {
  const base = signalBase(symbol);
  const params = new URLSearchParams();
  if (base) params.set('symbol', base);
  if (signalId) params.set('signal', signalId);
  const qs = params.toString();
  return qs ? `/signals?${qs}` : '/signals';
}

/**
 * Терминальные состояния серверного домена (`SignalStatus`).
 *
 * `CLOSED_STATUSES` браузерного журнала сюда НЕ подмешивается: это другой
 * домен. Продакшн-лента читает только серверные статусы, и неизвестное
 * значение не считается закрытием (fail-closed: нет события — нет уведомления).
 */
export const SERVER_CLOSED_STATUSES: readonly SignalStatus[] = [
  'TARGET_REACHED',
  'INVALIDATED',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'UNRESOLVED',
];

function isClosedStatus(status: string): boolean {
  return (SERVER_CLOSED_STATUSES as readonly string[]).includes(status);
}

function kindTitle(kind: ServerNotificationKind): string {
  switch (kind) {
    case 'NEW_SIGNAL': return 'НОВЫЙ СИГНАЛ';
    case 'FILL': return 'ВХОД ИСПОЛНЕН';
    case 'OUTCOME': return 'ИСХОД';
  }
}

/**
 * Время события — из DTO. Для нового сигнала это `createdAt` (момент публикации
 * сервером), для входа — `filledAt`, для исхода — `closedAt`. Поля сервера
 * имеют приоритет; `createdAt` — только запасной вариант для входа/исхода,
 * которые сервер обязан заполнять вместе со статусом.
 */
export function notificationTime(signal: SignalDto, kind: ServerNotificationKind): string {
  if (kind === 'FILL') return signal.filledAt ?? signal.createdAt;
  if (kind === 'OUTCOME') return signal.closedAt ?? signal.updatedAt ?? signal.createdAt;
  return signal.createdAt;
}

/** DTO + вид события → элемент продакшн-ленты. Уровни копируются как есть. */
export function buildServerNotification(
  signal: SignalDto,
  kind: ServerNotificationKind
): ServerSignalNotification {
  const base = signalBase(signal.symbol);
  const dir = directionText(signal.direction);
  const strategy = strategyText(signal.strategyId, signal.strategyVersion);
  const title = kindTitle(kind);
  let detail: string;
  if (kind === 'NEW_SIGNAL') {
    detail =
      `${signal.symbol} · ${dir} · ${strategy} · вход ` +
      `${entryZoneText(signal.entryMin, signal.entryMax, signal.entryType)} · ` +
      `стоп ${formatSignalPrice(signal.stopLoss)}`;
  } else if (kind === 'FILL') {
    detail = `${signal.symbol} · вход по ${formatSignalPrice(signal.fillPrice)} · ${strategy}`;
  } else {
    detail = `${signal.symbol} · ${describeServerSignalOutcome(signal)}`;
  }

  return {
    id: `srv-${signal.id}-${kind}`,
    kind,
    signalId: signal.id,
    symbol: signal.symbol,
    baseSymbol: base,
    strategyId: signal.strategyId,
    strategyVersion: signal.strategyVersion,
    direction: signal.direction,
    timeframe: signal.timeframe,
    status: signal.status,
    provenance: 'VERIFIED',
    signalCandleTs: signal.signalCandleTs,
    entryMin: signal.entryMin,
    entryMax: signal.entryMax,
    stopLoss: signal.stopLoss,
    targets: signal.targets ? [...signal.targets] : null,
    title,
    detail,
    at: notificationTime(signal, kind),
    read: false,
    href: serverSignalHref(signal.symbol, signal.id),
    source: 'server',
  };
}

/**
 * Дифф снапшота статусов: какие события породить. Чистая функция.
 *
 * `prev` — статусы, УЖЕ известные ленте (включая восстановленные из storage).
 * Отсутствие id в `prev` означает новую для наблюдателя строку:
 *   • ACTIVE   → НОВЫЙ СИГНАЛ (сетап опубликован и ждёт входа);
 *   • FILLED   → ВХОД ИСПОЛНЕН;
 *   • закрытый → ИСХОД.
 *
 * Строки вне продакшн-политики (`MISMATCH`/`UNKNOWN`) пропускаются молча —
 * решение о допуске принимается ЗДЕСЬ, а не в UI.
 */
export function diffServerSignalsForNotifications(
  prev: ReadonlyMap<string, string>,
  signals: readonly SignalDto[]
): ServerSignalNotification[] {
  const out: ServerSignalNotification[] = [];
  for (const s of signals) {
    if (!isProductionPolicySignal(s)) continue;
    const was = prev.get(s.id);
    if (was === undefined) {
      if (s.status === 'ACTIVE') out.push(buildServerNotification(s, 'NEW_SIGNAL'));
      else if (s.status === 'FILLED') out.push(buildServerNotification(s, 'FILL'));
      else if (isClosedStatus(s.status)) out.push(buildServerNotification(s, 'OUTCOME'));
      continue;
    }
    if (was === s.status) continue;
    if (was === 'ACTIVE' && s.status === 'FILLED') {
      out.push(buildServerNotification(s, 'FILL'));
    } else if (!isClosedStatus(was) && isClosedStatus(s.status)) {
      out.push(buildServerNotification(s, 'OUTCOME'));
    }
  }
  return out;
}

/**
 * Снапшот статусов из DTO — по ВСЕМ строкам ленты, включая карантинные.
 *
 * Все строки важны: если `MISMATCH` позже станет `VERIFIED` (операция
 * классификации), это НЕ повод объявлять старый сетап новым сигналом — строка
 * уже была известна ленте. Допуск к уведомлению решает дифф, а не снапшот.
 */
export function seenMapOf(signals: readonly SignalDto[]): ServerSignalSeenMap {
  const seen: ServerSignalSeenMap = {};
  for (const s of signals) {
    seen[s.id] = { status: s.status, provenance: provenanceOfSignal(s) };
  }
  return seen;
}

/**
 * Слияние снапшота с новой страницей ленты: старые записи сохраняются
 * (сигнал, ушедший на вторую страницу, не должен «позвонить» при возврате),
 * размер ограничен `MAX_SEEN_ENTRIES`.
 */
export function mergeSeenMap(
  previous: ServerSignalSeenMap,
  signals: readonly SignalDto[],
  maxEntries: number = MAX_SEEN_ENTRIES
): ServerSignalSeenMap {
  const merged: ServerSignalSeenMap = { ...previous, ...seenMapOf(signals) };
  const entries = Object.entries(merged);
  if (entries.length <= maxEntries) return merged;
  // Отбрасываем самые ранние записи по порядку вставки (JS сохраняет порядок
  // строковых ключей как порядок добавления для неиндексных ключей UUID).
  const trimmed = entries.slice(entries.length - maxEntries);
  return Object.fromEntries(trimmed);
}

function statusesOfSeen(seen: ServerSignalSeenMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, value] of Object.entries(seen)) {
    if (value && typeof value.status === 'string') map.set(id, value.status);
  }
  return map;
}

/**
 * Продакшн-лента колокольчика. Синглтон, но с явной инъекцией хранилища —
 * состояние не «прячется» в модуле-статике, а тестируется на фейковом storage.
 */
export class ServerSignalNotificationCenter {
  private items: ServerSignalNotification[] = [];
  private seen: ServerSignalSeenMap = {};
  /** Есть ли снапшот серверных статусов (без него первый ingest только сеет базу). */
  private baselineReady = false;
  private listeners = new Set<Listener>();
  private audit: ServerNotificationAudit = emptyAudit();
  private storage: NotificationStorageLike | null = null;
  private started = false;

  constructor(private readonly storageKey: string = SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY) {}

  /**
   * Старт: карантин легаси v1 → чтение конверта v2 → снапшот статусов.
   * Идемпотентен; `storage = null` означает «только память» (SSR, приватный
   * режим) — лента продолжает работать, просто не переживает перезагрузку.
   */
  public start(storage: NotificationStorageLike | null = browserNotificationStorage()): void {
    // Идемпотентность: повторный mount потребителя (переход по страницам,
    // подписка второго компонента) НЕ перечитывает storage. Иначе сохранённый
    // кадр перезаписал бы уже накопленное в памяти состояние и «звонок» по
    // переходу статуса, увиденному в этой сессии, мог бы повториться.
    if (this.started) return;
    this.storage = storage;
    this.started = true;

    if (!storage) return;

    const quarantine = quarantineLegacySignalNotifications(storage);
    this.audit.quarantinedLegacy = quarantine.quarantined;

    const read = readNotificationEnvelope<ServerSignalNotification, ServerSignalSeenMap>(
      storage,
      this.storageKey,
      { schemaVersion: SERVER_NOTIFICATIONS_SCHEMA_VERSION, source: 'server' }
    );
    if (read.status === 'ok') {
      this.items = read.items.slice(-MAX_ITEMS);
      this.seen = read.seen ?? {};
      this.baselineReady = Object.keys(this.seen).length > 0;
    } else {
      this.items = [];
      this.seen = {};
      this.baselineReady = false;
    }
  }

  public stop(): void {
    this.started = false;
  }

  /**
   * Синхронизация с серверной лентой.
   *
   * @param signals строки `GET /api/signals` (как их отдал сервер);
   * @param opts.initial true — первая синхронизация сессии: события НЕ
   *   порождаются, только фиксируется база (иначе после F5 колокольчик «звонил»
   *   бы по всем уже существующим сигналам).
   */
  public ingest(
    signals: readonly SignalDto[],
    opts: { initial?: boolean } = {}
  ): ServerSignalNotification[] {
    if (!Array.isArray(signals)) return [];

    const partition = partitionByProvenance(signals);
    const previousAudit = this.audit;
    this.audit = {
      ...previousAudit,
      lastSyncAt: Date.now(),
      considered: signals.length,
      eligible: partition.eligible.length,
      excludedMismatch: partition.excludedMismatch,
      excludedUnknown: partition.excludedUnknown,
      lastError: null,
    };
    const auditChanged = auditVisibleChange(previousAudit, this.audit);

    // Защита от попадания записей браузерного журнала: серверный DTO всегда
    // имеет id строки БД и symbol; локальные сетапы помечены `source`.
    const eligible = partition.eligible.filter((s) => {
      const source = (s as unknown as { source?: string }).source;
      return source !== 'local-ledger' && typeof s?.id === 'string' && s.id.length > 0;
    });

    // Порядок важен: дифф считается по СТАРОМУ снапшоту, затем снапшот
    // дополняется текущей страницей.
    const previous = statusesOfSeen(this.seen);
    const seeding = opts.initial === true || !this.baselineReady;
    this.seen = mergeSeenMap(this.seen, signals);
    this.baselineReady = true;

    const fresh = seeding ? [] : diffServerSignalsForNotifications(previous, eligible);

    const known = new Set(this.items.map((n) => n.id));
    let itemsChanged = false;
    for (const n of fresh) {
      if (!known.has(n.id)) {
        known.add(n.id);
        this.items.push(n);
        itemsChanged = true;
      }
    }
    if (itemsChanged) this.items = this.items.slice(-MAX_ITEMS);
    this.persist();

    // Перерисовка только при видимом изменении: новый сигнал или изменение
    // чисел/ошибки в аудите. Пустая синхронизация без изменений молчит.
    if (itemsChanged || auditChanged) this.emit();
    return fresh;
  }

  /** Ошибка источника ленты — честное состояние; уже показанные уведомления не трогаем. */
  public noteSourceError(message: string): void {
    const previous = this.audit;
    this.audit = { ...previous, lastError: message, lastSyncAt: Date.now() };
    if (auditVisibleChange(previous, this.audit)) this.emit();
  }

  public getNotifications(): ServerSignalNotification[] {
    return [...this.items];
  }

  public getUnreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  public getAudit(): ServerNotificationAudit {
    return { ...this.audit };
  }

  public isBaselineReady(): boolean {
    return this.baselineReady;
  }

  public isStarted(): boolean {
    return this.started;
  }

  public markAllRead(): void {
    if (this.items.every((n) => n.read)) return;
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.persist();
    this.emit();
  }

  /**
   * Очистка ленты. Снапшот статусов (`seen`) НЕ сбрасывается: иначе следующая же
   * синхронизация объявила бы существующие сигналы новыми.
   */
  public clear(): void {
    this.items = [];
    this.persist();
    this.emit();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Только для тестов: полный сброс синглтона, хранилища и аудита. */
  public resetForTests(): void {
    this.stop();
    this.items = [];
    this.seen = {};
    this.baselineReady = false;
    this.audit = emptyAudit();
    this.storage = null;
  }

  private persist(): void {
    if (!this.storage) return;
    writeNotificationEnvelope<ServerSignalNotification, ServerSignalSeenMap>(this.storage, this.storageKey, {
      schemaVersion: SERVER_NOTIFICATIONS_SCHEMA_VERSION,
      source: 'server',
      items: this.items.slice(-MAX_ITEMS),
      seen: this.seen,
    });
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* слушатель не должен ломать центр */
      }
    }
  }
}

export const serverSignalNotifications = new ServerSignalNotificationCenter();
