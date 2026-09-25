/**
 * signalNotifications — ЛОКАЛЬНЫЙ АУДИТ браузерного журнала (`SignalsAuditLedger`).
 *
 * ⚠️ ЭТО НЕ ПРОДАКШН-КОЛОКОЛЬЧИК. Инцидент 2026-09-25 (RUNE): продакшн-колокольчик
 * получал события отсюда, то есть из журнала ОДНОГО браузера, который не пишет в
 * PostgreSQL. Владелец видел «НОВЫЙ СИГНАЛ RUNE» при `GET /api/signals?symbol=RUNE%2FUSDT`
 * → `signals = [], count = 0, total = 0`: в серверной БД сигнала не было.
 *
 * Поэтому роли разделены жёстко:
 *   • продакшн-лента колокольчика — `serverSignalNotifications.ts`
 *     (источник `GET /api/signals`, только VERIFIED, идентичность = `signals.id`);
 *   • этот модуль — локальный аудит/отладка браузера. Он продолжает читать и
 *     диффать браузерный журнал, но создаёт события ТОЛЬКО с пометкой
 *     `source: 'local-ledger'`, лежит в ОТДЕЛЬНОМ ключе хранилища и никогда не
 *     попадает в продакшн-ленту.
 *
 * Хранение легаси-ключей. До этого прохода модуль писал в
 * `cryptora_signal_notifications_v1` — тот же ключ, из которого колокольчик читал
 * события. Легаси-записи переносятся в карантин
 * (`signalNotificationStorage.quarantineLegacySignalNotifications`) и больше не
 * читаются ни одной лентой продукта: у них нет серверного `signal_id`, и
 * показывать их как серверные факты запрещено.
 *
 * Дифф и тексты — прежние (журнал не менялся): новая запись → НОВЫЙ СИГНАЛ,
 * ACTIVE→FILLED → ВХОД ИСПОЛНЕН, закрытие → ИСХОД. Числа берутся из журнала как
 * есть, время — из журнала, а не «сейчас».
 */

import {
  SignalsAuditLedger,
  CLOSED_STATUSES,
  type AnalyticalSetup,
} from '@/services/signals/SignalsAuditLedger';
import {
  describeSetupOutcome,
  strategyShortLabel,
} from '@/utils/signalText';
import { sideLabel } from '@/utils/labels';
import { formatCurrency } from '@/utils/formatters';
import {
  LOCAL_NOTIFICATIONS_SCHEMA_VERSION,
  LOCAL_SIGNAL_NOTIFICATIONS_STORAGE_KEY,
  browserNotificationStorage,
  readNotificationEnvelope,
  writeNotificationEnvelope,
  type NotificationStorageLike,
} from './signalNotificationStorage';

export type SignalNotificationKind = 'NEW_SIGNAL' | 'FILL' | 'OUTCOME';

/** Событие локального аудита браузера. Продакшн-фактом не является. */
export interface SignalNotification {
  /** Детерминированный id: `local-<setupId>-<KIND>` (никакого Math.random). */
  id: string;
  kind: SignalNotificationKind;
  /** Идентификатор сетапа В ЖУРНАЛЕ БРАУЗЕРА (не `signals.id` в PostgreSQL). */
  setupId: string;
  symbol: string;
  title: string;
  detail: string;
  /** ISO-время события из журнала. */
  at: string;
  read: boolean;
  /** Всегда `local-ledger`: лента явно помечена как локальная. */
  source: 'local-ledger';
}

const MAX_ITEMS = 50;

type Listener = () => void;

function fmtPriceShort(p: number): string {
  return formatCurrency(p, { decimals: Math.abs(p) > 10 ? 2 : 4 });
}

function kindTitle(kind: SignalNotificationKind): string {
  switch (kind) {
    case 'NEW_SIGNAL': return 'НОВЫЙ СИГНАЛ';
    case 'FILL': return 'ВХОД ИСПОЛНЕН';
    case 'OUTCOME': return 'ИСХОД';
  }
}

function newSignalNotification(s: AnalyticalSetup): SignalNotification {
  const dir = sideLabel(s.direction).toUpperCase();
  const short = strategyShortLabel(s.strategyId);
  return {
    id: `local-${s.id}-NEW_SIGNAL`,
    kind: 'NEW_SIGNAL',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('NEW_SIGNAL'),
    detail: `${s.symbol} · ${dir} · ${short} · вход ${fmtPriceShort(s.entryZone[0])}–${fmtPriceShort(s.entryZone[1])} · стоп ${fmtPriceShort(s.invalidationLevel)}`,
    at: s.createdAt,
    read: false,
    source: 'local-ledger',
  };
}

function fillNotification(s: AnalyticalSetup): SignalNotification {
  return {
    id: `local-${s.id}-FILL`,
    kind: 'FILL',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('FILL'),
    detail: `${s.symbol} · вход по ${s.fill ? fmtPriceShort(s.fill.price) : '—'} · ${strategyShortLabel(s.strategyId)}`,
    at: s.fill?.at ?? s.createdAt,
    read: false,
    source: 'local-ledger',
  };
}

function outcomeNotification(s: AnalyticalSetup): SignalNotification {
  return {
    id: `local-${s.id}-OUTCOME`,
    kind: 'OUTCOME',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('OUTCOME'),
    detail: `${s.symbol} · ${describeSetupOutcome(s)}`,
    at: s.closedAt ?? s.createdAt,
    read: false,
    source: 'local-ledger',
  };
}

/**
 * Дифф снапшота журнала: какие локальные события породить. Чистая функция —
 * покрыта юнит-тестами отдельно от синглтона.
 *
 * ВАЖНО: на вход сюда попадают ТОЛЬКО браузерные сетапы. Результат никогда не
 * становится продакшн-уведомлением (см. `serverSignalNotifications`).
 */
export function diffLedgerForNotifications(
  prevStatusById: ReadonlyMap<string, string>,
  setups: readonly AnalyticalSetup[],
): SignalNotification[] {
  const out: SignalNotification[] = [];
  for (const s of setups) {
    const was = prevStatusById.get(s.id);
    if (was === undefined) {
      if (s.status === 'ACTIVE') out.push(newSignalNotification(s));
      else if (s.status === 'FILLED') out.push(fillNotification(s));
      else if ((CLOSED_STATUSES as readonly string[]).includes(s.status)) out.push(outcomeNotification(s));
      continue;
    }
    if (was === s.status) continue;
    if (was === 'ACTIVE' && s.status === 'FILLED') {
      out.push(fillNotification(s));
    } else if (
      !(CLOSED_STATUSES as readonly string[]).includes(was)
      && (CLOSED_STATUSES as readonly string[]).includes(s.status)
    ) {
      out.push(outcomeNotification(s));
    }
  }
  return out;
}

function snapshotOf(setups: readonly AnalyticalSetup[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of setups) m.set(s.id, s.status);
  return m;
}

/**
 * Лента локального аудита браузера. Отдельный ключ хранилища, отдельный конверт
 * с явным `source: 'local-ledger'`. Продакшн-колокольчик её не читает.
 */
export class LocalLedgerSignalNotificationCenter {
  private started = false;
  private seen = new Map<string, string>();
  private items: SignalNotification[] = [];
  private listeners = new Set<Listener>();
  private unsubscribeLedger: (() => void) | null = null;
  private storage: NotificationStorageLike | null = null;

  constructor(private readonly storageKey: string = LOCAL_SIGNAL_NOTIFICATIONS_STORAGE_KEY) {}

  /** Идемпотентный старт: первичное состояние — без событий за прошлое. */
  public start(storage: NotificationStorageLike | null = browserNotificationStorage()): void {
    this.storage = storage;
    if (storage) {
      const read = readNotificationEnvelope<SignalNotification>(
        storage,
        this.storageKey,
        { schemaVersion: LOCAL_NOTIFICATIONS_SCHEMA_VERSION, source: 'local-ledger' }
      );
      this.items = read.status === 'ok' ? read.items.slice(-MAX_ITEMS) : [];
    }
    if (this.started) return;
    this.started = true;
    try {
      this.seen = snapshotOf(SignalsAuditLedger.getInstance().getSetups());
    } catch {
      this.seen = new Map();
    }
    this.unsubscribeLedger = SignalsAuditLedger.getInstance().subscribe(() => this.onLedger());
  }

  public stop(): void {
    this.started = false;
    this.unsubscribeLedger?.();
    this.unsubscribeLedger = null;
  }

  public getNotifications(): SignalNotification[] {
    return [...this.items];
  }

  public getUnreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  public markAllRead(): void {
    if (this.items.every((n) => n.read)) return;
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.saveToStorage();
    this.emit();
  }

  public clear(): void {
    this.items = [];
    this.saveToStorage();
    this.emit();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Только для тестов: полный сброс синглтона и хранилища. */
  public resetForTests(): void {
    this.stop();
    this.seen = new Map();
    this.items = [];
    this.storage = null;
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(this.storageKey);
    } catch {
      /* ignore */
    }
  }

  private onLedger(): void {
    const setups = SignalsAuditLedger.getInstance().getSetups();
    const fresh = diffLedgerForNotifications(this.seen, setups);
    this.seen = snapshotOf(setups);
    if (fresh.length === 0) return;
    const known = new Set(this.items.map((n) => n.id));
    for (const n of fresh) {
      if (!known.has(n.id)) {
        known.add(n.id);
        this.items.push(n);
      }
    }
    this.items = this.items.slice(-MAX_ITEMS);
    this.saveToStorage();
    this.emit();
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

  private saveToStorage(): void {
    if (!this.storage) return;
    writeNotificationEnvelope<SignalNotification, Record<string, unknown>>(this.storage, this.storageKey, {
      schemaVersion: LOCAL_NOTIFICATIONS_SCHEMA_VERSION,
      source: 'local-ledger',
      items: this.items.slice(-MAX_ITEMS),
    });
  }
}

/** Лента локального аудита. НЕ продакшн-колокольчик (см. шапку файла). */
export const localSignalNotifications = new LocalLedgerSignalNotificationCenter();

/**
 * Maps a signal symbol to the /coin/:symbol route segment.
 * Signals carry pair notation ("FET/USDT", "ARB/USDT", "NEAR/USDT") while the
 * coin route expects the base asset ("FET", "ARB", "NEAR").
 */
export function signalSymbolToRoute(symbol: string): string {
  const base = (symbol ?? '').trim().toUpperCase().split(/[/:\-_]/)[0] ?? '';
  return base.replace(/(USDT|USDC|BUSD|PERP)$/, '') || base;
}
