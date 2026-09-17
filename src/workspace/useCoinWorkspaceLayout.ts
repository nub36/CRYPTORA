import { useCallback, useState } from 'react';
import {
  COIN_WORKSPACE_STORAGE_KEY,
  DEFAULT_COIN_WORKSPACE_ORDER,
  moveModule,
  parseLayout,
  reorderModule,
  serializeLayout,
  type CoinWorkspaceModuleId,
} from './layout';

function readStored(): CoinWorkspaceModuleId[] {
  try {
    return parseLayout(typeof localStorage !== 'undefined' ? localStorage.getItem(COIN_WORKSPACE_STORAGE_KEY) : null).order;
  } catch {
    return [...DEFAULT_COIN_WORKSPACE_ORDER];
  }
}

function persist(order: CoinWorkspaceModuleId[]): void {
  try {
    localStorage.setItem(COIN_WORKSPACE_STORAGE_KEY, serializeLayout(order));
  } catch {
    /* quota / private mode — раскладка живёт до перезагрузки */
  }
}

export function useCoinWorkspaceLayout() {
  const [order, setOrder] = useState<CoinWorkspaceModuleId[]>(readStored);

  const update = useCallback((next: CoinWorkspaceModuleId[]) => {
    setOrder(next);
    persist(next);
  }, []);

  const move = useCallback((id: CoinWorkspaceModuleId, dir: -1 | 1) => update(moveModule(order, id, dir)), [order, update]);
  const dropOn = useCallback(
    (id: CoinWorkspaceModuleId, targetId: CoinWorkspaceModuleId) => update(reorderModule(order, id, targetId)),
    [order, update],
  );
  const reset = useCallback(() => {
    setOrder([...DEFAULT_COIN_WORKSPACE_ORDER]);
    try {
      localStorage.removeItem(COIN_WORKSPACE_STORAGE_KEY);
    } catch {
      /* noop */
    }
  }, []);

  return { order, move, dropOn, reset };
}
