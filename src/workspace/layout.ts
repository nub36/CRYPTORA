/**
 * Переставляемая рабочая область Coin Detail (UX-цикл п. 5).
 *
 * Модули — крупные блоки страницы (не отдельные карточки), порядок хранится
 * в localStorage под версионированной схемой. Чистая логика без React.
 *
 * Инварианты:
 *  - набор модулей фиксирован (COIN_WORKSPACE_MODULES); хранится только порядок;
 *  - невалидная / устаревшая (другой schemaVersion) / неполная запись → раскладка по умолчанию;
 *  - внутреннее устройство модулей (график 72/28 + Pulse, провенанс, MODEL/ESTIMATED) не меняется.
 */
export const COIN_WORKSPACE_SCHEMA_VERSION = 1;
export const COIN_WORKSPACE_STORAGE_KEY = 'cryptora_workspace_coin';

export type CoinWorkspaceModuleId = 'chart' | 'stats' | 'depth';

export interface CoinWorkspaceModuleMeta {
  id: CoinWorkspaceModuleId;
  titleRu: string;
}

export const COIN_WORKSPACE_MODULES: readonly CoinWorkspaceModuleMeta[] = [
  { id: 'chart', titleRu: 'График и пульс актива' },
  { id: 'stats', titleRu: 'Метрики, деривативы, индикаторы' },
  { id: 'depth', titleRu: 'Стакан, пары и радар' },
];

export const DEFAULT_COIN_WORKSPACE_ORDER: readonly CoinWorkspaceModuleId[] = COIN_WORKSPACE_MODULES.map((m) => m.id);

export interface CoinWorkspaceLayout {
  schemaVersion: typeof COIN_WORKSPACE_SCHEMA_VERSION;
  order: CoinWorkspaceModuleId[];
}

const ALL_IDS = new Set<string>(DEFAULT_COIN_WORKSPACE_ORDER);

export function isValidOrder(order: unknown): order is CoinWorkspaceModuleId[] {
  if (!Array.isArray(order) || order.length !== ALL_IDS.size) return false;
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== 'string' || !ALL_IDS.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export function parseLayout(raw: string | null | undefined): CoinWorkspaceLayout {
  const fallback: CoinWorkspaceLayout = { schemaVersion: COIN_WORKSPACE_SCHEMA_VERSION, order: [...DEFAULT_COIN_WORKSPACE_ORDER] };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; order?: unknown };
    if (parsed?.schemaVersion !== COIN_WORKSPACE_SCHEMA_VERSION) return fallback;
    if (!isValidOrder(parsed.order)) return fallback;
    return { schemaVersion: COIN_WORKSPACE_SCHEMA_VERSION, order: [...parsed.order] };
  } catch {
    return fallback;
  }
}

export function serializeLayout(order: readonly CoinWorkspaceModuleId[]): string {
  return JSON.stringify({ schemaVersion: COIN_WORKSPACE_SCHEMA_VERSION, order });
}

export function isDefaultOrder(order: readonly CoinWorkspaceModuleId[]): boolean {
  return order.length === DEFAULT_COIN_WORKSPACE_ORDER.length && order.every((id, i) => id === DEFAULT_COIN_WORKSPACE_ORDER[i]);
}

/** Переместить модуль на одну позицию вверх/вниз (клавиатурная альтернатива drag). */
export function moveModule(
  order: readonly CoinWorkspaceModuleId[],
  id: CoinWorkspaceModuleId,
  direction: -1 | 1,
): CoinWorkspaceModuleId[] {
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Поставить модуль `id` на место модуля `targetId` (drag-and-drop). */
export function reorderModule(
  order: readonly CoinWorkspaceModuleId[],
  id: CoinWorkspaceModuleId,
  targetId: CoinWorkspaceModuleId,
): CoinWorkspaceModuleId[] {
  const from = order.indexOf(id);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
