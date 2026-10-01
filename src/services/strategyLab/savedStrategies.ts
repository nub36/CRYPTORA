import type { StrategyResearchDraft } from './draft/types';
import { LabApiError } from './labClient';

export interface SavedStrategy {
  id: string;
  name: string;
  indicators: StrategyResearchDraft['indicators'];
  sourceCode: string;
  execution: StrategyResearchDraft['execution'];
  apiVersion: 2;
  createdAt: string;
  updatedAt: string;
}

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try { message = (await res.json()).error || message; } catch { /* noop */ }
    throw new LabApiError(res.status, message);
  }
  return res.json();
}

export async function fetchSavedStrategies(signal?: AbortSignal): Promise<SavedStrategy[]> {
  return (await request('/api/strategy-lab/saved-strategies', { signal })).strategies;
}

export async function createSavedStrategy(draft: StrategyResearchDraft): Promise<SavedStrategy> {
  return (await request('/api/strategy-lab/saved-strategies', { method: 'POST', body: JSON.stringify(draft) })).strategy;
}

export async function updateSavedStrategy(id: string, draft: StrategyResearchDraft): Promise<SavedStrategy> {
  return (await request(`/api/strategy-lab/saved-strategies/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(draft) })).strategy;
}
