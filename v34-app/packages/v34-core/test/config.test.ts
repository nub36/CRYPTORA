/**
 * Контракт «конфиг продукта = фактический каталог CRYPTORA».
 *
 * Значения продукта (идентификатор, версия, вселенная, таймфреймы, интервал
 * скана, статус исследования) обязаны совпадать с серверным каталогом
 * стратегий, а не с ТЗ. Это ловит расхождение при обновлении источника.
 */
import { describe, it, expect } from 'vitest';
import { PRODUCT_STRATEGIES, BADGE_LABELS } from '../../../../server/services/strategyCatalog.js';
import type { ProductStrategy, StrategyBadge } from './types/catalog';
import {
  V34_STRATEGY_ID, V34_STRATEGY_VERSION, V34_STRATEGY_NAME, V34_STRATEGY_NAME_RU,
  V34_RESEARCH_BADGE, V34_RESEARCH_BADGE_LABEL, V34_SYMBOLS, V34_TIMEFRAMES,
  V34_DEFAULT_SCAN_INTERVAL_SECONDS, V34_QUALITY_GATES, MARKET_DATA_SOURCE, V34_WARMUP_BARS,
} from '../src/config';
import { V33_CONSTANTS } from '../src/strategy/v33Core';
import { FROZEN_SETTINGS_SHA256, FROZEN_ENGINE } from '../src/strategy/frozenSettings';

const catalog = PRODUCT_STRATEGIES as readonly ProductStrategy[];
const catalogV34 = catalog.find((s) => s.id === V34_STRATEGY_ID) as ProductStrategy;
const badges = BADGE_LABELS as Readonly<Record<StrategyBadge, string>>;

describe('каталог CRYPTORA ↔ конфиг продукта', () => {
  it('V3.4 присутствует в каталоге и совпадает по метаданным', () => {
    expect(catalogV34).toBeTruthy();
    expect(catalogV34.version).toBe(V34_STRATEGY_VERSION);
    expect(catalogV34.name).toBe(V34_STRATEGY_NAME);
    expect(catalogV34.nameRu).toBe(V34_STRATEGY_NAME_RU);
    expect(catalogV34.badge).toBe(V34_RESEARCH_BADGE);
    expect(badges[catalogV34.badge]).toBe(V34_RESEARCH_BADGE_LABEL);
  });

  it('вселенная и таймфреймы — из каталога и ядра', () => {
    expect([...V34_SYMBOLS]).toEqual([...catalogV34.defaultSymbols]);
    expect([...V34_SYMBOLS]).toEqual([...V33_CONSTANTS.SYMBOLS]);
    expect([...V34_TIMEFRAMES.all]).toEqual(catalogV34.timeframes);
    expect(catalogV34.execTimeframe).toBe(V34_TIMEFRAMES.exec);
    expect(catalogV34.contextTimeframes).toEqual([V34_TIMEFRAMES.context]);
    expect(V33_CONSTANTS.EXEC_TF).toBe(V34_TIMEFRAMES.exec);
    expect(V33_CONSTANTS.STRUCT_TF).toBe(V34_TIMEFRAMES.context);
  });

  it('интервал скана и пороги качества — из кода', () => {
    expect(catalogV34.defaultScanIntervalSeconds).toBe(V34_DEFAULT_SCAN_INTERVAL_SECONDS);
    expect(V34_QUALITY_GATES).toEqual({ entryZoneAtrPad: 0.25, tp1MinR: 0.5, tp2MinR: 1 });
    expect(V34_WARMUP_BARS).toBe(60);
  });

  it('источник данных — публичный спот Binance без ключей', () => {
    expect(MARKET_DATA_SOURCE.baseUrl).toBe('https://api.binance.com');
    expect(MARKET_DATA_SOURCE.quote).toBe('USDT');
    expect(Object.keys(MARKET_DATA_SOURCE).some((k) => /key|secret|token|signature/i.test(k))).toBe(false);
  });

  it('замороженные настройки не изменились', () => {
    expect(FROZEN_SETTINGS_SHA256).toBe('92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9');
    expect(FROZEN_ENGINE.atrPeriod).toBe(14);
    expect(FROZEN_ENGINE.volumePeriod).toBe(20);
    expect(FROZEN_ENGINE.settingsCount).toBe(74);
  });
});
