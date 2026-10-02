/**
 * CRYPTORA — Strategy Lab · CODE-FIRST тесты (блок-редактор удалён)
 * ---------------------------------------------------------------------------
 * Проверяют:
 *  N. LabNumericInput: стирание значения (""), промежуточный ввод ("1.", "1.5").
 *  D/E. LabIndicatorsPanel: настройка EMA и ATR, стабильные идентификаторы.
 *  A/B. StrategyLabPage: нет блок-редактора и нет выбора режима авторинга.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LabNumericInput } from '@/components/strategyLab/LabNumericInput';
import { LabIndicatorsPanel } from '@/components/strategyLab/LabIndicatorsPanel';
import { LabControls } from '@/components/strategyLab/LabControls';
import { defaultResearchDraft } from '@/services/strategyLab/draft';
import type { IndicatorDefinition } from '@/services/strategyLab/types';
import { StrategyLabPage } from '@/pages/StrategyLabPage';

// Mock auth context for admin
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@cryptora.test', role: 'admin' },
    isAdmin: true,
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock CandleChart
vi.mock('@/components/common/CandleChart', () => ({
  CandleChart: () => <div data-testid="mock-candle-chart">Mock Candle Chart</div>,
}));

// Mock SymbolPickerModal
vi.mock('@/components/common/SymbolPickerModal', () => ({
  SymbolPickerModal: () => null,
}));

// Helper component for LabNumericInput testing
function NumericInputHarness({
  initialValue = 20,
  min = 1,
  max = 1000,
  integer = false,
}: {
  initialValue?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const [val, setVal] = useState(initialValue);
  return (
    <div>
      <span data-testid="current-value">{val}</span>
      <LabNumericInput
        value={val}
        onChange={setVal}
        min={min}
        max={max}
        integer={integer}
        aria-label="numeric-field"
      />
    </div>
  );
}

describe('Strategy Lab · LabNumericInput (исправление критического бага ввода)', () => {
  it('позволяет полностью стереть число ("") во время ввода без немедленного сброса', async () => {
    render(<NumericInputHarness initialValue={20} />);
    const input = screen.getByLabelText('numeric-field') as HTMLInputElement;
    expect(input.value).toBe('20');

    // Стираем всё
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    // Вводим "5" -> "50"
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
    expect(screen.getByTestId('current-value').textContent).toBe('5');

    fireEvent.change(input, { target: { value: '50' } });
    expect(input.value).toBe('50');
    expect(screen.getByTestId('current-value').textContent).toBe('50');

    fireEvent.blur(input);
    expect(input.value).toBe('50');
  });

  it('разрешает набор дробных чисел через промежуточное "1." -> "1.5"', async () => {
    render(<NumericInputHarness initialValue={1.0} min={0.1} max={20} integer={false} />);
    const input = screen.getByLabelText('numeric-field') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '1.' } });
    expect(input.value).toBe('1.');

    fireEvent.change(input, { target: { value: '1.5' } });
    expect(input.value).toBe('1.5');
    expect(screen.getByTestId('current-value').textContent).toBe('1.5');

    fireEvent.blur(input);
    expect(input.value).toBe('1.5');
  });

  it('на blur восстанавливает валидное значение, если поле осталось пустым', async () => {
    render(<NumericInputHarness initialValue={20} min={5} max={100} integer={true} />);
    const input = screen.getByLabelText('numeric-field') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.blur(input);
    expect(Number(input.value)).toBeGreaterThanOrEqual(5);
  });
});


describe('Strategy Lab · ИНДИКАТОРЫ (единственный источник объявлений)', () => {
  function IndicatorsHarness() {
    const [draft, setDraft] = useState(() => defaultResearchDraft('Тестовая стратегия'));
    return (
      <LabIndicatorsPanel
        name={draft.name}
        indicators={draft.indicators}
        onNameChange={(name) => setDraft((p) => ({ ...p, name }))}
        onChange={(indicators: IndicatorDefinition[]) => setDraft((p) => ({ ...p, indicators }))}
      />
    );
  }

  it('рендерит секцию ИНДИКАТОРЫ со стабильными идентификаторами для кода', () => {
    render(<IndicatorsHarness />);
    expect(screen.getByText('ИНДИКАТОРЫ')).toBeInTheDocument();
    const ids = screen.getAllByText(/^(EMA|ATR)_?/, { selector: 'code' }).map((n) => n.textContent);
    expect(ids).toEqual(['EMA_FAST', 'EMA_SLOW', 'ATR_MAIN']);
    expect(screen.getAllByText('Код:').length).toBe(3);
  });

  it('D. EMA: название, период, источник Open/High/Low/Close и показ на графике', () => {
    render(<IndicatorsHarness />);
    const period = screen.getByLabelText('Период индикатора EMA_FAST') as HTMLInputElement;
    expect(period.value).toBe('20');
    fireEvent.change(period, { target: { value: '55' } });
    expect((screen.getByLabelText('Период индикатора EMA_FAST') as HTMLInputElement).value).toBe('55');

    const source = screen.getByLabelText('Источник индикатора EMA_FAST') as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.textContent)).toEqual(['Open', 'High', 'Low', 'Close']);
    fireEvent.change(source, { target: { value: 'high' } });
    expect((screen.getByLabelText('Источник индикатора EMA_FAST') as HTMLSelectElement).value).toBe('high');

    const visible = screen.getByLabelText('Показывать на графике EMA_FAST') as HTMLInputElement;
    expect(visible.checked).toBe(true);
    fireEvent.click(visible);
    expect((screen.getByLabelText('Показывать на графике EMA_FAST') as HTMLInputElement).checked).toBe(false);

    const name = screen.getByLabelText('Название индикатора EMA_FAST') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Быстрая' } });
    expect((screen.getByLabelText('Название индикатора EMA_FAST') as HTMLInputElement).value).toBe('Быстрая');
  });

  it('E. ATR: название и период настраиваются, отображение честно не предлагается', () => {
    render(<IndicatorsHarness />);
    const period = screen.getByLabelText('Период индикатора ATR_MAIN') as HTMLInputElement;
    expect(period.value).toBe('14');
    fireEvent.change(period, { target: { value: '21' } });
    expect((screen.getByLabelText('Период индикатора ATR_MAIN') as HTMLInputElement).value).toBe('21');
    expect(screen.queryByLabelText('Показывать на графике ATR_MAIN')).toBeNull();
    expect(screen.getByText(/ATR используется для расчёта стопа/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Источник индикатора ATR_MAIN')).toBeNull();
  });

  it('N. период можно полностью стереть и набрать заново', () => {
    render(<IndicatorsHarness />);
    const period = screen.getByLabelText('Период индикатора EMA_SLOW') as HTMLInputElement;
    fireEvent.focus(period);
    fireEvent.change(period, { target: { value: '' } });
    expect(period.value).toBe('');
    fireEvent.change(period, { target: { value: '2' } });
    fireEvent.change(period, { target: { value: '21' } });
    expect(period.value).toBe('21');
  });

  it('2. идентификатор виден и копируется по клику (Clipboard API + fallback)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<IndicatorsHarness />);
    const button = screen.getByLabelText('Копировать идентификатор EMA_FAST');
    expect(button).toHaveTextContent('EMA_FAST');
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('EMA_FAST');
    await screen.findByText('Скопировано');
  });

  it('2b. без Clipboard API используется fallback без падения', () => {
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    (document as unknown as { execCommand: () => boolean }).execCommand = vi.fn(() => true);
    render(<IndicatorsHarness />);
    expect(() =>
      fireEvent.click(screen.getByLabelText('Копировать идентификатор ATR_MAIN'))
    ).not.toThrow();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('1. переименование подписи не меняет идентификатор в UI', () => {
    render(<IndicatorsHarness />);
    fireEvent.change(screen.getByLabelText('Название индикатора EMA_SLOW'), {
      target: { value: 'Медленная линия' },
    });
    expect(screen.getByLabelText('Копировать идентификатор EMA_SLOW')).toBeInTheDocument();
    expect(
      (screen.getByLabelText('Название индикатора EMA_SLOW') as HTMLInputElement).value
    ).toBe('Медленная линия');
  });

  it('добавляет новые EMA и ATR индикаторы', () => {
    render(<IndicatorsHarness />);
    fireEvent.click(document.querySelector('[data-qa="lab-add-ema"]') as Element);
    fireEvent.click(document.querySelector('[data-qa="lab-add-atr"]') as Element);
    expect(document.querySelectorAll('[data-qa="lab-indicator-row"]').length).toBe(5);
  });
});

describe('Strategy Lab · LabControls (верхние кнопки и подсказки)', () => {
  it('кнопки Сохранить и Мои стратегии заблокированы с понятными русскими подсказками', () => {
    render(
      <LabControls
        value={{
          market: 'spot',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          from: '2024-01-01T00:00',
          to: '2024-01-05T00:00',
        }}
        onChange={vi.fn()}
        onNewStrategy={vi.fn()}
        onRun={vi.fn()}
        loading={false}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Сохранить стратегию/i });
    expect(saveBtn).toBeDisabled();
    expect(saveBtn).toHaveAttribute('title', 'Сохранение будет подключено следующим этапом');

    const myStrategiesBtn = screen.getByRole('button', { name: /Мои стратегии/i });
    expect(myStrategiesBtn).toBeDisabled();
    expect(myStrategiesBtn).toHaveAttribute('title', 'Мои стратегии будут подключены следующим этапом');

    const createBtn = screen.getByRole('button', { name: /Создать стратегию/i });
    expect(createBtn).not.toBeDisabled();

    const runBtn = screen.getByRole('button', { name: /Запустить бэктест/i });
    expect(runBtn).not.toBeDisabled();
  });

  it('компактно показывает покрытие локального архива рядом с датами', () => {
    render(
      <LabControls
        value={{ market: 'spot', symbol: 'BTCUSDT', timeframe: '1h', from: '', to: '' }}
        onChange={vi.fn()}
        onNewStrategy={vi.fn()}
        onRun={vi.fn()}
        loading={false}
        coverage={{
          datasetAvailable: true,
          coverageFrom: '2025-09-30T00:00:00.000Z',
          coverageTo: '2026-09-30T00:00:00.000Z',
          markets: ['spot', 'futures'],
          symbols: ['BTCUSDT'],
          timeframes: ['1h'],
          validSeries: 50,
          totalSeries: 50,
          datasetVersion: 'fixture',
          manifestGeneratedAt: '2026-09-30T01:00:00.000Z',
        }}
      />
    );
    expect(screen.getByText('История:')).toBeInTheDocument();
    expect(screen.getByText('30.09.2025 — 30.09.2026')).toBeInTheDocument();
    expect(screen.getByText('Локальный архив')).toBeInTheDocument();
  });

  it('показывает недоступность локального архива', () => {
    render(
      <LabControls
        value={{ market: 'spot', symbol: 'BTCUSDT', timeframe: '1h', from: '', to: '' }}
        onChange={vi.fn()}
        onNewStrategy={vi.fn()}
        onRun={vi.fn()}
        loading={false}
        coverage={{ datasetAvailable: false }}
      />
    );
    expect(screen.getByText('Локальный архив недоступен')).toBeInTheDocument();
  });
});


describe('A/B. Strategy Lab · code-first страница', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );

  it('рендерит ИНДИКАТОРЫ и КОД СТРАТЕГИИ без блок-редактора и без выбора режима', () => {
    renderPage();
    expect(screen.getByText('Лаборатория стратегий')).toBeInTheDocument();
    expect(screen.getByText('ИНДИКАТОРЫ')).toBeInTheDocument();
    expect(screen.getByText('КОД СТРАТЕГИИ')).toBeInTheDocument();

    // A. Блок-редактора нет
    expect(screen.queryByText(/БЛОК-СХЕМА/i)).toBeNull();
    expect(document.querySelector('.react-flow')).toBeNull();
    expect(document.querySelector('[data-qa="lab-block-canvas"]')).toBeNull();
    expect(screen.queryByText(/Показать блоками/i)).toBeNull();
    expect(screen.queryByText(/Открыть как код/i)).toBeNull();

    // B. Селектора режима нет
    expect(document.querySelector('[data-qa="lab-authoring-mode-simple"]')).toBeNull();
    expect(document.querySelector('[data-qa="lab-authoring-mode-blocks"]')).toBeNull();
    expect(screen.queryByText(/ПРОСТОЙ КОНСТРУКТОР/i)).toBeNull();
  });

  it('H. [Проверить код] подтверждает корректность стартовой стратегии', () => {
    renderPage();
    const editor = screen.getByLabelText('Код стратегии') as HTMLTextAreaElement;
    expect(editor.value).toContain('EMA_FAST');
    expect(editor.value).not.toContain('EMA(CLOSE');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить код' }));
    expect(screen.getByText('✓ Код корректен')).toBeInTheDocument();
  });

  it('G. ссылка на отсутствующий индикатор показывает русскую ошибку со строкой и столбцом', () => {
    renderPage();
    const editor = screen.getByLabelText('Код стратегии') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: editor.value.replace('EMA_SLOW', 'EMA_NOPE') } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить код' }));
    expect(screen.getByText(/Неизвестная ссылка «EMA_NOPE»/)).toBeInTheDocument();
    expect(screen.getByText(/Строка \d+, столбец \d+/)).toBeInTheDocument();
  });

  it('4. [Создать стратегию] сбрасывает индикаторы И код без устаревших остатков', () => {
    renderPage();
    const nameInput = screen.getByLabelText('Название стратегии') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Моя кастомная стратегия' } });
    const editor = screen.getByLabelText('Код стратегии') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'strategy("Старое", () => {});' } });
    fireEvent.change(screen.getByLabelText('Период индикатора EMA_FAST'), {
      target: { value: '123' },
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Создать стратегию/i }));

    expect(nameInput.value).toBe('Новая стратегия');
    const resetEditor = screen.getByLabelText('Код стратегии') as HTMLTextAreaElement;
    expect(resetEditor.value).toContain('strategy("Новая стратегия"');
    expect(resetEditor.value).toContain('EMA_FAST');
    expect(resetEditor.value).toContain('ATR_MAIN');
    expect(resetEditor.value).not.toContain('Старое');
    expect(
      (screen.getByLabelText('Период индикатора EMA_FAST') as HTMLInputElement).value
    ).toBe('20');
    // Сброс не оставляет статуса предыдущей проверки и результатов.
    expect(screen.queryByText('✓ Код корректен')).toBeNull();
    expect(screen.getByText(/Запустите бэктест, чтобы построить график/i)).toBeInTheDocument();
  });

  it('4b. сохранение честно не реализовано: кнопки заблокированы с пояснением', () => {
    renderPage();
    const save = screen.getByRole('button', { name: /Сохранить стратегию/i });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Сохранение будет подключено следующим этапом');
  });
});
