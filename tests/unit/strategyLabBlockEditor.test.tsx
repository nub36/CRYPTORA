/**
 * CRYPTORA — Strategy Lab · редактор блок-схемы: взаимодействие (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * Проверяет НАСТОЯЩИЙ узловой редактор в DOM:
 *   Q. невалидный провод не создаётся;
 *   R. мобильный сценарий: тап по выходу → тап по входу создаёт связь;
 *   S. несовместимый вход не подсвечивается и не принимает связь;
 *   T. удаление связи;
 *   U. удаление блока удаляет присоединённые связи;
 *   V. числовой параметр блока редактируется (LabNumericInput, без бага ввода);
 *   W. прежний простой конструктор продолжает работать;
 *   + палитра блоков с русскими категориями.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LabBlockEditor } from '@/components/strategyLab/blocks/LabBlockEditor';
import { StrategyLabPage } from '@/pages/StrategyLabPage';
import { createEmaTrendTemplate, cloneStrategyGraph } from '@/services/strategyLab/graph/templates';
import { validateStrategyGraph } from '@/services/strategyLab/graph/validate';
import { connectPorts, removeNode } from '@/services/strategyLab/graph/mutations';
import type { StrategyGraph } from '@/services/strategyLab/graph/types';

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

let latestGraph: StrategyGraph = createEmaTrendTemplate();

function EditorHarness({ initial }: { initial?: StrategyGraph }) {
  const [graph, setGraph] = useState<StrategyGraph>(() => initial ?? createEmaTrendTemplate());
  latestGraph = graph;
  return (
    <LabBlockEditor
      graph={graph}
      onChange={(next) => {
        latestGraph = next;
        setGraph(next);
      }}
      validation={validateStrategyGraph(graph)}
    />
  );
}

function port(nodeId: string, portId: string, direction: 'input' | 'output'): HTMLElement {
  const el = document.querySelector(
    `[data-qa="lab-block-port"][data-port-node="${nodeId}"][data-port-id="${portId}"][data-port-direction="${direction}"]`
  );
  if (!el) throw new Error(`Порт не найден: ${nodeId}.${portId} (${direction})`);
  return el as HTMLElement;
}

function nodeEl(nodeId: string): HTMLElement {
  const el = document.querySelector(`[data-qa="lab-block-node"][data-block-id="${nodeId}"]`);
  if (!el) throw new Error(`Блок не найден: ${nodeId}`);
  return el as HTMLElement;
}

function withoutEdge(edgeId: string): StrategyGraph {
  const graph = cloneStrategyGraph(createEmaTrendTemplate());
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
  return graph;
}

describe('Strategy Lab · холст блок-схемы', () => {
  it('рисует реальные блоки шаблона с портами (не статичная картинка)', () => {
    render(<EditorHarness />);
    expect(document.querySelectorAll('[data-qa="lab-block-node"]')).toHaveLength(14);
    expect(nodeEl('ema-fast').textContent).toContain('EMA');
    expect(nodeEl('long').textContent).toContain('LONG');
    expect(document.querySelectorAll('[data-qa="lab-block-canvas"]')).toHaveLength(1);
  });

  it('холст не создаёт горизонтального переполнения, порты пригодны для пальца', () => {
    render(<EditorHarness />);
    const canvas = document.querySelector('[data-qa="lab-block-canvas"]') as HTMLElement;
    expect(canvas.className).toContain('min-w-0');
    expect(canvas.className).toContain('overflow-hidden');
    expect(canvas.className).toContain('w-full');

    const handle = port('close', 'value', 'output');
    expect(parseInt(handle.style.width, 10)).toBeGreaterThanOrEqual(20);
    expect(parseInt(handle.style.height, 10)).toBeGreaterThanOrEqual(20);

    // Кнопки управления (≥36px) доступны пальцем, без hover-only функций.
    for (const qa of ['lab-add-block', 'lab-delete-node', 'lab-delete-edge']) {
      const button = document.querySelector(`[data-qa="${qa}"]`) as HTMLElement;
      expect(button.className).toMatch(/min-h-\[3[6-9]px\]|min-h-\[4\dpx\]/);
    }
  });

  it('R. мобильный сценарий: тап по выходу → тап по совместимому входу создаёт связь', () => {
    render(<EditorHarness initial={withoutEdge('e-close-fast')} />);
    expect(latestGraph.edges).toHaveLength(16);

    fireEvent.click(port('close', 'value', 'output'));
    expect(document.querySelector('[data-qa="lab-connect-hint"]')?.textContent).toContain(
      'Выберите совместимый вход'
    );
    expect(port('close', 'value', 'output').getAttribute('data-port-pending')).toBe('true');

    fireEvent.click(port('ema-fast', 'price', 'input'));
    expect(latestGraph.edges).toHaveLength(17);
    expect(
      latestGraph.edges.some(
        (e) => e.from.nodeId === 'close' && e.to.nodeId === 'ema-fast' && e.to.port === 'price'
      )
    ).toBe(true);
    expect(document.querySelector('[data-qa="lab-connect-hint"]')).toBeNull();
  });

  it('S. несовместимый вход не подсвечивается и не принимает связь', () => {
    render(<EditorHarness initial={withoutEdge('e-close-fast')} />);
    fireEvent.click(port('close', 'value', 'output'));

    expect(port('ema-fast', 'price', 'input').getAttribute('data-port-compatible')).toBe('true');
    expect(port('long', 'condition', 'input').getAttribute('data-port-compatible')).toBe('false');
    expect(port('take-profit', 'target', 'input').getAttribute('data-port-compatible')).toBe('false');
    // Занятый одиночный вход тоже не подсвечен.
    expect(port('ema-slow', 'price', 'input').getAttribute('data-port-compatible')).toBe('false');
  });

  it('Q. невалидный провод не создаётся, показывается русская ошибка', () => {
    render(<EditorHarness initial={withoutEdge('e-close-fast')} />);
    const before = latestGraph.edges.length;

    fireEvent.click(port('close', 'value', 'output'));
    fireEvent.click(port('long', 'condition', 'input'));

    expect(latestGraph.edges).toHaveLength(before);
    expect(document.querySelector('[data-qa="lab-connect-hint"]')?.textContent).toContain(
      'Нельзя соединить NUMBER_SERIES с BOOL_SERIES'
    );
  });

  it('повторный тап по активному выходу и тап по холсту отменяют режим соединения', () => {
    render(<EditorHarness />);
    fireEvent.click(port('close', 'value', 'output'));
    expect(document.querySelector('[data-qa="lab-connect-hint"]')).not.toBeNull();
    fireEvent.click(port('close', 'value', 'output'));
    expect(document.querySelector('[data-qa="lab-connect-hint"]')).toBeNull();

    fireEvent.click(port('close', 'value', 'output'));
    const pane = document.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    fireEvent.click(pane as Element);
    expect(document.querySelector('[data-qa="lab-connect-hint"]')).toBeNull();
  });

  it('T. связь удаляется: выбором в списке связей и кнопкой панели', () => {
    render(<EditorHarness />);
    const before = latestGraph.edges.length;

    // 1. Выбор связи (тот же путь, что и клик по проводу на холсте).
    const row = document.querySelector('[data-qa="lab-edge-row"][data-edge-id="e-close-fast"]');
    expect(row).not.toBeNull();
    fireEvent.click((row as HTMLElement).querySelector('button') as Element);

    const deleteEdge = document.querySelector('[data-qa="lab-delete-edge"]') as HTMLButtonElement;
    expect(deleteEdge.disabled).toBe(false);
    fireEvent.click(deleteEdge);

    expect(latestGraph.edges).toHaveLength(before - 1);
    expect(latestGraph.edges.some((e) => e.id === 'e-close-fast')).toBe(false);

    // 2. Прямое удаление связи из списка (мобильный сценарий).
    const directRow = document.querySelector(
      '[data-qa="lab-edge-row"][data-edge-id="e-close-slow"]'
    ) as HTMLElement;
    fireEvent.click(directRow.querySelector('[data-qa="lab-edge-delete"]') as Element);
    expect(latestGraph.edges).toHaveLength(before - 2);
    expect(latestGraph.edges.some((e) => e.id === 'e-close-slow')).toBe(false);
  });

  it('U. удаление блока удаляет присоединённые связи', () => {
    render(<EditorHarness />);
    fireEvent.click(nodeEl('ema-fast'));
    const deleteNode = document.querySelector('[data-qa="lab-delete-node"]') as HTMLButtonElement;
    expect(deleteNode.disabled).toBe(false);
    fireEvent.click(deleteNode);

    expect(latestGraph.nodes.some((n) => n.id === 'ema-fast')).toBe(false);
    expect(
      latestGraph.edges.some((e) => e.from.nodeId === 'ema-fast' || e.to.nodeId === 'ema-fast')
    ).toBe(false);
    // Граф без EMA Fast перестаёт быть валидным — бэктест будет заблокирован.
    expect(validateStrategyGraph(latestGraph).ok).toBe(false);
    expect(document.querySelector('[data-qa="lab-graph-errors"]')).not.toBeNull();
  });

  it('V. числовой параметр блока редактируется и попадает в черновик графа', () => {
    render(<EditorHarness />);
    fireEvent.click(nodeEl('ema-fast'));
    const panel = document.querySelector('[data-qa="lab-block-params"]') as HTMLElement;
    expect(panel.getAttribute('data-block-id')).toBe('ema-fast');

    const input = within(panel).getByLabelText('EMA: Период') as HTMLInputElement;
    expect(input.value).toBe('20');

    // Поле можно полностью очистить (баг ввода чисел не возвращается).
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);

    expect(latestGraph.nodes.find((n) => n.id === 'ema-fast')?.params.period).toBe(9);
    expect(nodeEl('ema-fast').textContent).toContain('9');
  });

  it('палитра открывается кнопкой «+ Блок» и добавляет реальный блок', () => {
    render(<EditorHarness />);
    const beforeNodes = latestGraph.nodes.length;
    fireEvent.click(document.querySelector('[data-qa="lab-add-block"]') as Element);

    const palette = document.querySelector('[data-qa="lab-block-palette"]') as HTMLElement;
    expect(palette).not.toBeNull();
    for (const category of ['ДАННЫЕ', 'ИНДИКАТОРЫ', 'УСЛОВИЯ', 'ЗНАЧЕНИЯ', 'ДЕЙСТВИЯ', 'СДЕЛКА']) {
      expect(palette.textContent).toContain(category);
    }
    expect(palette.textContent).toContain('Цена закрытия');
    expect(palette.textContent).toContain('Тейк-профит');

    fireEvent.click(palette.querySelector('[data-qa="lab-palette-block-ATR"]') as Element);
    expect(latestGraph.nodes).toHaveLength(beforeNodes + 1);
    expect(latestGraph.nodes.at(-1)?.type).toBe('ATR');
    expect(document.querySelector('[data-qa="lab-block-palette"]')).toBeNull();
  });
});

describe('Strategy Lab · чистые операции графа', () => {
  it('Q(pure). connectPorts отклоняет несовместимые порты', () => {
    const graph = createEmaTrendTemplate();
    const result = connectPorts(
      graph,
      { nodeId: 'long', port: 'signal' },
      { nodeId: 'cross-up', port: 'a' }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INCOMPATIBLE_PORTS');
    expect(graph.edges).toHaveLength(17);
  });

  it('U(pure). removeNode не оставляет «висячих» связей', () => {
    const next = removeNode(createEmaTrendTemplate(), 'stop-risk');
    expect(next.nodes.some((n) => n.id === 'stop-risk')).toBe(false);
    expect(
      next.edges.some((e) => e.from.nodeId === 'stop-risk' || e.to.nodeId === 'stop-risk')
    ).toBe(false);
  });
});

describe('Strategy Lab · режимы авторинга', () => {
  it('W. простой конструктор остаётся рабочим и переключение режимов не ломает страницу', () => {
    render(<StrategyLabPage />);

    // По умолчанию — блок-схема.
    expect(document.querySelector('[data-qa="lab-block-canvas"]')).not.toBeNull();
    const simpleTab = document.querySelector(
      '[data-qa="lab-authoring-mode-simple"]'
    ) as HTMLButtonElement;
    const blocksTab = document.querySelector(
      '[data-qa="lab-authoring-mode-blocks"]'
    ) as HTMLButtonElement;
    expect(simpleTab.textContent).toContain('ПРОСТОЙ КОНСТРУКТОР');
    expect(blocksTab.textContent).toContain('БЛОК-СХЕМА');

    fireEvent.click(simpleTab);
    expect(document.querySelector('[data-qa="lab-block-canvas"]')).toBeNull();
    expect(screen.getByDisplayValue('EMA 20/50 Cross + ATR Stop')).toBeTruthy();
    expect(screen.getAllByText('ИНДИКАТОРЫ').length).toBeGreaterThan(0);

    fireEvent.click(blocksTab);
    expect(document.querySelector('[data-qa="lab-block-canvas"]')).not.toBeNull();
    // Черновик блок-схемы не потерялся при переключении.
    expect(screen.getByDisplayValue('EMA Trend')).toBeTruthy();
  });

  it('режим «КОД» видим, включён и открывает редактор стартового кода', () => {
    render(<StrategyLabPage />);
    const codeTab = document.querySelector('[data-qa="lab-authoring-mode-code"]') as HTMLButtonElement;
    expect(codeTab.textContent).toContain('КОД');
    expect(codeTab.disabled).toBe(false);
    fireEvent.click(codeTab);
    expect(screen.getByDisplayValue(/strategy\("EMA Trend"/)).toBeTruthy();
    expect(screen.getByLabelText('Код стратегии')).toBeTruthy();
  });
});
