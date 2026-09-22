/**
 * ScanUniverse — инструменты, которые сканирует LiveSignalEngine.
 *
 * По умолчанию движок сканирует ВСЕ монеты канонического реестра
 * (CANONICAL_ASSETS), а не фиксированную шестёрку. Админ может исключать
 * инструменты из скана и добавлять свои тикеры (в т.ч. вне реестра — для них
 * свечи берутся напрямую с Binance spot, см. LiveMarketDataProvider.getCandles).
 *
 * Хранение — localStorage браузера (движок и журнал тоже client-side, см.
 * docs/DONT_DO.md #4/#8): настройка действует в том браузере, где работает
 * движок. Правила стратегий не затрагиваются — меняется только список
 * инструментов, подаваемых на вход frozen-реплеям.
 */

import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

export const SCAN_UNIVERSE_STORAGE_KEY = 'cryptora_scan_universe_v1';
/** Жёсткий лимит: больше инструментов за 60-секундный цикл честно не успеть. */
export const SCAN_UNIVERSE_MAX = 100;
const SYMBOL_RE = /^[A-Z0-9]{2,12}$/;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* слушатель не должен ломать сервис */
    }
  }
}

function dedupe(symbols: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of symbols) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Вселенная по умолчанию — весь канонический реестр (BASE-тикеры). */
export function defaultScanUniverse(): string[] {
  return CANONICAL_ASSETS.map((a) => a.symbol.toUpperCase());
}

/** Нормализация пользовательского ввода: 'btc', 'BTC/USDT' → 'BTC'. Мусор → null. */
export function normalizeScanSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const base = (trimmed.includes('/') ? trimmed.split('/')[0]! : trimmed).trim();
  if (!SYMBOL_RE.test(base)) return null;
  return base;
}

/** Текущая вселенная (сохранённая или по умолчанию). Битый стор → дефолт, без исключений. */
export function getScanUniverse(): string[] {
  try {
    if (typeof localStorage === 'undefined') return defaultScanUniverse();
    const raw = localStorage.getItem(SCAN_UNIVERSE_STORAGE_KEY);
    if (!raw) return defaultScanUniverse();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultScanUniverse();
    const clean = dedupe(
      parsed.map(normalizeScanSymbol).filter((s): s is string => s !== null),
    ).slice(0, SCAN_UNIVERSE_MAX);
    if (clean.length === 0) return defaultScanUniverse();
    return clean;
  } catch {
    return defaultScanUniverse();
  }
}

export interface UniverseWriteResult {
  ok: boolean;
  error?: string;
  symbols: string[];
}

export function setScanUniverse(symbols: readonly string[]): UniverseWriteResult {
  const clean = dedupe(
    symbols.map(normalizeScanSymbol).filter((s): s is string => s !== null),
  ).slice(0, SCAN_UNIVERSE_MAX);
  if (clean.length === 0) {
    return { ok: false, error: 'Нужен хотя бы один инструмент для сканирования', symbols: getScanUniverse() };
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SCAN_UNIVERSE_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    return { ok: false, error: 'Хранилище браузера недоступно', symbols: clean };
  }
  emit();
  return { ok: true, symbols: clean };
}

export function addScanSymbol(raw: string): UniverseWriteResult {
  const symbol = normalizeScanSymbol(raw);
  const current = getScanUniverse();
  if (!symbol) {
    return { ok: false, error: `«${raw}» — некорректный тикер (2–12 символов A–Z, 0–9)`, symbols: current };
  }
  if (current.includes(symbol)) {
    return { ok: false, error: `${symbol} уже в списке сканирования`, symbols: current };
  }
  if (current.length >= SCAN_UNIVERSE_MAX) {
    return { ok: false, error: `Лимит — ${SCAN_UNIVERSE_MAX} инструментов`, symbols: current };
  }
  return setScanUniverse([...current, symbol]);
}

export function removeScanSymbol(raw: string): UniverseWriteResult {
  const symbol = normalizeScanSymbol(raw);
  const current = getScanUniverse();
  if (!symbol || !current.includes(symbol)) return { ok: true, symbols: current };
  return setScanUniverse(current.filter((x) => x !== symbol));
}

/** Сброс к реестру по умолчанию. Возвращает итоговый список. */
export function resetScanUniverse(): string[] {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SCAN_UNIVERSE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
  return defaultScanUniverse();
}

export function isDefaultUniverse(symbols: readonly string[]): boolean {
  const d = defaultScanUniverse();
  return symbols.length === d.length && symbols.every((s, i) => s === d[i]);
}

export function subscribeScanUniverse(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
