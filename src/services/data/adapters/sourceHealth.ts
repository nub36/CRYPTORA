/**
 * SourceHealthTracker — клиентский circuit breaker для внешних REST-источников.
 *
 * Проблема: браузерные запросы к биржам могут отказывать СИСТЕМАТИЧЕСКИ:
 *  - KuCoin REST не отдаёт CORS-заголовки браузерам вовсе;
 *  - символ может быть недоступен на бирже (делистинг) — каждый запрос даёт 400/451;
 *  - гео-блокировка/WAF отвечает без CORS-заголовков.
 * Каждый цикл опроса такие отказы засоряют консоль DevTools «красными» сетевыми
 * ошибками и сжигают лимиты запросов, не меняя результат.
 *
 * Политика (честность данных не затрагивается — трекер НИЧЕГО не подменяет):
 *  - 'invalid_symbol' (HTTP 400/404) — источник явно ответил «инструмента нет»:
 *    блокировка endpoint'а на длинный срок (по умолчанию 6 ч ≈ до перезагрузки
 *    страницы) сразу после первой неудачи.
 *  - 'rate_limit' (HTTP 429/418) — короткий cooldown (30 с).
 *  - 'network' | 'http' — блокировка после N подряд неудач (по умолчанию 3) на
 *    networkCooldownMs (10 мин); при повторных эпизодах cooldown удваивается
 *    (кап 1 ч). Таймауты (AbortError) не учитываются — они транзиентны.
 *
 * Восстановление: успешный ответ полностью очищает состояние ключа; после
 * истечения cooldown запросы возобновляются автоматически (half-open).
 *
 * Диагностика: при первой блокировке ключа вызывается onBlocked (по умолчанию —
 * один console.warn с объяснением причины; повторных warn на том же ключе нет).
 */

import type { AdapterSource } from './errors';

export type SourceFailureKind = 'network' | 'invalid_symbol' | 'rate_limit' | 'http';

export interface SourceBlockedEvent {
  source: AdapterSource;
  endpointKey: string;
  kind: SourceFailureKind;
  consecutiveFailures: number;
  cooldownMs: number;
  detail?: string;
}

export interface SourceHealthConfig {
  /** Сколько подряд неудач network/http ведут к блокировке. По умолчанию 3. */
  failureThreshold?: number;
  /** Cooldown после порога network/http неудач. По умолчанию 10 мин. */
  networkCooldownMs?: number;
  /** Cooldown после HTTP 429/418. По умолчанию 30 с. */
  rateLimitCooldownMs?: number;
  /** Cooldown после 400/404 («инструмента нет»). По умолчанию 6 ч. */
  invalidSymbolCooldownMs?: number;
  /** Кап экспоненциального backoff между эпизодами. По умолчанию 1 ч. */
  maxCooldownMs?: number;
  /** Инъекция часов для тестов. */
  now?: () => number;
  /** Хук диагностики (по умолчанию однократный console.warn). */
  onBlocked?: (event: SourceBlockedEvent) => void;
}

interface HealthEntry {
  consecutiveFailures: number;
  blockedUntil: number;
  lastCooldownMs: number;
  kind: SourceFailureKind;
  detail?: string;
  /** warn уже отправлялся в рамках текущего эпизода (до успешного ответа). */
  warned: boolean;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_NETWORK_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 1000;
const DEFAULT_INVALID_SYMBOL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_COOLDOWN_MS = 60 * 60 * 1000;

function describeKind(kind: SourceFailureKind, detail?: string): string {
  const suffix = detail ? ` (${detail})` : '';
  switch (kind) {
    case 'invalid_symbol':
      return `источник ответил «инструмент не найден»${suffix}`;
    case 'rate_limit':
      return `превышен лимит запросов HTTP 429/418${suffix}`;
    case 'http':
      return `HTTP-ошибка источника${suffix}`;
    case 'network':
    default:
      return `сетевой отказ (похоже на блокировку CORS или недоступность сети)${suffix}`;
  }
}

function describeCooldown(kind: SourceFailureKind, cooldownMs: number): string {
  if (kind === 'invalid_symbol') {
    return 'Повторные запросы по этому инструменту остановлены (до перезагрузки страницы). Данные по активу честно помечаются недоступными — без подстановок.';
  }
  const minutes = Math.round(cooldownMs / 60000);
  return `Автоповтор приостановлен на ~${minutes} мин, затем возобновится автоматически.`;
}

export class SourceHealthTracker {
  private readonly entries = new Map<string, HealthEntry>();
  private readonly failureThreshold: number;
  private readonly networkCooldownMs: number;
  private readonly rateLimitCooldownMs: number;
  private readonly invalidSymbolCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;
  private readonly onBlocked: (event: SourceBlockedEvent) => void;

  constructor(config: SourceHealthConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.networkCooldownMs = config.networkCooldownMs ?? DEFAULT_NETWORK_COOLDOWN_MS;
    this.rateLimitCooldownMs = config.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    this.invalidSymbolCooldownMs = config.invalidSymbolCooldownMs ?? DEFAULT_INVALID_SYMBOL_COOLDOWN_MS;
    this.maxCooldownMs = config.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
    this.now = config.now ?? (() => Date.now());
    this.onBlocked =
      config.onBlocked ??
      ((event) => {
        // Один warn на ключ за эпизод — без спама в консоль на каждом цикле опроса.
        console.warn(
          `[CRYPTORA][${event.source}] ${event.endpointKey}: ${describeKind(event.kind, event.detail)}. ${describeCooldown(event.kind, event.cooldownMs)}`
        );
      });
  }

  /** Разрешён ли запрос к ключу прямо сейчас. */
  public canAttempt(endpointKey: string): boolean {
    const entry = this.entries.get(endpointKey);
    if (!entry) return true;
    return this.now() >= entry.blockedUntil;
  }

  /** Сколько мс до снятия блокировки (0 — запросы разрешены). */
  public retryInMs(endpointKey: string): number {
    const entry = this.entries.get(endpointKey);
    if (!entry) return 0;
    return Math.max(0, entry.blockedUntil - this.now());
  }

  public isBlocked(endpointKey: string): boolean {
    return !this.canAttempt(endpointKey);
  }

  /** Успешный ответ полностью восстанавливает ключ. */
  public recordSuccess(endpointKey: string): void {
    this.entries.delete(endpointKey);
  }

  /**
   * Регистрация неудачи. Возвращает актуальный cooldown в мс (0 — порог ещё
   * не достигнут). Повторный эпизод (без промежуточного успеха) ре-блокирует
   * сразу, с удвоением cooldown до капа (backoff).
   */
  public recordFailure(
    source: AdapterSource,
    endpointKey: string,
    kind: SourceFailureKind,
    detail?: string
  ): number {
    const t = this.now();
    const prev = this.entries.get(endpointKey);

    if (kind === 'network' || kind === 'http') {
      // Поздно вернувшийся неудачный запрос (ушёл до блокировки, ответил после)
      // не должен стирать или продлевать действующую блокировку.
      if (prev && prev.blockedUntil > t) {
        return prev.blockedUntil - t;
      }

      const consecutive = (prev?.consecutiveFailures ?? 0) + 1;

      // Эпизод уже имел блокировку, cooldown истёк, успеха не было —
      // одна новая неудача ре-блокирует сразу, с backoff ×2.
      if (prev && prev.lastCooldownMs > 0) {
        const cooldown = Math.min(prev.lastCooldownMs * 2, this.maxCooldownMs);
        this.entries.set(endpointKey, {
          consecutiveFailures: 0,
          blockedUntil: t + cooldown,
          lastCooldownMs: cooldown,
          kind,
          detail,
          warned: true,
        });
        return cooldown;
      }

      if (consecutive < this.failureThreshold) {
        // Порог не достигнут — фиксируем неудачу, но не блокируем.
        this.entries.set(endpointKey, {
          consecutiveFailures: consecutive,
          blockedUntil: 0,
          lastCooldownMs: 0,
          kind,
          detail,
          warned: prev?.warned ?? false,
        });
        return 0;
      }

      const cooldown = this.networkCooldownMs;
      const warnedAlready = prev?.warned ?? false;
      this.entries.set(endpointKey, {
        consecutiveFailures: 0,
        blockedUntil: t + cooldown,
        lastCooldownMs: cooldown,
        kind,
        detail,
        warned: warnedAlready,
      });
      if (!warnedAlready) {
        this.onBlocked({
          source,
          endpointKey,
          kind,
          consecutiveFailures: this.failureThreshold,
          cooldownMs: cooldown,
          detail,
        });
      }
      return cooldown;
    }

    // invalid_symbol | rate_limit — мгновенная блокировка фиксированным сроком.
    const cooldown = this.cooldownFor(kind);
    const warnedAlready = prev?.warned ?? false;
    this.entries.set(endpointKey, {
      consecutiveFailures: 0,
      blockedUntil: t + cooldown,
      lastCooldownMs: cooldown,
      kind,
      detail,
      warned: warnedAlready,
    });
    if (!warnedAlready) {
      this.onBlocked({
        source,
        endpointKey,
        kind,
        consecutiveFailures: 1,
        cooldownMs: cooldown,
        detail,
      });
    }
    return cooldown;
  }

  /** Диагностический снимок текущих блокировок. */
  public snapshot(): Array<{
    endpointKey: string;
    kind: SourceFailureKind;
    retryInMs: number;
    consecutiveFailures: number;
  }> {
    const t = this.now();
    return Array.from(this.entries.entries()).map(([endpointKey, e]) => ({
      endpointKey,
      kind: e.kind,
      retryInMs: Math.max(0, e.blockedUntil - t),
      consecutiveFailures: e.consecutiveFailures,
    }));
  }

  /** Сброс всего состояния (тесты). */
  public reset(): void {
    this.entries.clear();
  }

  private cooldownFor(kind: SourceFailureKind): number {
    switch (kind) {
      case 'invalid_symbol':
        return this.invalidSymbolCooldownMs;
      case 'rate_limit':
        return this.rateLimitCooldownMs;
      default:
        return this.networkCooldownMs;
    }
  }
}

/**
 * Ключ endpoint'а из пути REST-запроса: ресурс + инструмент, без изменчивых
 * параметров (interval/limit), чтобы 1h- и 1d-свечи одного символа делили
 * одну запись здоровья.
 *
 *   '/api/v3/klines?symbol=KASUSDT&interval=1h&limit=25'  → 'klines?symbol=KASUSDT'
 *   '/api/v3/ticker/24hr'                                 → 'ticker/24hr'
 *   '/api/v1/market/stats?symbol=KAS-USDT'                → 'market/stats?symbol=KAS-USDT'
 */
export function exchangeEndpointKey(path: string): string {
  const qIndex = path.indexOf('?');
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const query = qIndex >= 0 ? path.slice(qIndex + 1) : '';

  const parts = pathname.split('/').filter(Boolean);
  let resource = parts;
  if (resource[0]?.toLowerCase() === 'api') resource = resource.slice(1);
  if (/^v\d+$/i.test(resource[0] ?? '')) resource = resource.slice(1);

  let symbolSuffix = '';
  if (query) {
    const symbol = new URLSearchParams(query).get('symbol');
    if (symbol) symbolSuffix = `?symbol=${symbol}`;
  }
  return `${resource.join('/')}${symbolSuffix}`;
}
