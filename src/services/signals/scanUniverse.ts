/**
 * ScanUniverse — инструменты, которые сканирует движок сигналов.
 *
 * ИСТОЧНИК ИСТИНЫ — PostgreSQL (таблица scan_universe, миграция 008), общий
 * для всех процессов и пользователей. localStorage больше НЕ используется.
 *
 *   • Доступность монеты на сайте ≠ скан: все активные Binance Spot USDT
 *     инструменты доступны автоматически (exchangeInfo).
 *   • Эффективная вселенная = сохранённая ∩ активные на бирже (считает сервер):
 *     делистинг не сканируется, даже если остался в настройке.
 *   • Admin → Монеты: GET/POST/DELETE /api/admin/scan-universe.
 *   • Браузерный движок читает GET /api/strategies/scan-universe.
 *
 * Правила стратегий не затрагиваются — меняется только входной список.
 */

import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

/** Жёсткий лимит (зеркалит server/services/scanUniverse.js). */
export const SCAN_UNIVERSE_MAX = 100;
const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const REFRESH_MS = 5 * 60_000;

type Listener = () => void;
const listeners = new Set<Listener>();
let current: string[] | null = null;
let loadedAt = 0;
let pending: Promise<string[]> | null = null;

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* слушатель не должен ломать сервис */
    }
  }
}

/** Вселенная до первого ответа сервера — канонический реестр (как seed миграции 008). */
export function defaultScanUniverse(): string[] {
  return CANONICAL_ASSETS.map((a) => a.symbol.toUpperCase());
}

/** 'btc', 'BTC/USDT', 'BTCUSDT' → 'BTC'. Мусор → null. */
export function normalizeScanSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  if (s.includes('/')) s = s.split('/')[0]!.trim();
  if (s.length > 4 && s.endsWith('USDT')) s = s.slice(0, -4);
  return SYMBOL_RE.test(s) ? s : null;
}

function cleanList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const s = normalizeScanSymbol(r);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.slice(0, SCAN_UNIVERSE_MAX);
}

/** Текущая (последняя известная) эффективная вселенная — синхронно. */
export function getScanUniverse(): string[] {
  return current ?? defaultScanUniverse();
}

/**
 * Подтянуть эффективную вселенную с сервера. Общий промис — без шторма.
 * Сервер недоступен → остаётся последнее известное значение.
 */
export function refreshScanUniverse(fetchFn: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<string[]> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetchFn('/api/strategies/scan-universe', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { symbols?: unknown; activeKnown?: unknown };
      const list = cleanList(body.symbols);
      if (list && body.activeKnown !== false) applyServerUniverse(list);
    } catch {
      /* keep last known */
    } finally {
      pending = null;
    }
    return getScanUniverse();
  })();
  return pending;
}

/** Применить список, пришедший с сервера (после чтения или изменения админом). */
export function applyServerUniverse(symbols: readonly string[]): void {
  const next = cleanList(symbols) ?? [];
  const changed = !current || current.length !== next.length || current.some((s, i) => s !== next[i]);
  current = next;
  loadedAt = Date.now();
  if (changed) emit();
}

/** Периодическое обновление (движок другого админа мог изменить вселенную). */
export function ensureFreshScanUniverse(): void {
  if (Date.now() - loadedAt > REFRESH_MS) void refreshScanUniverse();
}

export function subscribeScanUniverse(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function resetScanUniverseForTests(): void {
  current = null;
  loadedAt = 0;
  pending = null;
  listeners.clear();
}

// ─── Admin API client ────────────────────────────────────────────────────────

export interface AdminScanUniverseState {
  saved: string[];
  effective: string[];
  inactive: string[];
  activeKnown: boolean;
  activeCount: number | null;
  max: number;
}

async function adminCall(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<{ ok: true; state: AdminScanUniverseState } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(url, {
      credentials: 'include',
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const body = (await res.json().catch(() => ({}))) as Partial<AdminScanUniverseState> & { message?: string };
    if (!res.ok) return { ok: false, error: body.message ?? `HTTP ${res.status}` };
    const state: AdminScanUniverseState = {
      saved: cleanList(body.saved) ?? [],
      effective: cleanList(body.effective) ?? [],
      inactive: cleanList(body.inactive) ?? [],
      activeKnown: body.activeKnown !== false,
      activeCount: typeof body.activeCount === 'number' ? body.activeCount : null,
      max: typeof body.max === 'number' ? body.max : SCAN_UNIVERSE_MAX,
    };
    if (state.activeKnown) applyServerUniverse(state.effective);
    return { ok: true, state };
  } catch {
    return { ok: false, error: 'Сервер недоступен' };
  }
}

const defaultFetch: typeof fetch = (...a) => globalThis.fetch(...a);

export function fetchAdminScanUniverse(fetchFn: typeof fetch = defaultFetch) {
  return adminCall(fetchFn, '/api/admin/scan-universe');
}

export function addScanSymbolRemote(symbol: string, fetchFn: typeof fetch = defaultFetch) {
  return adminCall(fetchFn, '/api/admin/scan-universe', { method: 'POST', body: JSON.stringify({ symbol }) });
}

export function removeScanSymbolRemote(symbol: string, fetchFn: typeof fetch = defaultFetch) {
  return adminCall(fetchFn, `/api/admin/scan-universe/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
}
