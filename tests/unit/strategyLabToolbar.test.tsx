/**
 * CRYPTORA — Strategy Lab · верхняя панель «СТРАТЕГИЯ» (mobile UX hotfix)
 * ---------------------------------------------------------------------------
 * Проверяет:
 *  - «Настройки индикаторов» доступны в верхней панели рядом с workflow
 *    сохранения (Сохранить / Сохранить как... / Помощь), без прокрутки
 *    мимо контролов рынка, графика и кода;
 *  - клик открывает ТОТ ЖЕ модал с реальным редактором индикаторов;
 *  - редактор индикаторов существует в ЕДИНСТВЕННОМ экземпляре (только модал);
 *  - read-only сводка индикаторов отражает текущий черновик и обновляется;
 *  - «Помощь» остаётся доступной;
 *  - легаси-кнопки старого workflow сохранения не рендерятся;
 *  - структура безопасна для mobile (flex-wrap / break-words, без фиксированных
 *    широких элементов в панели).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrategyLabPage } from '@/pages/StrategyLabPage';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@cryptora.test', role: 'admin' },
    isAdmin: true,
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/common/CandleChart', () => ({
  CandleChart: () => <div data-testid="mock-candle-chart">Mock Candle Chart</div>,
}));

vi.mock('@/components/common/SymbolPickerModal', () => ({
  SymbolPickerModal: () => null,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <StrategyLabPage />
    </MemoryRouter>
  );

const summaryText = () =>
  document.querySelector('[data-qa="lab-indicator-summary"]')?.textContent ?? '';

describe('Strategy Lab · «Настройки индикаторов» в верхней панели', () => {
  it('кнопка одна, расположена в панели «СТРАТЕГИЯ» рядом с Сохранить/Сохранить как/Помощь', () => {
    renderPage();

    const openButtons = screen.getAllByRole('button', { name: 'Настройки индикаторов' });
    expect(openButtons).toHaveLength(1);
    const openButton = openButtons[0];
    expect(openButton).toHaveAttribute('data-qa', 'lab-open-indicators');

    // Та же строка действий, что и единый workflow сохранения + Помощь.
    const actionsRow = openButton.closest('div') as HTMLElement;
    expect(within(actionsRow).getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
    expect(within(actionsRow).getByRole('button', { name: 'Сохранить как...' })).toBeInTheDocument();
    expect(within(actionsRow).getByRole('button', { name: 'Помощь' })).toBeInTheDocument();
    // Мобильная безопасность: строка действий переносит кнопки, а не расползается вширь.
    expect(actionsRow.className).toContain('flex-wrap');

    // Панель «СТРАТЕГИЯ» целиком: селектор и + Новая рядом (вертикальная близость в DOM).
    const card = actionsRow.parentElement as HTMLElement;
    expect(within(card).getByRole('combobox', { name: 'Мои стратегии' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '+ Новая' })).toBeInTheDocument();
  });

  it('клик открывает ТОТ ЖЕ модал с реальным редактором; редактор существует только в модале', () => {
    renderPage();

    // До открытия: ни одной строки редактора индикаторов в документе.
    expect(document.querySelectorAll('[data-qa="lab-indicator-row"]')).toHaveLength(0);
    expect(document.querySelector('[data-qa="lab-add-ema"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Настройки индикаторов' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Настройки индикаторов' })).toBeInTheDocument();

    // Реальный редактор: строки дефолтного черновика + кнопки добавления всех типов.
    expect(dialog.querySelectorAll('[data-qa="lab-indicator-row"]').length).toBe(3);
    for (const qa of ['lab-add-ema', 'lab-add-atr', 'lab-add-rsi', 'lab-add-fractals', 'lab-add-market-structure', 'lab-add-fvg', 'lab-add-order-block']) {
      expect(dialog.querySelector(`[data-qa="${qa}"]`)).not.toBeNull();
    }

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // После закрытия редактора снова нет: ОДИН редактор, и он живёт в модале.
    expect(document.querySelectorAll('[data-qa="lab-indicator-row"]')).toHaveLength(0);
  });

  it('сводка индикаторов отражает дефолтный черновик и переносится безопасно', () => {
    renderPage();
    expect(summaryText()).toContain('ИНДИКАТОРЫ:');
    expect(summaryText()).toContain('EMA 20 · EMA 50 · ATR 14');
    const summary = document.querySelector('[data-qa="lab-indicator-summary"]') as HTMLElement;
    expect(summary.className).toContain('min-w-0');
    expect(summary.querySelector('.break-words')).not.toBeNull();
  });

  it('добавление индикатора в модале немедленно обновляет сводку', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки индикаторов' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.click(dialog.querySelector('[data-qa="lab-add-rsi"]') as Element);
    expect(summaryText()).toContain('RSI 14');

    fireEvent.click(dialog.querySelector('[data-qa="lab-add-fvg"]') as Element);
    expect(summaryText()).toContain('FVG');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    // Сводка сохраняет обновлённый черновик и после закрытия модала.
    expect(summaryText()).toContain('EMA 20 · EMA 50 · ATR 14 · RSI 14 · FVG');
  });

  it('редактирование периода индикатора обновляет сводку', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Период индикатора EMA_FAST'), { target: { value: '123' } });
    expect(summaryText()).toContain('EMA 123 · EMA 50 · ATR 14');
  });

  it('«Помощь» доступна из верхней панели и открывает справку', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Помощь' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Помощь по Лаборатории')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('легаси-кнопки старого workflow не рендерятся нигде на странице', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Создать стратегию/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Сохранить стратегию/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Мои стратегии$/i })).toBeNull();
    // Единственный «Мои стратегии» — реальный селектор сохранённых стратегий.
    expect(screen.getByRole('combobox', { name: 'Мои стратегии' })).toBeInTheDocument();
    // Запуск бэктеста остаётся в контролах.
    expect(screen.getByRole('button', { name: /Запустить бэктест/i })).toBeInTheDocument();
  });
});
