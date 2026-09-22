/**
 * signalNotifications — события журнала сигналов в колокольчик.
 *
 * Центр подписывается на SignalsAuditLedger и сравнивает снапшоты статусов:
 * новая запись → НОВЫЙ СИГНАЛ, ACTIVE→FILLED → ВХОД ИСПОЛНЕН, закрытие →
 * ИСХОД (с чистым R и причиной). Тексты — те же формулировки, что и на
 * /signals (см. utils/signalText), время — из журнала, а не «сейчас».
 *
 * Хранение — localStorage (лента переживает перезагрузку; непрочитанные
 * события прошлого запуска показываются при входе). При первом старте уже
 * лежащие в журнале записи НЕ порождают событий — только новые изменения.
 * Журнал при этом не меняется: центр только читает и диффает.
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

export type SignalNotificationKind = 'NEW_SIGNAL' | 'FILL' | 'OUTCOME';

export interface SignalNotification {
  /** Детерминированный id: sig-<setupId>-<KIND> (никакого Math.random). */
  id: string;
  kind: SignalNotificationKind;
  setupId: string;
  symbol: string;
  title: string;
  detail: string;
  /** ISO-время события из журнала. */
  at: string;
  read: boolean;
}

export const SIGNAL_NOTIFICATIONS_STORAGE_KEY = 'cryptora_signal_notifications_v1';
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
    id: `sig-${s.id}-NEW_SIGNAL`,
    kind: 'NEW_SIGNAL',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('NEW_SIGNAL'),
    detail: `${s.symbol} · ${dir} · ${short} · вход ${fmtPriceShort(s.entryZone[0])}–${fmtPriceShort(s.entryZone[1])} · стоп ${fmtPriceShort(s.invalidationLevel)}`,
    at: s.createdAt,
    read: false,
  };
}

function fillNotification(s: AnalyticalSetup): SignalNotification {
  return {
    id: `sig-${s.id}-FILL`,
    kind: 'FILL',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('FILL'),
    detail: `${s.symbol} · вход по ${s.fill ? fmtPriceShort(s.fill.price) : '—'} · ${strategyShortLabel(s.strategyId)}`,
    at: s.fill?.at ?? s.createdAt,
    read: false,
  };
}

function outcomeNotification(s: AnalyticalSetup): SignalNotification {
  return {
    id: `sig-${s.id}-OUTCOME`,
    kind: 'OUTCOME',
    setupId: s.id,
    symbol: s.symbol,
    title: kindTitle('OUTCOME'),
    detail: `${s.symbol} · ${describeSetupOutcome(s)}`,
    at: s.closedAt ?? s.createdAt,
    read: false,
  };
}

/**
 * Дифф снапшота журнала: какие уведомления породить. Чистая функция —
 * покрыта юнит-тестами отдельно от синглтона.
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

class SignalNotificationCenter {
  private started = false;
  private seen = new Map<string, string>();
  private items: SignalNotification[] = [];
  private listeners = new Set<Listener>();
  private unsubscribeLedger: (() => void) | null = null;

  constructor() {
    this.items = this.loadFromStorage();
  }

  /** Идемпотентный старт: первичное состояние — без событий за прошлое. */
  public start(): void {
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
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SIGNAL_NOTIFICATIONS_STORAGE_KEY);
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

  private loadFromStorage(): SignalNotification[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(SIGNAL_NOTIFICATIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SignalNotification[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((n) => n && typeof n.id === 'string' && typeof n.setupId === 'string').slice(-MAX_ITEMS);
    } catch {
      return [];
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SIGNAL_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(this.items.slice(-MAX_ITEMS)));
      }
    } catch {
      /* localStorage недоступен — лента живёт в памяти */
    }
  }
}

export const signalNotifications = new SignalNotificationCenter();
