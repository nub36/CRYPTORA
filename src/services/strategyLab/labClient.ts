/**
 * CRYPTORA — Strategy Lab · клиент API (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Тонкая обёртка над admin-эндпоинтами /api/strategy-lab/*. Фронтенд НЕ считает
 * стратегическую математику — он только собирает researchConfig, отправляет
 * запрос и получает готовый результат сервера.
 *
 * credentials: 'include' — session-cookie для requireAuth/requireAdmin.
 * Same-origin запросы (относительные пути) → dev-proxy /api → сервер :3000.
 */

import type { LabReplayResult, LabMarket, LabTimeframe, ResearchConfig } from './types';
import type { LabStrategyMeta } from './registry';

export interface StrategiesResponse {
  strategies: LabStrategyMeta[];
  researchOnly: boolean;
}

export interface ReplayRequestBody {
  strategyId: string;
  market: LabMarket;
  symbol: string;
  timeframe: LabTimeframe;
  from: number;
  to: number;
  researchConfig: ResearchConfig;
}

export class LabApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'LabApiError';
  }
}

async function parseError(res: Response): Promise<never> {
  let message = `Ошибка ${res.status}`;
  let code: string | undefined;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
    if (body?.code) code = body.code;
  } catch {
    /* тело не JSON — оставляем статусное сообщение */
  }
  if (res.status === 401) message = 'Требуется авторизация администратора';
  if (res.status === 403) message = 'Доступ запрещён (только администратор)';
  throw new LabApiError(res.status, message, code);
}

export async function fetchLabStrategies(signal?: AbortSignal): Promise<StrategiesResponse> {
  const res = await fetch('/api/strategy-lab/strategies', {
    credentials: 'include',
    signal,
  });
  if (!res.ok) return parseError(res);
  return res.json();
}

export async function runLabBacktest(
  body: ReplayRequestBody,
  signal?: AbortSignal
): Promise<LabReplayResult> {
  const res = await fetch('/api/strategy-lab/replay', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return parseError(res);
  return res.json();
}
