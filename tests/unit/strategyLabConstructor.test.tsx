/**
 * CRYPTORA — Strategy Lab · Тесты Конструктора и числовых полей (Phase 2A)
 * ---------------------------------------------------------------------------
 * Проверяют:
 *  1. LabNumericInput: стирание значения (""), промежуточный ввод ("1.", "1.5"), валидация на blur.
 *  2. LabConstructor: рендер индикаторов, добавление EMA/ATR, настройка правил, стопа и цели.
 *  3. StrategyLabPage: порядок элементов, верхние кнопки, disabled подсказки, data-lab-tutorial.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LabNumericInput } from '@/components/strategyLab/LabNumericInput';
import { LabConstructor } from '@/components/strategyLab/LabConstructor';
import { LabControls } from '@/components/strategyLab/LabControls';
import { defaultDraftDefinition } from '@/services/strategyLab/registry';
import type { StrategyDraftDefinition } from '@/services/strategyLab/types';
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

describe('Strategy Lab · LabConstructor', () => {
  function ConstructorHarness() {
    const [def, setDef] = useState<StrategyDraftDefinition>(() => defaultDraftDefinition('Тестовая стратегия'));
    return <LabConstructor definition={def} onChange={setDef} />;
  }

  it('рендерит секции ИНДИКАТОРЫ, ЛОГИКА СТРАТЕГИИ, СТОП И ЦЕЛЬ на русском языке', () => {
    render(<ConstructorHarness />);
    expect(screen.getByText('ИНДИКАТОРЫ')).toBeInTheDocument();
    expect(screen.getByText('ЛОГИКА СТРАТЕГИИ')).toBeInTheDocument();
    expect(screen.getByText('СТОП И ЦЕЛЬ')).toBeInTheDocument();
    expect(screen.getByText('Условие LONG')).toBeInTheDocument();
    expect(screen.getByText('Условие SHORT')).toBeInTheDocument();
  });

  it('содержит обязательные атрибуты data-lab-tutorial', () => {
    render(<ConstructorHarness />);
    expect(screen.getByLabelText('Название стратегии')).toHaveAttribute('data-lab-tutorial', 'strategy-name');
    expect(screen.getByText('ИНДИКАТОРЫ').closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'indicator-settings'
    );
    expect(screen.getByRole('button', { name: /\+ EMA/i })).toHaveAttribute('data-lab-tutorial', 'add-indicator');
    expect(screen.getByText('Условие LONG').closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'long-rule'
    );
    expect(screen.getByText('Условие SHORT').closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'short-rule'
    );
    expect(screen.getByText('Стоп-лосс (SL)').closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'stop'
    );
    expect(screen.getByText('Цель (TP)').closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'target'
    );
  });

  it('позволяет добавлять дополнительные EMA индикаторы', async () => {
    render(<ConstructorHarness />);
    const addEmaBtn = screen.getByRole('button', { name: /\+ EMA/i });
    fireEvent.click(addEmaBtn);

    const emaBadges = screen.getAllByText('EMA');
    expect(emaBadges.length).toBe(3);
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

describe('Strategy Lab · StrategyLabPage сквозной рендер', () => {
  it('рендерит русскую страницу с компактным бейджем исследования и всеми data-lab-tutorial', () => {
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );

    // Проверяем заголовок и компактную пометку
    expect(screen.getByText('Лаборатория стратегий')).toBeInTheDocument();
    expect(screen.getByText(/Не влияет на рабочие стратегии/i)).toBeInTheDocument();
    expect(screen.queryByText(/RESEARCH ONLY/i)).not.toBeInTheDocument();

    // Проверяем tutorial цели
    expect(screen.getByRole('button', { name: /Создать стратегию/i })).toHaveAttribute(
      'data-lab-tutorial',
      'create-strategy'
    );
    expect(screen.getByRole('button', { name: /Сохранить стратегию/i })).toHaveAttribute(
      'data-lab-tutorial',
      'save-strategy'
    );
    expect(screen.getByRole('button', { name: /Мои стратегии/i })).toHaveAttribute(
      'data-lab-tutorial',
      'my-strategies'
    );
    expect(screen.getByRole('button', { name: /Запустить бэктест/i })).toHaveAttribute(
      'data-lab-tutorial',
      'run-backtest'
    );
    expect(screen.getByText('BTC/USDT').closest('button')).toHaveAttribute('data-lab-tutorial', 'symbol');
    expect(screen.getByDisplayValue('1h')).toHaveAttribute('data-lab-tutorial', 'timeframe');

    // Проверяем график (контейнер)
    expect(screen.getByText(/Запустите бэктест, чтобы построить график/i).closest('[data-lab-tutorial]')).toHaveAttribute(
      'data-lab-tutorial',
      'chart'
    );

    // Проверяем вкладки тестера
    expect(screen.getByRole('button', { name: 'ОБЗОР' })).toHaveAttribute('data-lab-tutorial', 'overview');
    expect(screen.getByRole('button', { name: 'СДЕЛКИ' })).toHaveAttribute('data-lab-tutorial', 'trades');
    expect(screen.getByRole('button', { name: 'ОТКАЗЫ' })).toHaveAttribute('data-lab-tutorial', 'rejections');
  });

  it('нажатие [Создать стратегию] сбрасывает draft к новому чистому состоянию', () => {
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );

    const nameInput = screen.getByLabelText('Название стратегии') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Моя кастомная стратегия' } });
    expect(nameInput.value).toBe('Моя кастомная стратегия');

    const createBtn = screen.getByRole('button', { name: /Создать стратегию/i });
    fireEvent.click(createBtn);

    expect(nameInput.value).toBe('Новая стратегия');
  });
});
