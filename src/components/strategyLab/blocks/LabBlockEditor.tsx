/**
 * CRYPTORA — Strategy Lab · редактор блок-схемы (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * Склеивает холст, палитру, панель параметров и список ошибок. Вся правка
 * графа идёт через ЧИСТЫЕ операции из `services/strategyLab/graph/mutations`,
 * поэтому поведение редактора детерминировано и тестируется без DOM.
 *
 * Соединение доступно двумя способами (§4):
 *   • мышь/палец: тянуть от выхода к входу;
 *   • тап: коснуться выхода → совместимые входы подсвечиваются → коснуться
 *     входа. Тап по пустому месту холста отменяет режим соединения.
 *
 * Невалидное соединение НЕ создаётся: и перетаскивание, и тап проходят через
 * общий валидатор (тот же, что исполняет сервер).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Link2Off, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  addBlockNode,
  connectPorts,
  moveNode,
  removeEdge,
  removeNode,
  renameGraph,
  setNodeParam,
} from '@/services/strategyLab/graph/mutations';
import { listCompatibleInputs } from '@/services/strategyLab/graph/validate';
import { createEmaTrendTemplate } from '@/services/strategyLab/graph/templates';
import { BLOCK_REGISTRY } from '@/services/strategyLab/graph/registry';
import { GRAPH_LIMITS } from '@/services/strategyLab/graph/types';
import type {
  BlockType,
  GraphEndpoint,
  GraphPosition,
  GraphValidationResult,
  PortDirection,
  StrategyGraph,
} from '@/services/strategyLab/graph/types';
import { LabBlockCanvas } from './LabBlockCanvas';
import { LabBlockPalette } from './LabBlockPalette';
import { LabBlockParams } from './LabBlockParams';
import { endpointHighlightKey } from './blockFlowAdapter';

export interface LabBlockEditorProps {
  graph: StrategyGraph;
  onChange: (graph: StrategyGraph) => void;
  validation: GraphValidationResult;
  disabled?: boolean;
}

/** Детерминированная позиция нового блока — без Date.now/Math.random. */
export function nextBlockPosition(count: number): GraphPosition {
  return { x: 60 + (count % 5) * 215, y: 60 + Math.floor(count / 5) * 155 };
}

const inputCls =
  'min-h-[38px] w-full rounded-md border border-white/[0.1] bg-surface-2 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50';

export const LabBlockEditor: React.FC<LabBlockEditorProps> = ({
  graph,
  onChange,
  validation,
  disabled = false,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingFrom, setPendingFrom] = useState<GraphEndpoint | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  const highlighted = useMemo(() => {
    if (!pendingFrom) return new Set<string>();
    return new Set(listCompatibleInputs(graph, pendingFrom).map(endpointHighlightKey));
  }, [graph, pendingFrom]);

  const invalidNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of validation.errors) if (e.nodeId) ids.add(e.nodeId);
    return ids;
  }, [validation]);

  const cancelConnect = useCallback(() => {
    setPendingFrom(null);
    setHint(null);
  }, []);

  const applyConnect = useCallback(
    (from: GraphEndpoint, to: GraphEndpoint) => {
      const result = connectPorts(graph, from, to);
      if (!result.ok) {
        setHint(result.error.message);
        return false;
      }
      onChange(result.graph);
      setHint(null);
      return true;
    },
    [graph, onChange]
  );

  const handlePortTap = useCallback(
    (endpoint: GraphEndpoint, direction: PortDirection) => {
      if (disabled) return;
      if (direction === 'output') {
        if (pendingFrom && pendingFrom.nodeId === endpoint.nodeId && pendingFrom.port === endpoint.port) {
          cancelConnect();
          return;
        }
        setPendingFrom(endpoint);
        setHint('Выберите совместимый вход — подсвечены подходящие порты.');
        return;
      }
      if (!pendingFrom) {
        setHint('Сначала коснитесь выхода блока, затем входа.');
        return;
      }
      if (applyConnect(pendingFrom, endpoint)) setPendingFrom(null);
    },
    [applyConnect, cancelConnect, disabled, pendingFrom]
  );

  const handleConnectEndpoints = useCallback(
    (from: GraphEndpoint, to: GraphEndpoint) => {
      if (disabled) return;
      applyConnect(from, to);
      setPendingFrom(null);
    },
    [applyConnect, disabled]
  );

  const handleAddBlock = useCallback(
    (type: BlockType) => {
      const result = addBlockNode(graph, type, nextBlockPosition(graph.nodes.length));
      if (!result.ok) {
        setHint(result.error.message);
        setPaletteOpen(false);
        return;
      }
      onChange(result.graph);
      setSelectedNodeId(result.nodeId);
      setSelectedEdgeId(null);
      setPaletteOpen(false);
      setHint(null);
    },
    [graph, onChange]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      onChange(removeNode(graph, nodeId));
      setSelectedNodeId((cur) => (cur === nodeId ? null : cur));
      cancelConnect();
    },
    [cancelConnect, graph, onChange]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      onChange(removeEdge(graph, edgeId));
      setSelectedEdgeId((cur) => (cur === edgeId ? null : cur));
    },
    [graph, onChange]
  );

  const handleMoveNode = useCallback(
    (nodeId: string, position: GraphPosition) => {
      onChange(moveNode(graph, nodeId, position));
    },
    [graph, onChange]
  );

  const handleParamChange = useCallback(
    (nodeId: string, paramId: string, value: number) => {
      onChange(setNodeParam(graph, nodeId, paramId, value));
    },
    [graph, onChange]
  );

  const handlePaneTap = useCallback(() => {
    cancelConnect();
    setSelectedEdgeId(null);
  }, [cancelConnect]);

  const handleResetTemplate = useCallback(() => {
    onChange(createEmaTrendTemplate(graph.name || undefined));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    cancelConnect();
  }, [cancelConnect, graph.name, onChange]);

  const pendingLabel = pendingFrom
    ? `${BLOCK_REGISTRY[graph.nodes.find((n) => n.id === pendingFrom.nodeId)?.type ?? 'CLOSE'].label} → …`
    : null;

  return (
    <div className="space-y-3" data-qa="lab-block-editor">
      <div className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-slate-300">Название стратегии</span>
          <input
            type="text"
            data-qa="lab-graph-name"
            className={inputCls}
            value={graph.name}
            disabled={disabled}
            onChange={(e) => onChange(renameGraph(graph, e.target.value))}
            placeholder="Например: EMA Trend"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-qa="lab-add-block"
          onClick={() => setPaletteOpen(true)}
          disabled={disabled}
          className="flex min-h-[38px] items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 text-[13px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Блок
        </button>

        <button
          type="button"
          data-qa="lab-delete-edge"
          onClick={() => selectedEdgeId && handleDeleteEdge(selectedEdgeId)}
          disabled={disabled || !selectedEdgeId}
          className="flex min-h-[38px] items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] text-slate-200 hover:bg-white/[0.07] disabled:opacity-40"
        >
          <Link2Off className="h-4 w-4" />
          Удалить связь
        </button>

        <button
          type="button"
          data-qa="lab-delete-node"
          onClick={() => selectedNodeId && handleDeleteNode(selectedNodeId)}
          disabled={disabled || !selectedNodeId}
          className="flex min-h-[38px] items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] text-slate-200 hover:bg-white/[0.07] disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
          Удалить блок
        </button>

        <button
          type="button"
          data-qa="lab-reset-template"
          onClick={handleResetTemplate}
          disabled={disabled}
          className="flex min-h-[38px] items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] text-slate-200 hover:bg-white/[0.07] disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Шаблон EMA Trend
        </button>

        <span className="ml-auto font-mono text-[11px] text-slate-500">
          блоков {graph.nodes.length}/{GRAPH_LIMITS.maxNodes} · связей {graph.edges.length}/
          {GRAPH_LIMITS.maxEdges}
        </span>
      </div>

      {(pendingFrom || hint) && (
        <div
          data-qa="lab-connect-hint"
          className="flex flex-wrap items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[12px] text-cyan-100"
        >
          {pendingLabel && <span className="font-mono text-cyan-300">{pendingLabel}</span>}
          <span>{hint ?? 'Режим соединения активен.'}</span>
          {pendingFrom && (
            <button
              type="button"
              data-qa="lab-cancel-connect"
              onClick={cancelConnect}
              className="ml-auto min-h-[32px] rounded border border-white/[0.15] px-2 text-[12px] text-slate-200 hover:bg-white/[0.08]"
            >
              Отменить
            </button>
          )}
        </div>
      )}

      <LabBlockCanvas
        graph={graph}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        pendingFrom={pendingFrom}
        highlighted={highlighted}
        invalidNodeIds={invalidNodeIds}
        disabled={disabled}
        onPortTap={handlePortTap}
        onConnectEndpoints={handleConnectEndpoints}
        onSelectNode={setSelectedNodeId}
        onSelectEdge={setSelectedEdgeId}
        onMoveNode={handleMoveNode}
        onDeleteNode={handleDeleteNode}
        onDeleteEdge={handleDeleteEdge}
        onPaneTap={handlePaneTap}
      />

      {!validation.ok && (
        <div
          data-qa="lab-graph-errors"
          className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100"
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-200">
            <AlertTriangle className="h-4 w-4" />
            Блок-схема не готова к бэктесту
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {validation.errors.slice(0, 8).map((e, i) => (
              <li key={`${e.code}-${e.nodeId ?? e.edgeId ?? i}`}>{e.message}</li>
            ))}
          </ul>
          {validation.errors.length > 8 && (
            <div className="mt-1 text-rose-300">Ещё ошибок: {validation.errors.length - 8}</div>
          )}
        </div>
      )}

      {/*
        Список связей — мобильная альтернатива попаданию пальцем в тонкий
        провод: удалить соединение можно и с телефона. На десктопе провод
        по-прежнему выделяется кликом прямо на холсте.
      */}
      {graph.edges.length > 0 && (
        <div
          data-qa="lab-edge-list"
          className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-2"
        >
          <div className="mb-1.5 px-1 text-[11px] font-bold tracking-widest text-slate-400">
            СВЯЗИ
          </div>
          <ul className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
            {graph.edges.map((edge) => {
              const fromNode = graph.nodes.find((n) => n.id === edge.from.nodeId);
              const toNode = graph.nodes.find((n) => n.id === edge.to.nodeId);
              if (!fromNode || !toNode) return null;
              const fromDef = BLOCK_REGISTRY[fromNode.type];
              const toDef = BLOCK_REGISTRY[toNode.type];
              const toPort = toDef.inputs.find((p) => p.id === edge.to.port);
              return (
                <li
                  key={edge.id}
                  data-qa="lab-edge-row"
                  data-edge-id={edge.id}
                  className={[
                    'flex items-center gap-2 rounded-md border px-2 py-1 text-[12px]',
                    selectedEdgeId === edge.id
                      ? 'border-cyan-400/50 bg-cyan-500/10'
                      : 'border-white/[0.06] bg-white/[0.02]',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-slate-300"
                    onClick={() => setSelectedEdgeId(edge.id)}
                  >
                    {fromDef.label} → {toDef.label}
                    <span className="text-slate-500"> · {toPort?.label ?? edge.to.port}</span>
                  </button>
                  <button
                    type="button"
                    data-qa="lab-edge-delete"
                    aria-label={`Удалить связь ${fromDef.label} → ${toDef.label}`}
                    disabled={disabled}
                    onClick={() => handleDeleteEdge(edge.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/15 disabled:opacity-50"
                  >
                    <Link2Off className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <LabBlockParams
        node={selectedNode}
        disabled={disabled}
        onParamChange={handleParamChange}
        onDeleteNode={handleDeleteNode}
        onClose={() => setSelectedNodeId(null)}
      />

      <LabBlockPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={handleAddBlock}
      />
    </div>
  );
};

export default LabBlockEditor;
