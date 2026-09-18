import { describe, expect, it } from 'vitest';
import {
  COIN_WORKSPACE_SCHEMA_VERSION,
  DEFAULT_COIN_WORKSPACE_ORDER,
  isDefaultOrder,
  moveModule,
  parseLayout,
  reorderModule,
  serializeLayout,
} from '@/workspace/layout';

describe('coin workspace layout: версионированная схема', () => {
  it('пусто / мусор / чужая версия / неполный набор → раскладка по умолчанию', () => {
    expect(parseLayout(null).order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
    expect(parseLayout('{').order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
    expect(parseLayout(JSON.stringify({ schemaVersion: 99, order: ['depth', 'stats', 'chart'] })).order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
    expect(parseLayout(JSON.stringify({ schemaVersion: 1, order: ['depth', 'stats'] })).order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
    expect(parseLayout(JSON.stringify({ schemaVersion: 1, order: ['depth', 'depth', 'chart'] })).order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
    expect(parseLayout(JSON.stringify({ schemaVersion: 1, order: ['depth', 'stats', 'news'] })).order).toEqual(DEFAULT_COIN_WORKSPACE_ORDER);
  });

  it('serialize → parse без потерь, схема помечена версией', () => {
    const raw = serializeLayout(['depth', 'chart', 'stats']);
    expect(JSON.parse(raw).schemaVersion).toBe(COIN_WORKSPACE_SCHEMA_VERSION);
    expect(parseLayout(raw).order).toEqual(['depth', 'chart', 'stats']);
  });

  it('moveModule: шаг вверх/вниз с ограничением краёв', () => {
    expect(moveModule(['chart', 'stats', 'depth'], 'stats', -1)).toEqual(['stats', 'chart', 'depth']);
    expect(moveModule(['chart', 'stats', 'depth'], 'stats', 1)).toEqual(['chart', 'depth', 'stats']);
    expect(moveModule(['chart', 'stats', 'depth'], 'chart', -1)).toEqual(['chart', 'stats', 'depth']);
    expect(moveModule(['chart', 'stats', 'depth'], 'depth', 1)).toEqual(['chart', 'stats', 'depth']);
  });

  it('reorderModule: drop на цель ставит модуль на её место', () => {
    expect(reorderModule(['chart', 'stats', 'depth'], 'depth', 'chart')).toEqual(['depth', 'chart', 'stats']);
    expect(reorderModule(['chart', 'stats', 'depth'], 'chart', 'depth')).toEqual(['stats', 'depth', 'chart']);
    expect(reorderModule(['chart', 'stats', 'depth'], 'chart', 'chart')).toEqual(['chart', 'stats', 'depth']);
  });

  it('isDefaultOrder', () => {
    expect(isDefaultOrder([...DEFAULT_COIN_WORKSPACE_ORDER])).toBe(true);
    expect(isDefaultOrder(['stats', 'chart', 'depth'])).toBe(false);
  });
});
