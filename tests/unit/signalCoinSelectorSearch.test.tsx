/**
 * CRYPTORA — BUG A: поиск в выборе монеты не должен сбрасываться при
 * ререндере родителя.
 *
 * СИМПТОМ НА ПРОДЕ. На `/signals` при открытом попапе выбора монеты набор
 * буквы «B» приводил к «Ничего не найдено», хотя активных Spot USDT
 * инструментов ~493.
 *
 * ПРИЧИНА (доказана в реальном Chromium против прод-сборки). `SymbolPickerModal`
 * сбрасывал строку поиска в эффекте с зависимостями `[open, onClose]`, а
 * `SignalsCoinSelector` передавал `onClose` инлайн-стрелкой. Родитель
 * (`SignalsPage`) ререндерится по трём опросам — статус движка (5 с), журнал
 * (5 с), лента сигналов (60 с). Каждый ререндер создавал новую ссылку на
 * `onClose`, эффект перезапускался и делал `setQuery('')` ПОСЛЕ того, как
 * пользователь ввёл символ. Из обрывка запроса поиск не находил ничего.
 *
 * ПОЧЕМУ ЭТОТ ТЕСТ СУЩЕСТВУЕТ. В jsdom без ререндерящегося родителя баг не
 * воспроизводится: эффект запускается один раз. Тест deliberately рендерит
 * родителя, который перерисовывается на каждый тик опроса, и набирает строку
 * посимвольно между ререндерами — как это делает живой пользователь.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

import { SymbolPickerModal, PICKER_RENDER_LIMIT } from '@/components/common/SymbolPickerModal';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';

/**
 * Тесты продукта адресуют элементы через `data-qa` (как Playwright), а не через
 * `data-testid` по умолчанию: атрибут един, иначе селектор теста и селектор E2E
 * расходятся и падают уже разные вещи.
 */
const qa = (id: string) => document.querySelector(`[data-qa="${id}"]`) as HTMLElement | null;

afterEach(() => {
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  vi.unstubAllGlobals();
});

/** Подмножество реального Spot-реестра: обязательные запросы из задачи. */
const UNIVERSE = [
  'BTC', 'ETH', 'SOL', 'PEPE', '1000SHIB', 'BCH', 'BNB', 'BUSD', 'BTT', 'BAND',
  'BTCST', 'SUI', 'SEI', 'FET', 'ARB', 'NEAR', 'USDC', 'USDT',
];

function stubUniverse() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/market/universe/spot')) {
        return {
          ok: true,
          json: async () => ({
            symbols: UNIVERSE.map((s) => ({ symbol: s, exchangeSymbol: `${s}USDT`, baseAsset: s })),
          }),
        };
      }
      if (u.includes('/api/market/metadata/assets')) {
        return { ok: true, json: async () => ({ assets: {} }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
}

async function openWithUniverse() {
  stubUniverse();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<SymbolPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
  });
  return utils;
}

/** Значение строки поиска; бросает, если попап не отрисован. */
function query(): string {
  const input = qa('symbol-picker-search');
  if (!(input instanceof HTMLInputElement)) throw new Error('поле поиска не найдено');
  return input.value;
}

describe('BUG A — строка поиска переживает ререндеры родителя', () => {
  it('запрос не сбрасывается, когда родитель перерисовался', async () => {
    const { rerender } = await openWithUniverse();

    const input = qa('symbol-picker-search') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'B' } });
    });
    expect(query()).toBe('B');
    // «B» находит BTC/BCH/BNB/…
    expect(qa('symbol-picker-option-BTC')).toBeTruthy();

    // Родитель перерисовался (опрос статуса/журнала/ленты): модалка получает
    // новый пропс — именно это и сбрасывало запрос до исправления.
    await act(async () => {
      rerender(<SymbolPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
    });
    expect(query()).toBe('B');

    // Продолжение набора: BT → BTC.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'BT' } });
    });
    await act(async () => {
      rerender(<SymbolPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
    });
    expect(query()).toBe('BT');
    expect(qa('symbol-picker-option-BTC')).toBeTruthy();

    await act(async () => {
      fireEvent.change(input, { target: { value: 'BTC' } });
    });
    await act(async () => {
      rerender(<SymbolPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
    });
    expect(query()).toBe('BTC');
    expect(qa('symbol-picker-option-BTC')).toBeTruthy();
  });

  it('backspace не «съедает» запрос', async () => {
    await openWithUniverse();
    const input = qa('symbol-picker-search') as HTMLInputElement;
    for (const ch of ['B', 'T', 'C']) {
      await act(async () => {
        fireEvent.change(input, { target: { value: `${input.value}${ch}` } });
      });
    }
    expect(query()).toBe('BTC');
    await act(async () => {
      fireEvent.change(input, { target: { value: input.value.slice(0, -1) } });
    });
    expect(query()).toBe('BT');
    await act(async () => {
      fireEvent.change(input, { target: { value: input.value.slice(0, -1) } });
    });
    expect(query()).toBe('B');
    expect(qa('symbol-picker-option-BTC')).toBeTruthy();
  });

  it('регистр не важен: btc, sol, eth, 1000SHIB, pepe', async () => {
    await openWithUniverse();
    const input = qa('symbol-picker-search') as HTMLInputElement;
    for (const q of ['btc', 'sol', 'eth', '1000SHIB', 'pepe']) {
      await act(async () => {
        fireEvent.change(input, { target: { value: q } });
      });
      expect(qa(`symbol-picker-option-${q.toUpperCase()}`)).toBeTruthy();
    }
  });

  it('пара «BTC/USDT» и «btcusdt» находят свой тикер', async () => {
    await openWithUniverse();
    const input = qa('symbol-picker-search') as HTMLInputElement;

    for (const pair of ['BTC/USDT', 'btc/usdt', 'BTCUSDT', 'btc usdt', 'BTC-USDT']) {
      await act(async () => {
        fireEvent.change(input, { target: { value: pair } });
      });
      expect(query()).toBe(pair);
      expect(qa('symbol-picker-option-BTC'), `пара «${pair}» должна находить BTC`).toBeTruthy();
      expect(qa('symbol-picker-empty')).toBeNull();
    }

    // Авторитетный реестр (§16) не выдумывает инструменты: тикер вне
    // вселенной даёт честное «ничего не найдено», а не фантомную строку.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'AAA/USDT' } });
    });
    expect(query()).toBe('AAA/USDT');
    expect(qa('symbol-picker-option-AAA')).toBeNull();
    expect(qa('symbol-picker-empty')).toBeTruthy();
  });

  it('закрытие и повторное открытие снова дают пустой поиск', async () => {
    const view = (open: boolean) => (
      <SymbolPickerModal open={open} onClose={() => undefined} onSelect={() => undefined} />
    );
    const { rerender } = render(view(true));
    const input = qa('symbol-picker-search') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'BTC' } });
    });
    expect(query()).toBe('BTC');

    await act(async () => {
      rerender(view(false));
    });
    await act(async () => {
      rerender(view(true));
    });
    expect(query()).toBe('');
  });

  it('список ограничен PICKER_RENDER_LIMIT строками даже на вселенной из 493', async () => {
    const many = Array.from({ length: 493 }, (_, i) => `T${i}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/api/market/universe/spot')) {
          return {
            ok: true,
            json: async () => ({
              symbols: many.map((s) => ({ symbol: s, exchangeSymbol: `${s}USDT`, baseAsset: s })),
            }),
          };
        }
        if (u.includes('/api/market/metadata/assets')) return { ok: true, json: async () => ({ assets: {} }) };
        return { ok: false, status: 404, json: async () => ({}) };
      })
    );
    await act(async () => {
      render(<SymbolPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
    });
    const options = document.querySelectorAll('[data-picker-option]');
    expect(options.length).toBeLessThanOrEqual(PICKER_RENDER_LIMIT);
    expect(qa('symbol-picker-more')).toBeTruthy();
  });
});
