/**
 * CRYPTORA — Strategy Lab · холст блок-схемы (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * НАСТОЯЩИЙ узловой редактор на @xyflow/react: размещение, перетаскивание,
 * провода, выделение, удаление, панорамирование, зум, fit view и touch.
 * Это не статичная «картинка схемы».
 *
 * Холст — ТОНКИЙ слой отображения: он не хранит стратегию. Канонический
 * `StrategyGraph` приходит сверху, а любое изменение уходит наверх колбэком,
 * где применяются чистые операции из `services/strategyLab/graph/mutations`.
 *
 * Мобильность: порты имеют крупную зону нажатия, работает tap-to-connect,
 * а контейнер ограничен по ширине (`min-w-0`, `overflow-hidden`) — холст не
 * создаёт горизонтального скролла страницы.
 */

import React, { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  GraphEndpoint,
  GraphPosition,
  PortDirection,
  StrategyGraph,
} from '@/services/strategyLab/graph/types';
import { canConnect } from '@/services/strategyLab/graph/validate';
import {
  connectionToEndpoints,
  graphToFlowEdges,
  graphToFlowNodes,
  LAB_BLOCK_NODE_TYPE,
  type LabBlockFlowNode,
} from './blockFlowAdapter';
import { BlockInteractionContext, LabBlockNode } from './LabBlockNode';

const nodeTypes: NodeTypes = { [LAB_BLOCK_NODE_TYPE]: LabBlockNode };

export interface LabBlockCanvasProps {
  graph: StrategyGraph;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  pendingFrom: GraphEndpoint | null;
  highlighted: ReadonlySet<string>;
  invalidNodeIds: ReadonlySet<string>;
  disabled?: boolean;
  onPortTap: (endpoint: GraphEndpoint, direction: PortDirection) => void;
  onConnectEndpoints: (from: GraphEndpoint, to: GraphEndpoint) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onMoveNode: (nodeId: string, position: GraphPosition) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onPaneTap: () => void;
}

export const LabBlockCanvas: React.FC<LabBlockCanvasProps> = ({
  graph,
  selectedNodeId,
  selectedEdgeId,
  pendingFrom,
  highlighted,
  invalidNodeIds,
  disabled = false,
  onPortTap,
  onConnectEndpoints,
  onSelectNode,
  onSelectEdge,
  onMoveNode,
  onDeleteNode,
  onDeleteEdge,
  onPaneTap,
}) => {
  const nodes = useMemo(
    () => graphToFlowNodes(graph, { selectedNodeId, invalidNodeIds }),
    [graph, selectedNodeId, invalidNodeIds]
  );
  const edges = useMemo(() => graphToFlowEdges(graph, { selectedEdgeId }), [graph, selectedEdgeId]);

  const interaction = useMemo(
    () => ({ pendingFrom, highlighted, onPortTap, disabled }),
    [pendingFrom, highlighted, onPortTap, disabled]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<LabBlockFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          onMoveNode(change.id, change.position);
        } else if (change.type === 'select') {
          onSelectNode(change.selected ? change.id : null);
        } else if (change.type === 'remove') {
          onDeleteNode(change.id);
        }
      }
    },
    [onMoveNode, onSelectNode, onDeleteNode]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const change of changes) {
        if (change.type === 'select') {
          onSelectEdge(change.selected ? change.id : null);
        } else if (change.type === 'remove') {
          onDeleteEdge(change.id);
        }
      }
    },
    [onSelectEdge, onDeleteEdge]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const endpoints = connectionToEndpoints(connection);
      if (!endpoints) return;
      onConnectEndpoints(endpoints.from, endpoints.to);
    },
    [onConnectEndpoints]
  );

  /** Невалидное соединение не создаётся вообще (§7): его нельзя даже «бросить». */
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      const endpoints = connectionToEndpoints(connection as Connection);
      if (!endpoints) return false;
      return canConnect(graph, endpoints.from, endpoints.to) === null;
    },
    [graph]
  );

  return (
    <div
      data-qa="lab-block-canvas"
      className="lab-block-canvas relative h-[420px] w-full min-w-0 overflow-hidden rounded-lg border border-white/[0.08] bg-surface-inset sm:h-[520px]"
    >
      {/*
       * Провайдер оборачивает САМ ReactFlow: узлы отрисовываются внутри его
       * поддерева, поэтому контекст взаимодействия должен быть снаружи.
       */}
      <BlockInteractionContext.Provider value={interaction}>
        <ReactFlow<LabBlockFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onEdgeClick={(_event, edge) => onSelectEdge(edge.id)}
          isValidConnection={isValidConnection}
          onPaneClick={onPaneTap}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={!disabled}
          nodesConnectable={!disabled}
          elementsSelectable
          /* Собственный tap-to-connect с подсветкой совместимых входов (§4). */
          connectOnClick={false}
          panOnDrag
          panOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
          <Controls
            showInteractive={false}
            className="lab-block-canvas__controls"
            aria-label="Масштаб и подгонка холста"
          />
        </ReactFlow>
      </BlockInteractionContext.Provider>
    </div>
  );
};

export default LabBlockCanvas;
