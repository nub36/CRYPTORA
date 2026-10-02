/**
 * CRYPTORA — Strategy Lab · «Помощь» (RESEARCH ONLY) coverage.
 *
 * Covers:
 *  • every Help code example compiles through the CANONICAL compiler;
 *  • permanent Help button opens a responsive role=dialog/aria-modal modal;
 *  • local search finds RSI / Order Block / BOS / FVG articles;
 *  • «Закрыть» closes the modal;
 *  • opening/closing Help never replaces or resets authoring state;
 *  • mobile-safe structure (internal scroll + viewport-capped height).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { compileResearchDraft } from '@/services/strategyLab/draft/compile';
import { RESEARCH_DRAFT_API_VERSION } from '@/services/strategyLab/draft/types';
import { collectHelpExamples, searchHelpArticles, LAB_HELP_ARTICLES } from '@/components/strategyLab/help/helpContent';
import { LabHelp } from '@/components/strategyLab/help/LabHelp';
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

describe('Strategy Lab Help · code examples compile through the canonical compiler', () => {
  it('provides a substantial validated example set', () => {
    expect(collectHelpExamples().length).toBeGreaterThanOrEqual(8);
  });

  it.each(collectHelpExamples().map((example) => [example.title, example] as const))(
    'compiles «%s» without errors',
    (_title, example) => {
      const compiled = compileResearchDraft({
        name: example.title,
        indicators: example.indicators,
        sourceCode: example.code,
        execution: { feeBps: 5, slippageBps: 2 },
        apiVersion: RESEARCH_DRAFT_API_VERSION,
      });
      expect(compiled.errors).toEqual([]);
      expect(compiled.ok).toBe(true);
      expect(compiled.definition).toBeDefined();
    }
  );

  it('covers the mandated reference topics', () => {
    const ids = LAB_HELP_ARTICLES.map((article) => article.id);
    for (const id of ['ema', 'atr', 'rsi', 'fractals', 'order-block', 'market-structure', 'fvg', 'logic', 'execution', 'no-look-ahead', 'chart', 'identifiers']) {
      expect(ids).toContain(id);
    }
  });
});

describe('Strategy Lab Help · local search model', () => {
  it('finds RSI, Order Block, BOS and FVG', () => {
    expect(searchHelpArticles('RSI').map((a) => a.id)).toContain('rsi');
    expect(searchHelpArticles('Order Block').map((a) => a.id)).toContain('order-block');
    expect(searchHelpArticles('BOS').map((a) => a.id)).toContain('market-structure');
    expect(searchHelpArticles('FVG').map((a) => a.id)).toContain('fvg');
    expect(searchHelpArticles('')).toHaveLength(LAB_HELP_ARTICLES.length);
    expect(searchHelpArticles('суперсекретныйнесуществующийтермин')).toHaveLength(0);
  });
});

describe('Strategy Lab Help · modal behaviour', () => {
  it('opens an accessible dialog from the permanent button and closes via «Закрыть»', () => {
    render(<LabHelp />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Помощь' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Помощь по Лаборатории')).toBeInTheDocument();

    // Mobile-safe structure: height capped to the viewport with internal scroll.
    const frame = dialog.querySelector('.max-h-\\[90vh\\]');
    expect(frame).not.toBeNull();
    const scroller = dialog.querySelector('[data-qa="lab-help-content"]');
    expect(scroller?.className).toContain('overflow-y-auto');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('filters articles through the search field', () => {
    render(<LabHelp />);
    fireEvent.click(screen.getByRole('button', { name: 'Помощь' }));
    const search = screen.getByLabelText('Поиск по справке');

    for (const [query, articleId] of [
      ['RSI', 'rsi'],
      ['Order Block', 'order-block'],
      ['BOS', 'market-structure'],
      ['FVG', 'fvg'],
    ] as const) {
      fireEvent.change(search, { target: { value: query } });
      const dialog = screen.getByRole('dialog');
      expect(dialog.querySelector(`[data-help-article="${articleId}"]`)).not.toBeNull();
    }

    fireEvent.change(search, { target: { value: 'суперсекретныйнесуществующийтермин' } });
    expect(screen.getByRole('dialog').querySelector('[data-qa="lab-help-empty"]')).not.toBeNull();
  });
});

describe('Strategy Lab Help · page integration keeps authoring state', () => {
  it('opening and closing Help does not replace or reset the draft', () => {
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );

    // Mutate authoring state first: rename the draft and edit the code.
    const nameInput = screen.getByLabelText('Название стратегии') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Моя FVG стратегия' } });
    const codeEditor = screen.getByLabelText('Код стратегии') as HTMLTextAreaElement;
    const editedCode = '// черновик\n' + codeEditor.value;
    fireEvent.change(codeEditor, { target: { value: editedCode } });
    expect(nameInput.value).toBe('Моя FVG стратегия');
    expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Помощь' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The page under the modal stays mounted — the authoring surface is not remounted.
    expect(screen.getByLabelText('Код стратегии')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Draft, code and dirty state survive intact.
    expect((screen.getByLabelText('Название стратегии') as HTMLInputElement).value).toBe('Моя FVG стратегия');
    expect((screen.getByLabelText('Код стратегии') as HTMLTextAreaElement).value).toBe(editedCode);
    expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();
  });
});
