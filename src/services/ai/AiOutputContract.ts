/**
 * AiOutputContract — структурированный ответ LLM (docs/AI.md §5).
 *
 * LLM возвращает JSON, который проходит runtime validation.
 * Не используется как FACTUAL source — только как аналитический слой.
 */

// ---------------------------------------------------------------------------
// Structured LLM response
// ---------------------------------------------------------------------------
export interface AiExplanation {
  /** Краткое резюме (1–2 предложения) */
  summary: string;
  /** Ключевые наблюдения из фактов */
  keyObservations: string[];
  /** Поддерживающие факты */
  supportingFacts: string[];
  /** Противоположные аргументы / альтернативные трактовки */
  counterEvidence: string[];
  /** Ограничения данных (UNAVAILABLE / MODEL_ESTIMATED) */
  dataLimitations: string[];
  /** Наблюдения по риску (не рекомендации) */
  riskNotes: string[];
}

// ---------------------------------------------------------------------------
// Server response envelope
// ---------------------------------------------------------------------------
export type AiExplainStatus = 'OK' | 'NOT_CONFIGURED' | 'REJECTED' | 'UNAVAILABLE' | 'TIMEOUT' | 'RATE_LIMITED';

export interface AiExplainResponse {
  status: AiExplainStatus;
  explanation?: AiExplanation;
  model?: string;
  generatedAt?: string;
  /** Only for REJECTED/UNAVAILABLE/TIMEOUT/RATE_LIMITED */
  reason?: string;
  /** Only for NOT_CONFIGURED */
  configured?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime validation for AiExplanation
// ---------------------------------------------------------------------------
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Runtime Zod-free validation of LLM JSON output.
 * Returns true if `obj` is a valid AiExplanation.
 */
export function validateAiExplanation(obj: unknown): obj is AiExplanation {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.summary !== 'string' || o.summary.length === 0) return false;
  if (!isStringArray(o.keyObservations)) return false;
  if (!isStringArray(o.supportingFacts)) return false;
  if (!isStringArray(o.counterEvidence)) return false;
  if (!isStringArray(o.dataLimitations)) return false;
  if (!isStringArray(o.riskNotes)) return false;
  // All string arrays must be reasonable length
  for (const arr of [o.keyObservations, o.supportingFacts, o.counterEvidence, o.dataLimitations, o.riskNotes]) {
    if (arr.length > 20) return false;
  }
  return true;
}
