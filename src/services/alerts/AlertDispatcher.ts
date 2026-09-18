import type { AlertChannelId, TriggeredUserAlert } from './alertEvaluator';
import {
  ALERT_DELIVERY_LOG_KEY,
  type AlertChannelsConfig,
  deliverTelegram,
  deliverWebhook,
  type DeliveryRecord,
} from './deliveryChannels';

const MAX_LOG = 200;

/**
 * Доставка сработавшего алерта по каналам правила. Пишет журнал доставки в localStorage.
 * Браузерное уведомление — только при явном разрешении пользователя (Notification.permission === 'granted').
 */
export class AlertDispatcher {
  private log: DeliveryRecord[] = [];
  private counter = 0;

  constructor(
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, o) => fetch(i, o),
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
  ) {
    try {
      const raw = this.storage?.getItem(ALERT_DELIVERY_LOG_KEY);
      if (raw) this.log = JSON.parse(raw) as DeliveryRecord[];
    } catch {
      this.log = [];
    }
  }

  public getLog(): DeliveryRecord[] {
    return [...this.log];
  }

  public async dispatch(ev: TriggeredUserAlert, channels: AlertChannelId[], cfg: AlertChannelsConfig): Promise<DeliveryRecord[]> {
    const out: DeliveryRecord[] = [];
    const push = (r: Omit<DeliveryRecord, 'id' | 'timestamp'>) => {
      const rec: DeliveryRecord = { ...r, id: `dlv-${ev.id}-${r.channel}-${++this.counter}`, timestamp: new Date().toISOString() };
      out.push(rec);
      this.log.unshift(rec);
    };

    for (const ch of channels) {
      if (ch === 'IN_APP') {
        push({ eventId: ev.id, channel: ch, status: 'DELIVERED', detail: 'центр уведомлений' });
      } else if (ch === 'BROWSER') {
        push(this.notifyBrowser(ev, cfg));
      } else if (ch === 'TELEGRAM') {
        push(await deliverTelegram(cfg.telegram, ev, this.fetchFn));
      } else if (ch === 'WEBHOOK') {
        push(await deliverWebhook(cfg.webhook, ev, this.fetchFn));
      }
    }
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    this.persist();
    return out;
  }

  private notifyBrowser(ev: TriggeredUserAlert, cfg: AlertChannelsConfig): Omit<DeliveryRecord, 'id' | 'timestamp'> {
    const base = { eventId: ev.id, channel: 'BROWSER' as const };
    if (!cfg.browser.enabled) return { ...base, status: 'SKIPPED', detail: 'канал выключен' };
    if (typeof Notification === 'undefined') return { ...base, status: 'FAILED', detail: 'Notification API недоступен' };
    if (Notification.permission !== 'granted') return { ...base, status: 'FAILED', detail: `разрешение: ${Notification.permission}` };
    try {
      new Notification(`CRYPTORA · ${ev.symbol}`, { body: ev.message, tag: ev.ruleId });
      return { ...base, status: 'DELIVERED', detail: 'системное уведомление' };
    } catch (e) {
      return { ...base, status: 'FAILED', detail: (e as Error).message };
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(ALERT_DELIVERY_LOG_KEY, JSON.stringify(this.log));
    } catch {
      /* quota */
    }
  }
}
