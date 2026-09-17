import type { MarketContextFact } from './AiExplanationEngine';

/**
 * Клиент серверного эндпоинта /api/ai/explain (Этап 7). Ключ LLM живёт только на сервере.
 * Результат — либо заземлённый текст, либо явное состояние (не настроен / недоступен / отклонён стражем).
 */
export type LlmExplainResult =
  | { status: 'OK'; text: string; model: string; generatedAt: string }
  | { status: 'NOT_CONFIGURED' }
  | { status: 'REJECTED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export function factsToPayload(f: MarketContextFact): Record<string, unknown> {
  return {
    symbol: f.symbol,
    price: f.price,
    change24h: f.change24h,
    fundingRate8h: f.fundingRate8h,
    openInterestDelta24h: f.openInterestDelta24h,
    openInterestDeltaSource: f.openInterestDeltaSource,
    rsi14: f.rsi14,
    anomalies: f.anomalies?.map((a) => ({ type: a.type, metricValue: a.metricValue })),
  };
}

export async function requestLlmExplanation(
  facts: MarketContextFact,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
  endpoint = '/api/ai/explain',
): Promise<LlmExplainResult> {
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(factsToPayload(facts)),
    });
    if (res.status === 503) return { status: 'NOT_CONFIGURED' };
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 422) return { status: 'REJECTED', reason: String(json.reason ?? 'grounding') };
    if (!res.ok || typeof json.text !== 'string') return { status: 'UNAVAILABLE', reason: String(json.error ?? `HTTP ${res.status}`) };
    return { status: 'OK', text: json.text, model: String(json.model ?? ''), generatedAt: String(json.generatedAt ?? '') };
  } catch (e) {
    return { status: 'UNAVAILABLE', reason: e instanceof Error ? e.message : String(e) };
  }
}
