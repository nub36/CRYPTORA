import { AssetSummary, ScreenerFilters } from '@/types/market';

export interface ScreenerPreset {
  id: string;
  name: string;
  description: string;
  filters: ScreenerFilters;
  isBuiltIn?: boolean;
}

export const BUILT_IN_PRESETS: ScreenerPreset[] = [
  {
    id: 'oversold_rsi',
    name: 'Перепроданные (RSI < 30)',
    description: 'Инструменты в зоне потенциального технического отскока',
    filters: { maxRsi: 30 },
    isBuiltIn: true,
  },
  {
    id: 'volume_leaders',
    name: 'Лидеры ликвидности (Объем > $500M)',
    description: 'Активы с максимальным институциональным оборотом',
    filters: { minVolume24h: 500000000 },
    isBuiltIn: true,
  },
  {
    id: 'short_squeeze',
    name: 'Отрицательный фандинг (Short Squeeze)',
    description: 'Отрицательная ставка финансирования с потенциалом каскадного выноса',
    filters: { fundingFilter: 'negative' },
    isBuiltIn: true,
  },
  {
    id: 'oi_breakout',
    name: 'Всплеск открытого интереса (> 5%)',
    description: 'Активы с активным накоплением новых позиций',
    filters: { minOIChange24h: 5 },
    isBuiltIn: true,
  },
  {
    id: 'ai_sector',
    name: 'Сектор AI & Big Data',
    description: 'Децентрализованные вычисления и искусственный интеллект',
    filters: { category: 'ai' },
    isBuiltIn: true,
  },
];

export class ScreenerEngine {
  private customPresets: Map<string, ScreenerPreset> = new Map();

  constructor() {
    this.loadCustomPresets();
  }

  /**
   * Filter an asset array against composite screener criteria
   */
  public static filterAssets(
    assets: AssetSummary[],
    filters: ScreenerFilters,
    rsiMap: Record<string, number> = {},
    fundingMap: Record<string, number> = {},
    oiChangeMap: Record<string, number> = {}
  ): AssetSummary[] {
    return assets.filter((asset) => {
      // 1. Text Query Filter
      if (filters.query && filters.query.trim().length > 0) {
        const q = filters.query.toLowerCase().trim();
        const matches =
          asset.symbol.toLowerCase().includes(q) ||
          asset.name.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // 2. Category Filter
      if (filters.category && filters.category !== 'all') {
        if (asset.category !== filters.category) return false;
      }

      // 3. Price Change 24h Filter
      if (filters.minPriceChange24h !== undefined && asset.change24h < filters.minPriceChange24h) {
        return false;
      }
      if (filters.maxPriceChange24h !== undefined && asset.change24h > filters.maxPriceChange24h) {
        return false;
      }

      // 4. Volume 24h Filter
      if (filters.minVolume24h !== undefined && asset.volume24h < filters.minVolume24h) {
        return false;
      }

      // 5. Market Cap Filter
      if (filters.minMarketCap !== undefined && asset.marketCap < filters.minMarketCap) {
        return false;
      }

      // 6. RSI Filter
      const rsi = rsiMap[asset.symbol] ?? 50;
      if (filters.minRsi !== undefined && rsi < filters.minRsi) {
        return false;
      }
      if (filters.maxRsi !== undefined && rsi > filters.maxRsi) {
        return false;
      }

      // 7. Funding Filter
      const funding = fundingMap[asset.symbol] ?? 0.01;
      if (filters.fundingFilter === 'positive' && funding <= 0) {
        return false;
      }
      if (filters.fundingFilter === 'negative' && funding >= 0) {
        return false;
      }

      // 8. OI Change Filter
      const oiChange = oiChangeMap[asset.symbol] ?? 0;
      if (filters.minOIChange24h !== undefined && oiChange < filters.minOIChange24h) {
        return false;
      }

      return true;
    });
  }

  public getAllPresets(): ScreenerPreset[] {
    return [...BUILT_IN_PRESETS, ...Array.from(this.customPresets.values())];
  }

  public savePreset(name: string, description: string, filters: ScreenerFilters): ScreenerPreset {
    const id = `preset-${Date.now()}`;
    const preset: ScreenerPreset = {
      id,
      name,
      description,
      filters,
      isBuiltIn: false,
    };
    this.customPresets.set(id, preset);
    this.persistCustomPresets();
    return preset;
  }

  public deletePreset(id: string): boolean {
    if (this.customPresets.has(id)) {
      this.customPresets.delete(id);
      this.persistCustomPresets();
      return true;
    }
    return false;
  }

  private loadCustomPresets(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('cryptora_screener_presets');
        if (saved) {
          const list: ScreenerPreset[] = JSON.parse(saved);
          for (const p of list) {
            this.customPresets.set(p.id, p);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private persistCustomPresets(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const list = Array.from(this.customPresets.values());
        localStorage.setItem('cryptora_screener_presets', JSON.stringify(list));
      }
    } catch {
      // ignore
    }
  }
}
