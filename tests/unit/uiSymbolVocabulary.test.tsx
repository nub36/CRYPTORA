import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FuturesContractPage } from '@/pages/FuturesContractPage';
import { FuturesPage } from '@/pages/FuturesPage';
import { conditionLabelRu } from '@/services/alerts/alertEvaluator';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { FuturesAsset, OHLCV } from '@/types/market';

/**
 * UI-СЛОВАРЬ МАТЕМАТИЧЕСКИХ СИМВОЛОВ (UI-cleanup после PR #37, §12).
 *
 * Регрессия: в пользовательском интерфейсе широко использовался одиночный
 * символ «Δ» («OI Δ за 1 час», «OI Δ 24ч», «Δ 7д», «Δ24ч —»), который
 * читается как случайный треугольник, а не как «изменение».
 *
 * Правила словаря:
 *  • «Δ» НЕ используется как обозначение изменения ни в одной
 *    пользовательской подписи: полная форма — «Изменение … за …»,
 *    компактная (таблицы/чипы) — «Изм. …»;
 *  • внутренняя нотация (имена переменных, формулы, API-поля, комментарии)
 *    НЕ трогается — см. «НЕ менять» в задаче;
 *  • общепринятые символы метрик (ρ, β) допустимы ТОЛЬКО в tooltip/пояснении
 *    рядом со словом («Корреляция», «Бета»), но не как одиночная подпись.
 *
 * Тест проверяет и runtime-рендер страниц, и статический запрет «Δ» в
 * label-поверхностях исходников.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  RealtimeFeedManager.getInstance().destroy();
  document.body.innerHTML = '';
});

/* ============================ RUNTIME: страница контракта ============================ */

const contract: FuturesAsset = {
  symbol: 'SOL/USDT',
  contractSymbol: 'SOLUSDT',
  baseAsset: 'SOL',
  isDemo: false,
  markPrice: 148.2,
  indexPrice: 148.1,
  lastPrice: 148.2,
  priceChange24h: -3.42,
  high24h: 152.0,
  low24h: 144.0,
  baseVolume24h: 8_400_000,
  fundingRate: 0.01,
  predictedFundingRate: 0.01,
  nextFundingTime: Date.now() + 3_600_000,
  annualizedFundingRate: 10.95,
  openInterest: 412_000_000,
  // Дельты ЕСТЬ — строки «Изменение OI …» обязаны отрендериться с числами.
  openInterestChange1h: 0.8,
  openInterestChange24h: -2.4,
  openInterestChangeSource: 'ACTUAL',
  futuresVolume24h: 941_200_000,
  longLiquidations24h: 1_200_000,
  shortLiquidations24h: 800_000,
  basisPct: 0.2096,
};

const candles = (): OHLCV[] =>
  Array.from({ length: 220 }, (_, i) => ({
    time: 1_726_358_400 + i * 3600,
    open: 148, high: 149.5, low: 146.5,
    close: 148 * (1 + Math.sin(i / 7) / 200),
    volume: 1_000 + i,
  }));

function futuresProvider(): MarketDataProvider {
  return {
    isDemo: false,
    getMarketOverview: vi.fn(),
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getAssetSnapshot: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn(async () => candles()),
    getFuturesList: vi.fn().mockResolvedValue([contract]),
    getFuturesContract: vi.fn().mockResolvedValue(contract),
    getFuturesOrderBook: vi.fn().mockResolvedValue({
      symbol: 'SOL',
      bids: [[148.2, 120]],
      asks: [[148.3, 90]],
      timestamp: Date.now(),
      provenance: { exchange: 'binance', market: 'futures', symbol: 'SOLUSDT', timestamp: Date.now(), isFallback: false },
    }),
    getLiquidations: vi.fn().mockRejectedValue(new Error('no stream')),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
}

function renderFuturesContract() {
  resetExchangeUniverseForTests();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    symbols: [{ symbol: 'SOL', exchangeSymbol: 'SOLUSDT', baseAsset: 'SOL' }],
    fetchedAt: new Date().toISOString(),
    stale: false,
  })));
  return render(
    <MemoryRouter initialEntries={['/futures/SOL']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={futuresProvider()}>
          <Routes><Route path="/futures/:symbol" element={<FuturesContractPage />} /></Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Futures-карточки: словарь без «Δ»', () => {
  it('деривативы печатают «Изменение OI за …» вместо «OI Δ …»', async () => {
    renderFuturesContract();

    const derivatives = await waitFor(() => {
      const node = document.querySelector('[data-qa="futures-derivatives"]');
      expect(node?.getAttribute('data-state')).toBe('ready');
      return node as HTMLElement;
    });

    expect(derivatives.querySelector('[data-qa="deriv-oi-change-1h"]')!.textContent).toContain('Изменение OI за 1 час');
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-1h"]')!.textContent).toContain('+0.80%');
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-24h"]')!.textContent).toContain('Изменение OI за 24 часа');
    expect(derivatives.querySelector('[data-qa="deriv-oi-change-24h"]')!.textContent).toContain('-2.40%');
    // Запрещённая форма не возвращается ни в карточке…
    expect(derivatives.textContent).not.toMatch(/OI Δ/);
    expect(derivatives.textContent).not.toMatch(/Δ/);
  });

  it('пользовательский текст всей страницы контракта не содержит «Δ»', async () => {
    renderFuturesContract();

    await waitFor(() => {
      expect(document.querySelector('[data-qa="futures-btc-correlation"]')?.getAttribute('data-state')).toBe('ready');
    });
    // title-атрибуты (tooltips) в textContent не попадают — проверяем именно видимый текст.
    expect(document.body.textContent).not.toContain('Δ');
  });

  it('корреляция и бета подписаны словами; ρ/β живут только в tooltip', async () => {
    renderFuturesContract();

    await waitFor(() => {
      expect(document.querySelector('[data-qa="futures-btc-correlation"]')?.getAttribute('data-state')).toBe('ready');
    });

    const rhoCell = document.querySelector('[data-qa="correlation-rho"]')!;
    const betaCell = document.querySelector('[data-qa="correlation-beta"]')!;
    expect(rhoCell.textContent).toContain('Корреляция');
    expect(rhoCell.textContent).not.toContain('ρ');
    expect(betaCell.textContent).toContain('Бета');
    expect(betaCell.textContent).not.toContain('β');
    // Символы доступны в пояснении (title) — пользователь не угадывает их вслепую.
    expect(rhoCell.querySelector('[title]')?.getAttribute('title')).toContain('ρ');
    expect(betaCell.querySelector('[title]')?.getAttribute('title')).toContain('β');
  });
});

/* ============================ RUNTIME: таблица фьючерсов ============================ */

describe('Futures-таблица: колонки без «Δ»', () => {
  it('сортируемые колонки называются «Изм. OI 1ч/24ч»', async () => {
    resetExchangeUniverseForTests();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ symbols: [], contracts: [], assets: {} }) })));
    render(
      <MemoryRouter initialEntries={['/futures']}>
        <ThemeProvider>
          <MarketDataProviderComponent customProvider={futuresProvider()}>
            <FuturesPage />
          </MarketDataProviderComponent>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-qa="futures-row"]').length).toBeGreaterThan(0);
    });
    const tableText = document.body.textContent ?? '';
    expect(tableText).toContain('Изм. OI 1ч');
    expect(tableText).toContain('Изм. OI 24ч');
    expect(tableText).not.toContain('Δ');
  });
});

/* ============================ RUNTIME: подписи алертов ============================ */

describe('подписи условий алертов', () => {
  it('OI_SPIKE описан словами, без «Δ»', () => {
    expect(conditionLabelRu('OI_SPIKE')).toBe('изм. OI за 1ч ≥');
    expect(conditionLabelRu('OI_SPIKE')).not.toContain('Δ');
  });
});

/* ============================ STATIC: запрет «Δ» в label-поверхностях ============================ */

/** Рекурсивный обход src/ за исключением генерированного контента статей. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !entry.includes('articlesIndex.generated')) {
      out.push(full);
    }
  }
  return out;
}

describe('исходники: «Δ» не встречается в пользовательских label-поверхностях', () => {
  const SRC_ROOT = resolve(process.cwd(), 'src');

  // Пользовательские поверхности, где символ попадает на экран.
  const SURFACE_PATTERNS: Array<[name: string, re: RegExp]> = [
    ['label: / label= значения', /label(?::|=)\s*[`'"][^`'"]*Δ/],
    ['sublabel значения', /sublabel(?::|=)\s*[`'"][^`'"]*Δ/],
    ['<th> заголовки таблиц', /<th[^>]*>\s*[^<]*Δ/],
    ['<option> пункты выбора', /<option[^>]*>[^<]*Δ/],
    ['JSX-текст узлов', />[^<>{}]*Δ[^<>{}]*</],
    ['title-атрибуты', /title=\{?[`'"][^`'"]*Δ/],
  ];

  it('ни один файл src/ не содержит «Δ» в этих поверхностях', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        // Строки-комментарии (// и *) — внутренняя нотация, разрешено.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        for (const [name, re] of SURFACE_PATTERNS) {
          if (re.test(line)) offenders.push(`${file.replace(SRC_ROOT + '/', '')}:${index + 1} — ${name}: ${trimmed.trim()}`);
        }
      });
    }
    expect(offenders, `Найден «Δ» в пользовательских подписях:\n${offenders.join('\n')}`).toEqual([]);
  });
});
