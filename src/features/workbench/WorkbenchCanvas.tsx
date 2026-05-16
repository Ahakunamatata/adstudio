"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  PanOnScrollMode,
  ReactFlow,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance
} from "@xyflow/react";
import { FileText, Image as ImageIcon, Maximize2, UploadCloud, Video } from "lucide-react";
import type { AgentSession, CanvasEdge, CanvasNode, CanvasNodeKind, CanvasNodeSettings } from "@/lib/domain/schemas";
import { canvasEdges as initialCanvasEdges, canvasNodes as initialCanvasNodes } from "@/lib/mock-data";
import { applyCanvasAction, findCanvasNode } from "@/features/canvas/actions";
import { AD_CANVAS_EDGE_TYPE, DraftConnectionLine, adCanvasEdgeTypes } from "@/features/canvas/CanvasEdges";
import { CanvasNodeEditorPopover } from "@/features/canvas/CanvasNodeEditorPopover";
import { adCanvasNodeTypes } from "@/features/canvas/CanvasNodeRenderer";
import { CANVAS_ACTION_EVENT } from "@/features/canvas/events";
import type { AdCanvasFlowEdge, AdCanvasFlowNode, CanvasRuntimeAction, EdgeFlowVariant } from "@/features/canvas/types";

type WorkbenchCanvasProps = {
  session: AgentSession;
  onNodeOpen: (node: CanvasNode) => void;
};

type CanvasState = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  hoveredEdgeId: string | null;
  draggingNodeId: string | null;
  connectionNodeId: string | null;
  detailNodeId: string | null;
  detailRevision: number;
};

type LocalCanvasAction =
  | CanvasRuntimeAction
  | { type: "moveNode"; nodeId: string; position: { x: number; y: number } }
  | { type: "selectNode"; nodeId: string | null }
  | { type: "setHoveredEdge"; edgeId: string | null }
  | { type: "setDraggingNode"; nodeId: string | null }
  | { type: "setConnectionNode"; nodeId: string | null };

const initialState: CanvasState = {
  nodes: initialCanvasNodes,
  edges: initialCanvasEdges,
  selectedNodeId: null,
  hoveredEdgeId: null,
  draggingNodeId: null,
  connectionNodeId: null,
  detailNodeId: null,
  detailRevision: 0
};

type CreationMenuState = {
  x: number;
  y: number;
  flowPosition: { x: number; y: number };
};

const nodeTypes = adCanvasNodeTypes;
const edgeTypes = adCanvasEdgeTypes;

function shouldSyncDetail(action: CanvasRuntimeAction) {
  return [
    "openNodeDetail",
    "updateNodeSettings",
    "updateNodeContent",
    "runNodeGeneration",
    "appendNodeVersion",
    "setPrimaryVersion",
    "lockNode",
    "markNodeStale"
  ].includes(action.type);
}

function getActionNodeId(action: CanvasRuntimeAction) {
  if ("nodeId" in action) return action.nodeId;
  return null;
}

function shouldShowGenerationPanel(kind: CanvasNodeKind) {
  return kind === "image" || kind === "video" || kind === "upload";
}

function getGenerationPanelOffset(kind: CanvasNodeKind) {
  if (kind === "video") return { x: -52, y: 264 };
  if (kind === "image") return { x: -38, y: 250 };
  return { x: -18, y: 240 };
}

function hasPath(edges: CanvasEdge[], from: string, to: string) {
  const queue = [from];
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (current === to) return true;

    visited.add(current);
    edges.filter((edge) => edge.source === current).forEach((edge) => queue.push(edge.target));
  }

  return false;
}

function getReferenceCandidates(nodes: CanvasNode[], edges: CanvasEdge[], targetNode: CanvasNode | null) {
  if (!targetNode) return [];

  const currentParentIds = new Set(edges.filter((edge) => edge.target === targetNode.id).map((edge) => edge.source));

  return nodes.filter(
    (node) =>
      node.id !== targetNode.id &&
      !currentParentIds.has(node.id) &&
      !hasPath(edges, targetNode.id, node.id)
  );
}

function canvasReducer(state: CanvasState, action: LocalCanvasAction): CanvasState {
  if (action.type === "moveNode") {
    return {
      ...state,
      nodes: state.nodes.map((node) => (node.id === action.nodeId ? { ...node, position: action.position } : node))
    };
  }

  if (action.type === "selectNode") {
    return {
      ...state,
      selectedNodeId: action.nodeId
    };
  }

  if (action.type === "setHoveredEdge") {
    return {
      ...state,
      hoveredEdgeId: action.edgeId
    };
  }

  if (action.type === "setDraggingNode") {
    return {
      ...state,
      draggingNodeId: action.nodeId
    };
  }

  if (action.type === "setConnectionNode") {
    return {
      ...state,
      connectionNodeId: action.nodeId
    };
  }

  const result = applyCanvasAction(state.nodes, state.edges, action);
  const actionNodeId = getActionNodeId(action);
  const selectedNodeId = result.selectedNodeId ?? (action.type === "openNodeDetail" ? action.nodeId : state.selectedNodeId);
  const detailNodeId = shouldSyncDetail(action)
    ? result.changedNodeId ?? result.selectedNodeId ?? actionNodeId ?? state.detailNodeId
    : state.detailNodeId;

  return {
    nodes: result.nodes,
    edges: result.edges,
    selectedNodeId,
    hoveredEdgeId: state.hoveredEdgeId,
    draggingNodeId: state.draggingNodeId,
    connectionNodeId: state.connectionNodeId,
    detailNodeId,
    detailRevision: detailNodeId ? state.detailRevision + 1 : state.detailRevision
  };
}

function buildFlowNodes(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedNodeId: string | null,
  handlers: {
    onCreateFromNode: (nodeId: string, kind: CanvasNodeKind) => void;
    onLockNode: (nodeId: string) => void;
    onOpenNode: (nodeId: string) => void;
    onUpdateNodeSettings: (
      nodeId: string,
      title: string,
      output: string,
      model: string,
      settings?: CanvasNodeSettings
    ) => void;
    onRunNode: (nodeId: string) => void;
    onSetPrimaryVersion: (nodeId: string, versionId: string) => void;
  }
): AdCanvasFlowNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return nodes.map((node) => {
    const parentTitles = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => nodeMap.get(edge.source)?.title)
      .filter((title): title is string => Boolean(title));
    const parentRefs = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => nodeMap.get(edge.source))
      .filter((parent): parent is CanvasNode => Boolean(parent))
      .map((parent) => ({
        id: parent.id,
        title: parent.title,
        kind: parent.kind,
        previewClass: parent.previewClass,
        status: parent.status
      }));

    return {
      id: node.id,
      type: "adCanvasNode",
      position: node.position,
      selected: selectedNodeId === node.id,
      data: {
        canvasNode: node,
        parentTitles,
        parentRefs,
        ...handlers
      }
    };
  });
}

function buildFlowEdges(
  edges: CanvasEdge[],
  nodes: CanvasNode[],
  uiState: {
    selectedNodeId: string | null;
    hoveredEdgeId: string | null;
    draggingNodeId: string | null;
    connectionNodeId: string | null;
  }
): AdCanvasFlowEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return edges.map((edge) => {
    const target = nodeMap.get(edge.target);
    const stale = target?.status === "stale";
    const connectedToSelection = edge.source === uiState.selectedNodeId || edge.target === uiState.selectedNodeId;
    const hovered = edge.id === uiState.hoveredEdgeId;
    const draggingAdjacent = edge.source === uiState.draggingNodeId || edge.target === uiState.draggingNodeId;
    const draftAdjacent = edge.source === uiState.connectionNodeId || edge.target === uiState.connectionNodeId;
    const flowVariant: EdgeFlowVariant = stale
      ? "stale"
      : hovered
        ? "hovered"
        : draggingAdjacent || draftAdjacent
          ? "draft"
          : connectedToSelection
            ? "connected"
            : "idle";

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: "output",
      targetHandle: "input",
      type: AD_CANVAS_EDGE_TYPE,
      className: [
        "ad-canvas-edge",
        connectedToSelection ? "is-connected" : "",
        hovered ? "is-hovered" : "",
        draggingAdjacent ? "is-dragging-adjacent" : "",
        draftAdjacent ? "is-draft-adjacent" : "",
        stale ? "is-stale" : ""
      ]
        .filter(Boolean)
        .join(" "),
      style: {
        stroke: stale
          ? "rgba(255, 184, 62, 0.82)"
          : hovered
            ? "rgba(228, 235, 248, 0.98)"
            : draftAdjacent || draggingAdjacent
              ? "rgba(160, 171, 191, 0.9)"
              : connectedToSelection
                ? "rgba(149, 158, 178, 0.9)"
                : "rgba(134, 144, 156, 0.9)",
        strokeWidth: hovered ? 2.45 : connectedToSelection ? 2.05 : 2
      },
      data: {
        label: edge.label,
        flowVariant
      }
    };
  });
}

function mergeFlowNodes(currentNodes: AdCanvasFlowNode[], nextNodes: AdCanvasFlowNode[]) {
  const currentNodeMap = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentNodeMap.get(nextNode.id);
    if (!currentNode) return nextNode;

    return {
      ...currentNode,
      ...nextNode,
      data: nextNode.data,
      selected: nextNode.selected,
      position: currentNode.position ?? nextNode.position
    };
  });
}

function CanvasHud({
  staleCount,
  runningCount,
  onToggleMiniMap
}: {
  staleCount: number;
  runningCount: number;
  onToggleMiniMap: () => void;
}) {
  const { zoom } = useViewport();
  const reactFlow = useReactFlow();

  return (
    <div className="canvas-hud">
      <button type="button" onClick={() => reactFlow.fitView({ padding: 0.18, duration: 180 })} aria-label="Fit view">
        <Maximize2 size={14} />
      </button>
      <button type="button" onClick={onToggleMiniMap}>
        Map
      </button>
      <button type="button" onClick={() => reactFlow.zoomOut({ duration: 140 })}>
        -
      </button>
      <button type="button" onClick={() => reactFlow.zoomIn({ duration: 140 })}>
        +
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <span>{runningCount} running</span>
      <span>{staleCount} stale</span>
    </div>
  );
}

function CanvasCreateMenu({
  menu,
  onCreate,
  onClose
}: {
  menu: CreationMenuState;
  onCreate: (kind: CanvasNodeKind) => void;
  onClose: () => void;
}) {
  const options: Array<{
    kind: CanvasNodeKind;
    title: string;
    description: string;
    icon: ReactNode;
  }> = [
    { kind: "text", title: "文本", description: "脚本、广告词、提示词", icon: <FileText size={15} /> },
    { kind: "image", title: "图片", description: "宣传图、参考图、分镜图", icon: <ImageIcon size={15} /> },
    { kind: "video", title: "视频", description: "分镜视频、最终视频", icon: <Video size={15} /> },
    { kind: "upload", title: "上传", description: "素材、产品图、竞品文件", icon: <UploadCloud size={15} /> }
  ];

  return (
    <div
      className="canvas-create-menu nodrag nopan"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: menu.x, top: menu.y }}
    >
      <header>
        <span>添加节点</span>
        <button type="button" onClick={onClose} aria-label="Close add node menu">
          ×
        </button>
      </header>
      <div className="canvas-create-menu-list">
        {options.map((option) => (
          <button key={option.kind} type="button" onClick={() => onCreate(option.kind)}>
            <span>{option.icon}</span>
            <strong>{option.title}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkbenchCanvas({ session }: WorkbenchCanvasProps) {
  const [canvasState, dispatchCanvas] = useReducer(canvasReducer, initialState);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [createMenu, setCreateMenu] = useState<CreationMenuState | null>(null);
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AdCanvasFlowNode, AdCanvasFlowEdge> | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const openNodeById = useCallback((nodeId: string) => {
    setCreateMenu(null);
    dispatchCanvas({ type: "selectNode", nodeId });
  }, []);

  const createNode = useCallback((kind: CanvasNodeKind, sourceNodeId?: string, position?: { x: number; y: number }) => {
    dispatchCanvas({ type: "createNode", input: { kind, sourceNodeId, position } });
  }, []);

  const lockNode = useCallback((nodeId: string) => {
    dispatchCanvas({ type: "lockNode", nodeId });
  }, []);

  const setPrimaryVersion = useCallback((nodeId: string, versionId: string) => {
    dispatchCanvas({ type: "setPrimaryVersion", nodeId, versionId });
  }, []);

  const updateNodeSettings = useCallback(
    (nodeId: string, title: string, output: string, model: string, settings?: CanvasNodeSettings) => {
      dispatchCanvas({ type: "updateNodeSettings", nodeId, title, output, model, settings });
    },
    []
  );

  const connectParentRef = useCallback((sourceNodeId: string, targetNodeId: string) => {
    dispatchCanvas({ type: "connectNodes", source: sourceNodeId, target: targetNodeId });
  }, []);

  const disconnectParentRef = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edge = canvasState.edges.find((item) => item.source === sourceNodeId && item.target === targetNodeId);
      if (!edge) return;
      dispatchCanvas({ type: "disconnectNodes", edgeId: edge.id });
    },
    [canvasState.edges]
  );

  const runNodeGeneration = useCallback(
    (nodeId: string) => {
      const node = findCanvasNode(canvasState.nodes, nodeId);
      if (!node || node.locked || node.status === "locked" || node.status === "running") return;

      dispatchCanvas({ type: "runNodeGeneration", nodeId });
      window.setTimeout(() => {
        dispatchCanvas({ type: "appendNodeVersion", nodeId });
      }, 900);
    },
    [canvasState.nodes]
  );

  const flowNodeHandlers = useMemo(
    () => ({
      onCreateFromNode: (nodeId: string, kind: CanvasNodeKind) => createNode(kind, nodeId),
      onLockNode: lockNode,
      onOpenNode: openNodeById,
      onUpdateNodeSettings: updateNodeSettings,
      onRunNode: runNodeGeneration,
      onSetPrimaryVersion: setPrimaryVersion
    }),
    [createNode, lockNode, openNodeById, updateNodeSettings, runNodeGeneration, setPrimaryVersion]
  );

  const baseFlowNodes = useMemo(
    () => buildFlowNodes(canvasState.nodes, canvasState.edges, canvasState.selectedNodeId, flowNodeHandlers),
    [
      canvasState.nodes,
      canvasState.edges,
      canvasState.selectedNodeId,
      flowNodeHandlers
    ]
  );

  const [flowNodeSnapshots, setFlowNodeSnapshots] = useState<AdCanvasFlowNode[]>([]);
  const flowNodes = useMemo(() => mergeFlowNodes(flowNodeSnapshots, baseFlowNodes), [flowNodeSnapshots, baseFlowNodes]);
  const selectedFlowNode = useMemo(
    () => flowNodes.find((node) => node.id === canvasState.selectedNodeId) ?? null,
    [flowNodes, canvasState.selectedNodeId]
  );
  const selectedCanvasNode = selectedFlowNode?.data.canvasNode ?? null;
  const selectedReferenceCandidates = useMemo(
    () => getReferenceCandidates(canvasState.nodes, canvasState.edges, selectedCanvasNode),
    [canvasState.nodes, canvasState.edges, selectedCanvasNode]
  );

  const flowEdges = useMemo(
    () =>
      buildFlowEdges(canvasState.edges, canvasState.nodes, {
        selectedNodeId: canvasState.selectedNodeId,
        hoveredEdgeId: canvasState.hoveredEdgeId,
        draggingNodeId: canvasState.draggingNodeId,
        connectionNodeId: canvasState.connectionNodeId
      }),
    [
      canvasState.edges,
      canvasState.nodes,
      canvasState.selectedNodeId,
      canvasState.hoveredEdgeId,
      canvasState.draggingNodeId,
      canvasState.connectionNodeId
    ]
  );
  const staleCount = canvasState.nodes.filter((node) => node.status === "stale").length;
  const runningCount = canvasState.nodes.filter((node) => node.status === "running").length;
  const totalCost = canvasState.nodes.reduce((sum, node) => {
    const value = Number.parseInt(node.cost, 10);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  useEffect(() => {
    function handleCanvasEvent(event: Event) {
      const action = (event as CustomEvent<CanvasRuntimeAction>).detail;
      if (!action) return;
      if (action.type === "runNodeGeneration") {
        runNodeGeneration(action.nodeId);
        return;
      }
      dispatchCanvas(action);
    }

    window.addEventListener(CANVAS_ACTION_EVENT, handleCanvasEvent);
    return () => window.removeEventListener(CANVAS_ACTION_EVENT, handleCanvasEvent);
  }, [runNodeGeneration]);

  const handleNodesChange = useCallback((changes: NodeChange<AdCanvasFlowNode>[]) => {
    setFlowNodeSnapshots((currentNodes) => applyNodeChanges(changes, mergeFlowNodes(currentNodes, baseFlowNodes)));
  }, [baseFlowNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange<AdCanvasFlowEdge>[]) => {
    changes.forEach((change) => {
      if (change.type === "remove") {
        dispatchCanvas({ type: "disconnectNodes", edgeId: change.id });
      }
    });
  }, []);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setCreateMenu(null);
    dispatchCanvas({ type: "connectNodes", source: connection.source, target: connection.target });
  }, []);

  const handlePaneDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!reactFlowInstance || !shellRef.current) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(".react-flow__node") ||
        target.closest(".react-flow__edge") ||
        target.closest(".ad-node-generation-panel") ||
        target.closest(".canvas-create-menu")
      ) {
        return;
      }

      const bounds = shellRef.current.getBoundingClientRect();
      setCreateMenu({
        x: Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(bounds.width - 264, 12)),
        y: Math.min(Math.max(event.clientY - bounds.top, 12), Math.max(bounds.height - 336, 12)),
        flowPosition: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      });
      dispatchCanvas({ type: "selectNode", nodeId: null });
    },
    [reactFlowInstance]
  );

  const createNodeFromMenu = useCallback(
    (kind: CanvasNodeKind) => {
      if (!createMenu) return;
      createNode(kind, undefined, createMenu.flowPosition);
      setCreateMenu(null);
    },
    [createMenu, createNode]
  );

  const generationPanelStyle = selectedCanvasNode && selectedFlowNode && shouldShowGenerationPanel(selectedCanvasNode.kind)
    ? {
        transform: `translate(${selectedFlowNode.position.x + getGenerationPanelOffset(selectedCanvasNode.kind).x}px, ${
          selectedFlowNode.position.y + getGenerationPanelOffset(selectedCanvasNode.kind).y
        }px)`
      }
    : undefined;

  return (
    <div className="canvas-area ad-workbench-canvas">
      <div className="canvas-toolbar">
        <div className="canvas-title">
          <strong>
            {session.product} {session.mode === "clone" ? "竞品复刻" : "从 0 生成"} Canvas
          </strong>
          <span>
            {canvasState.nodes.length} nodes · {canvasState.edges.length} links · {totalCost} credits
          </span>
        </div>
        <div className="canvas-actions">
          <button className="icon-btn" aria-label="Add text node" type="button" onClick={() => createNode("text")}>
            <FileText size={16} />
          </button>
          <button className="icon-btn" aria-label="Add image node" type="button" onClick={() => createNode("image")}>
            <ImageIcon size={16} />
          </button>
          <button className="icon-btn" aria-label="Add video node" type="button" onClick={() => createNode("video")}>
            <Video size={16} />
          </button>
          <button className="icon-btn" aria-label="Add upload node" type="button" onClick={() => createNode("upload")}>
            <UploadCloud size={16} />
          </button>
        </div>
      </div>

      <div className={`ad-canvas-shell ${canvasPanning ? "is-panning" : ""}`} ref={shellRef} onDoubleClick={handlePaneDoubleClick}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => setReactFlowInstance(instance)}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={(_, node) => openNodeById(node.id)}
          onNodeDragStart={(_, node) => dispatchCanvas({ type: "setDraggingNode", nodeId: node.id })}
          onNodeDragStop={(_, node) => {
            dispatchCanvas({ type: "moveNode", nodeId: node.id, position: node.position });
            dispatchCanvas({ type: "setDraggingNode", nodeId: null });
          }}
          onEdgeMouseEnter={(_, edge) => dispatchCanvas({ type: "setHoveredEdge", edgeId: edge.id })}
          onEdgeMouseLeave={() => dispatchCanvas({ type: "setHoveredEdge", edgeId: null })}
          onEdgeClick={(event, edge) => {
            event.stopPropagation();
            setCreateMenu(null);
            dispatchCanvas({ type: "disconnectNodes", edgeId: edge.id });
          }}
          onPaneClick={() => {
            setCreateMenu(null);
            dispatchCanvas({ type: "selectNode", nodeId: null });
          }}
          onConnectStart={(_, params) => {
            setCreateMenu(null);
            dispatchCanvas({ type: "setConnectionNode", nodeId: params.nodeId ?? null });
          }}
          onConnectEnd={() => dispatchCanvas({ type: "setConnectionNode", nodeId: null })}
          onMoveStart={() => setCanvasPanning(true)}
          onMoveEnd={() => setCanvasPanning(false)}
          connectionLineComponent={DraftConnectionLine}
          defaultViewport={{ x: 54, y: 112, zoom: 0.58 }}
          minZoom={0.35}
          maxZoom={1.7}
          fitViewOptions={{ padding: 0.18 }}
          panOnDrag
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          panOnScrollSpeed={0.82}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          nodesFocusable={false}
          edgesFocusable={false}
          connectionRadius={26}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(244, 241, 232, 0.18)" />
          {selectedCanvasNode && selectedFlowNode && generationPanelStyle ? (
            <ViewportPortal>
              <CanvasNodeEditorPopover
                key={`${selectedCanvasNode.id}-${selectedCanvasNode.primaryVersionId}-${selectedCanvasNode.version}`}
                node={selectedCanvasNode}
                parentRefs={selectedFlowNode.data.parentRefs}
                availableRefs={selectedReferenceCandidates}
                style={generationPanelStyle}
                onClose={() => dispatchCanvas({ type: "selectNode", nodeId: null })}
                onConnectParentRef={connectParentRef}
                onDisconnectParentRef={disconnectParentRef}
                onLockNode={lockNode}
                onRunNode={runNodeGeneration}
                onSetPrimaryVersion={setPrimaryVersion}
                onUpdateNodeSettings={updateNodeSettings}
              />
            </ViewportPortal>
          ) : null}
          {miniMapOpen ? <MiniMap className="ad-canvas-minimap" pannable zoomable /> : null}
          <Controls showInteractive={false} position="bottom-left" />
          <CanvasHud staleCount={staleCount} runningCount={runningCount} onToggleMiniMap={() => setMiniMapOpen((value) => !value)} />
        </ReactFlow>
        {createMenu ? <CanvasCreateMenu menu={createMenu} onCreate={createNodeFromMenu} onClose={() => setCreateMenu(null)} /> : null}
      </div>
    </div>
  );
}
