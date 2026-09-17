/**
 * Оценка пользовательских алертов (Этап 6 / 10 — расширенная система алертов).
 * Чистые функции без сети и без React: тестируемы детерминированно.
 *
 * Инварианты: алерт — только уведомление о факте (цена/фандинг/OI из фактического
 * источника). Никаких ордеров, ключей бирж и исполнения.
 */
export type UserAlertCondition = 'ABOVE' | 'BELOW' | 'OI_SPIKE' | 'FUNDING_EXTREME';
export type AlertChannelId = 'IN_APP' | 'BROWSER' | 'TELEGRAM' | 'WEBHOOK';

export interface UserAlertRule {
  id: string;
  symbol: string;
  condition: UserAlertCondition;
  targetValue: number | string;
  createdAt: string;
  /** Каналы доставки; по умолчанию только IN_APP. */
  channels?: AlertChannelId[];
  lastTriggeredAt?: string;
  /** Выключенный алерт хранится, но не оценивается. */
  paused?: boolean;
}

/** Фактические входы для оценки одного символа. */
export interface AlertInputs {
  price?: number;
  /** Ставка фандинга (8ч) в процентах, например 0.0125. */
  fundingRatePct?: number;
  /** Изменение открытого интереса за 1ч, %. */
  oiChange1hPct?: number;
  /** Происхождение входа — попадает в текст уведомления. */
  source: string;
}

export interface TriggeredUserAlert {
  id: string;
  ruleId: string;
  symbol: string;
  condition: UserAlertCondition;
  targetValue: number;
  actualValue: number;
  message: string;
  timestamp: string;
  source: string;
}

export const DEFAULT_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

export function conditionLabelRu(c: UserAlertCondition): string {
  switch (c) {
    case 'ABOVE':
      return 'цена ≥';
    case 'BELOW':
      return 'цена ≤';
    case 'OI_SPIKE':
      return 'OI Δ1ч ≥';
    case 'FUNDING_EXTREME':
      return '|фандинг| ≥';
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/**
 * Проверяет одно правило. Возвращает событие или null.
 * Cooldown: повторное срабатывание того же правила подавляется в течение cooldownMs.
 */
export function evaluateUserAlert(
  rule: UserAlertRule,
  inputs: AlertInputs,
  nowMs: number = Date.now(),
  cooldownMs: number = DEFAULT_ALERT_COOLDOWN_MS,
): TriggeredUserAlert | null {
  if (rule.paused) return null;
  const target = typeof rule.targetValue === 'number' ? rule.targetValue : parseFloat(String(rule.targetValue));
  if (!Number.isFinite(target)) return null;
  if (rule.lastTriggeredAt) {
    const last = Date.parse(rule.lastTriggeredAt);
    if (Number.isFinite(last) && nowMs - last < cooldownMs) return null;
  }

  let actual: number | undefined;
  let met = false;
  let text = '';
  switch (rule.condition) {
    case 'ABOVE':
      actual = inputs.price;
      met = actual !== undefined && actual >= target;
      text = `${rule.symbol}: цена $${fmt(actual ?? 0)} ≥ порога $${fmt(target)}`;
      break;
    case 'BELOW':
      actual = inputs.price;
      met = actual !== undefined && actual <= target;
      text = `${rule.symbol}: цена $${fmt(actual ?? 0)} ≤ порога $${fmt(target)}`;
      break;
    case 'FUNDING_EXTREME':
      actual = inputs.fundingRatePct;
      met = actual !== undefined && Math.abs(actual) >= Math.abs(target);
      text = `${rule.symbol}: фандинг ${fmt(actual ?? 0)}% по модулю ≥ ${fmt(Math.abs(target))}%`;
      break;
    case 'OI_SPIKE':
      actual = inputs.oiChange1hPct;
      met = actual !== undefined && actual >= target;
      text = `${rule.symbol}: открытый интерес +${fmt(actual ?? 0)}% за 1ч ≥ ${fmt(target)}%`;
      break;
  }
  if (!met || actual === undefined || !Number.isFinite(actual)) return null;

  const ts = new Date(nowMs).toISOString();
  return {
    // Детерминированный id: правило + момент срабатывания (без Math.random)
    id: `evt-${rule.id}-${nowMs}`,
    ruleId: rule.id,
    symbol: rule.symbol,
    condition: rule.condition,
    targetValue: target,
    actualValue: actual,
    message: `${text} · источник: ${inputs.source}`,
    timestamp: ts,
    source: inputs.source,
  };
}

/** Прогон набора правил по карте входов; возвращает события и обновлённые правила (lastTriggeredAt). */
export function evaluateAll(
  rules: readonly UserAlertRule[],
  inputsBySymbol: Readonly<Record<string, AlertInputs>>,
  nowMs: number = Date.now(),
  cooldownMs: number = DEFAULT_ALERT_COOLDOWN_MS,
): { events: TriggeredUserAlert[]; rules: UserAlertRule[] } {
  const events: TriggeredUserAlert[] = [];
  const next = rules.map((rule) => {
    const inputs = inputsBySymbol[rule.symbol.toUpperCase()];
    if (!inputs) return rule;
    const ev = evaluateUserAlert(rule, inputs, nowMs, cooldownMs);
    if (!ev) return rule;
    events.push(ev);
    return { ...rule, lastTriggeredAt: ev.timestamp };
  });
  return { events, rules: next };
}
