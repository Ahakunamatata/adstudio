"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeSelectionChange,
  type ReactFlowInstance
} from "@xyflow/react";
import { FileText, Image as ImageIcon, Maximize2, UploadCloud, Video } from "lucide-react";
import type { AgentCanvasState, AgentSession, CanvasEdge, CanvasNode, CanvasNodeKind, CanvasNodeSettings } from "@/lib/domain/schemas";
import type { CanvasSnapshot } from "@/features/agent-runtime/agent-snapshot";
import { applyCanvasAction, findCanvasNode } from "@/features/canvas/actions";
import { AD_CANVAS_EDGE_TYPE, DraftConnectionLine, adCanvasEdgeTypes } from "@/features/canvas/CanvasEdges";
import { CanvasNodeEditorPopover } from "@/features/canvas/CanvasNodeEditorPopover";
import { adCanvasNodeTypes } from "@/features/canvas/CanvasNodeRenderer";
import { CANVAS_ACTION_EVENT } from "@/features/canvas/events";
import type {
  AdCanvasFlowEdge,
  AdCanvasFlowNode,
  CanvasGenerationResult,
  CanvasRuntimeAction,
  EdgeFlowVariant
} from "@/features/canvas/types";

type WorkbenchCanvasProps = {
  session: AgentSession;
  onNodeOpen: (node: CanvasNode) => void;
  onCanvasSnapshotChange?: (snapshot: CanvasSnapshot) => void;
  onCanvasStateChange?: (state: AgentCanvasState) => void;
};

type CanvasState = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  hoveredEdgeId: string | null;
  draggingNodeId: string | null;
  connectionNodeId: string | null;
  detailNodeId: string | null;
  detailRevision: number;
};

type LocalCanvasAction =
  | CanvasRuntimeAction
  | { type: "replaceCanvasState"; state: AgentCanvasState }
  | { type: "moveNode"; nodeId: string; position: { x: number; y: number } }
  | { type: "selectNode"; nodeId: string | null }
  | { type: "selectNodes"; nodeIds: string[] }
  | { type: "setHoveredEdge"; edgeId: string | null }
  | { type: "setDraggingNode"; nodeId: string | null }
  | { type: "setConnectionNode"; nodeId: string | null };

const canvasStateStoragePrefix = "ad-studio:canvas-state:v1:";

function getCanvasStateStorageKey(sessionId: string) {
  return `${canvasStateStoragePrefix}${sessionId}`;
}

function createEmptyCanvasState(): CanvasState {
  return {
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredEdgeId: null,
    draggingNodeId: null,
    connectionNodeId: null,
    detailNodeId: null,
    detailRevision: 0
  };
}

function isPlaceholderInitialCanvasVersion(node: CanvasNode) {
  const version = node.versions[0];
  return Boolean(
    version &&
    version.version === 1 &&
    !version.providerTaskId &&
    !version.assetUrl &&
    !version.downloadUrl &&
    !version.params &&
    !version.slots?.length &&
    (version.content === "等待编辑或生成。" ||
      version.content === "等待上传或拖入素材，可作为下游输入引用。" ||
      version.content === node.input)
  );
}

function normalizeCanvasNodeVersions(node: CanvasNode): CanvasNode {
  if (node.versions.length < 2 || !isPlaceholderInitialCanvasVersion(node)) return node;

  const normalizedVersions = node.versions.slice(1).map((version, index) => {
    const nextVersion = index + 1;
    return {
      ...version,
      id: `${node.id}-v${nextVersion}`,
      version: nextVersion,
      label: `v${nextVersion}`
    };
  });
  const currentVersionIndex = node.versions.findIndex((version) => version.id === node.primaryVersionId);
  const primaryVersion = normalizedVersions[Math.max(0, currentVersionIndex - 1)] ?? normalizedVersions[0];

  return {
    ...node,
    version: primaryVersion?.version ?? node.version,
    versions: normalizedVersions,
    primaryVersionId: primaryVersion?.id ?? ""
  };
}

function normalizeCanvasState(state: CanvasState): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(normalizeCanvasNodeVersions)
  };
}

function loadPersistedCanvasState(sessionId: string): CanvasState | null {
  if (typeof window === "undefined") return null;

  try {
    const rawState = window.localStorage.getItem(getCanvasStateStorageKey(sessionId));
    if (!rawState) return null;
    const parsed = JSON.parse(rawState) as CanvasState;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return normalizeCanvasState({
      ...createEmptyCanvasState(),
      ...parsed
    });
  } catch {
    return null;
  }
}

function storeCanvasState(sessionId: string, state: CanvasState) {
  try {
    window.localStorage.setItem(getCanvasStateStorageKey(sessionId), JSON.stringify(state));
  } catch {
    // Ignore storage failures; the current canvas remains usable in memory.
  }
}

function createInitialCanvasState(session: AgentSession): CanvasState {
  const persistedState = loadPersistedCanvasState(session.id);
  const sessionState = session.canvasState
    ? {
        ...createEmptyCanvasState(),
        nodes: session.canvasState.nodes.map(normalizeCanvasNodeVersions),
        edges: session.canvasState.edges
      }
    : null;

  if (sessionState && (sessionState.nodes.length > 0 || sessionState.edges.length > 0)) {
    return sessionState;
  }

  if (persistedState && (persistedState.nodes.length > 0 || persistedState.edges.length > 0)) {
    return persistedState;
  }

  if (sessionState) {
    return {
      ...createEmptyCanvasState(),
      nodes: sessionState.nodes,
      edges: sessionState.edges
    };
  }

  return persistedState ?? createEmptyCanvasState();
}

function createPersistableCanvasState(nodes: CanvasNode[], edges: CanvasEdge[]): AgentCanvasState {
  return { nodes, edges };
}

function createCanvasSnapshot(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasSnapshot {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      businessType: node.businessType,
      title: node.title,
      status: node.status,
      locked: node.locked,
      parentNodeIds: node.parentNodeIds,
      staleReason: node.staleReason
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label
    })),
    lockedNodeIds: nodes.filter((node) => node.locked).map((node) => node.id),
    staleNodeIds: nodes.filter((node) => node.status === "stale").map((node) => node.id)
  };
}

const emptyCanvasState: CanvasState = {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],
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
  sourceNodeId?: string;
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
    "failNodeGeneration",
    "setPrimaryVersion",
    "lockNode",
    "markNodeStale"
  ].includes(action.type);
}

function getActionNodeId(action: CanvasRuntimeAction) {
  if ("nodeId" in action) return action.nodeId;
  return null;
}

function getPointerClientPosition(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }

  if ("clientX" in event && "clientY" in event) {
    return { x: event.clientX, y: event.clientY };
  }

  return null;
}

function isEditableCanvasTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function shouldShowGenerationPanel(kind: CanvasNodeKind) {
  return kind === "image" || kind === "video" || kind === "upload";
}

function isNodeSelectionChange(change: NodeChange<AdCanvasFlowNode>): change is NodeSelectionChange {
  return change.type === "select";
}

function getFlowNodeSize(kind: CanvasNodeKind, flowNode: AdCanvasFlowNode) {
  const measuredWidth = flowNode.measured?.width ?? flowNode.width;
  const measuredHeight = flowNode.measured?.height ?? flowNode.height;

  return {
    width: measuredWidth ?? (kind === "video" ? 342 : 286),
    height: measuredHeight ?? 238
  };
}

function getGenerationPanelOffset(kind: CanvasNodeKind, flowNode: AdCanvasFlowNode, panelSize: { width: number; height: number }) {
  if (kind === "upload") {
    const nodeSize = getFlowNodeSize(kind, flowNode);
    return {
      x: (nodeSize.width - panelSize.width) / 2,
      y: nodeSize.height + 12
    };
  }

  if (kind === "video") return { x: -52, y: 264 };
  if (kind === "image") return { x: -38, y: 250 };
  return { x: -18, y: 240 };
}

function getGenerationPanelSize(kind: CanvasNodeKind) {
  if (kind === "video") return { width: 1040, height: 360 };
  if (kind === "image") return { width: 960, height: 338 };
  return { width: 430, height: 128 };
}

function clampPanelAxis(value: number, min: number, max: number, size: number) {
  const availableMax = max - size;
  if (availableMax < min) return min;
  return Math.min(Math.max(value, min), availableMax);
}

function getGenerationPanelStyle({
  kind,
  flowNode,
  dragOffset,
  reactFlowInstance,
  shellElement
}: {
  kind: CanvasNodeKind;
  flowNode: AdCanvasFlowNode;
  dragOffset?: { x: number; y: number };
  reactFlowInstance: ReactFlowInstance<AdCanvasFlowNode, AdCanvasFlowEdge> | null;
  shellElement: HTMLDivElement | null;
}): CSSProperties {
  const size = getGenerationPanelSize(kind);
  const offset = getGenerationPanelOffset(kind, flowNode, size);
  const baseX = flowNode.position.x + offset.x + (dragOffset?.x ?? 0);
  const baseY = flowNode.position.y + offset.y + (dragOffset?.y ?? 0);
  const hasDragOffset = Boolean(dragOffset && (dragOffset.x || dragOffset.y));

  if (!reactFlowInstance || !shellElement || hasDragOffset) {
    return { transform: `translate(${baseX}px, ${baseY}px)` };
  }

  const bounds = shellElement.getBoundingClientRect();
  const topLeft = reactFlowInstance.screenToFlowPosition({ x: bounds.left + 14, y: bounds.top + 14 });
  const bottomRight = reactFlowInstance.screenToFlowPosition({ x: bounds.right - 14, y: bounds.bottom - 14 });
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const x = clampPanelAxis(baseX, minX, maxX, size.width);
  const y = clampPanelAxis(baseY, minY, maxY, size.height);

  return { transform: `translate(${x}px, ${y}px)` };
}

function canvasReducer(state: CanvasState, action: LocalCanvasAction): CanvasState {
  if (action.type === "replaceCanvasState") {
    return normalizeCanvasState({
      ...state,
      nodes: action.state.nodes,
      edges: action.state.edges,
      selectedNodeId: state.selectedNodeId && action.state.nodes.some((node) => node.id === state.selectedNodeId)
        ? state.selectedNodeId
        : null,
      selectedNodeIds: state.selectedNodeIds.filter((nodeId) => action.state.nodes.some((node) => node.id === nodeId)),
      detailNodeId: state.detailNodeId && action.state.nodes.some((node) => node.id === state.detailNodeId)
        ? state.detailNodeId
        : null
    });
  }

  if (action.type === "moveNode") {
    return {
      ...state,
      nodes: state.nodes.map((node) => (node.id === action.nodeId ? { ...node, position: action.position } : node))
    };
  }

  if (action.type === "selectNode") {
    return {
      ...state,
      selectedNodeId: action.nodeId,
      selectedNodeIds: action.nodeId ? [action.nodeId] : []
    };
  }

  if (action.type === "selectNodes") {
    const selectedNodeIds = Array.from(new Set(action.nodeIds));

    return {
      ...state,
      selectedNodeId: null,
      selectedNodeIds
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
  if (action.type === "deleteNodes") {
    const deletedNodeIds = new Set(action.nodeIds);

    return {
      nodes: result.nodes,
      edges: result.edges,
      selectedNodeId: null,
      selectedNodeIds: [],
      hoveredEdgeId: deletedNodeIds.size ? null : state.hoveredEdgeId,
      draggingNodeId: deletedNodeIds.has(state.draggingNodeId ?? "") ? null : state.draggingNodeId,
      connectionNodeId: deletedNodeIds.has(state.connectionNodeId ?? "") ? null : state.connectionNodeId,
      detailNodeId: deletedNodeIds.has(state.detailNodeId ?? "") ? null : state.detailNodeId,
      detailRevision: deletedNodeIds.has(state.detailNodeId ?? "") ? state.detailRevision + 1 : state.detailRevision
    };
  }

  const actionNodeId = getActionNodeId(action);
  const selectedNodeId = result.selectedNodeId ?? (action.type === "openNodeDetail" ? action.nodeId : state.selectedNodeId);
  const selectedNodeIds = selectedNodeId ? [selectedNodeId] : state.selectedNodeIds;
  const detailNodeId = shouldSyncDetail(action)
    ? result.changedNodeId ?? result.selectedNodeId ?? actionNodeId ?? state.detailNodeId
    : state.detailNodeId;

  return {
    nodes: result.nodes,
    edges: result.edges,
    selectedNodeId,
    selectedNodeIds,
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
  selectedNodeIds: string[],
  handlers: {
    onCreateFromNode: (nodeId: string, kind: CanvasNodeKind) => void;
    onRenameNode: (nodeId: string, title: string) => void;
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
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const nodeTitles = nodes.map((node) => ({ id: node.id, title: node.title }));

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
      selected: selectedNodeIdSet.has(node.id),
      data: {
        canvasNode: node,
        parentTitles,
        parentRefs,
        nodeTitles,
        ...handlers
      }
    };
  });
}

function buildFlowEdges(
  edges: CanvasEdge[],
  nodes: CanvasNode[],
  uiState: {
    selectedNodeIds: string[];
    hoveredEdgeId: string | null;
    draggingNodeId: string | null;
    connectionNodeId: string | null;
  },
  onDisconnectEdge: (edgeId: string) => void,
  onHoverEdge: (edgeId: string | null) => void
): AdCanvasFlowEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const selectedNodeIdSet = new Set(uiState.selectedNodeIds);

  return edges.map((edge) => {
    const target = nodeMap.get(edge.target);
    const stale = target?.status === "stale";
    const connectedToSelection = selectedNodeIdSet.has(edge.source) || selectedNodeIdSet.has(edge.target);
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
        flowVariant,
        onDisconnect: onDisconnectEdge,
        onHoverChange: onHoverEdge
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
    <div
      className="canvas-hud"
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
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

export function WorkbenchCanvas({ session, onCanvasSnapshotChange, onCanvasStateChange }: WorkbenchCanvasProps) {
  const [canvasState, dispatchCanvas] = useReducer(canvasReducer, session, createInitialCanvasState);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [createMenu, setCreateMenu] = useState<CreationMenuState | null>(null);
  const [generationPanelOffsets, setGenerationPanelOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AdCanvasFlowNode, AdCanvasFlowEdge> | null>(null);
  const [shellElement, setShellElement] = useState<HTMLDivElement | null>(null);
  const selectedNodeIdsRef = useRef<string[]>(emptyCanvasState.selectedNodeIds);
  const generationPanelDragRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startOffset: { x: number; y: number };
    zoom: number;
  } | null>(null);
  const onCanvasSnapshotChangeRef = useRef(onCanvasSnapshotChange);
  const onCanvasStateChangeRef = useRef(onCanvasStateChange);
  const sessionCanvasStateKeyRef = useRef<string | null>(session.canvasState ? JSON.stringify(session.canvasState) : null);

  useEffect(() => {
    onCanvasSnapshotChangeRef.current = onCanvasSnapshotChange;
  }, [onCanvasSnapshotChange]);

  useEffect(() => {
    onCanvasStateChangeRef.current = onCanvasStateChange;
  }, [onCanvasStateChange]);

  useEffect(() => {
    if (!session.canvasState) return;
    const nextKey = JSON.stringify(session.canvasState);
    if (sessionCanvasStateKeyRef.current === nextKey) return;
    sessionCanvasStateKeyRef.current = nextKey;
    dispatchCanvas({ type: "replaceCanvasState", state: session.canvasState });
  }, [session.canvasState]);

  useEffect(() => {
    function updatePanelDrag(clientX: number, clientY: number) {
      const drag = generationPanelDragRef.current;
      if (!drag) return;

      const nextOffset = {
        x: drag.startOffset.x + (clientX - drag.startClientX) / drag.zoom,
        y: drag.startOffset.y + (clientY - drag.startClientY) / drag.zoom
      };

      setGenerationPanelOffsets((current) => ({
        ...current,
        [drag.nodeId]: nextOffset
      }));
    }

    function handlePointerMove(event: PointerEvent) {
      updatePanelDrag(event.clientX, event.clientY);
    }

    function handleMouseMove(event: MouseEvent) {
      updatePanelDrag(event.clientX, event.clientY);
    }

    function finishPanelDrag() {
      generationPanelDragRef.current = null;
      shellElement?.classList.remove("is-panel-dragging");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", finishPanelDrag);
    window.addEventListener("mouseup", finishPanelDrag);
    window.addEventListener("pointercancel", finishPanelDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", finishPanelDrag);
      window.removeEventListener("mouseup", finishPanelDrag);
      window.removeEventListener("pointercancel", finishPanelDrag);
      finishPanelDrag();
    };
  }, [shellElement]);

  useEffect(() => {
    selectedNodeIdsRef.current = canvasState.selectedNodeIds;
  }, [canvasState.selectedNodeIds]);

  useEffect(() => {
    function handleCanvasKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableCanvasTarget(event.target)) return;

      const activeElement = document.activeElement;
      const focusInsideCanvas =
        !activeElement ||
        activeElement === document.body ||
        activeElement === shellElement ||
        Boolean(shellElement?.contains(activeElement));
      if (!focusInsideCanvas) return;

      const nodeIds = selectedNodeIdsRef.current;
      if (!nodeIds.length) return;

      event.preventDefault();
      setCreateMenu(null);
      dispatchCanvas({ type: "deleteNodes", nodeIds });
    }

    window.addEventListener("keydown", handleCanvasKeyDown);
    return () => window.removeEventListener("keydown", handleCanvasKeyDown);
  }, [shellElement]);

  useEffect(() => {
    storeCanvasState(session.id, canvasState);
  }, [canvasState, session.id]);

  useEffect(() => {
    onCanvasSnapshotChangeRef.current?.(createCanvasSnapshot(canvasState.nodes, canvasState.edges));
    onCanvasStateChangeRef.current?.(createPersistableCanvasState(canvasState.nodes, canvasState.edges));
  }, [canvasState.nodes, canvasState.edges]);

  const openNodeById = useCallback((nodeId: string) => {
    setCreateMenu(null);
    shellElement?.focus({ preventScroll: true });
    dispatchCanvas({ type: "selectNode", nodeId });
  }, [shellElement]);

  const createNode = useCallback((kind: CanvasNodeKind, sourceNodeId?: string, position?: { x: number; y: number }) => {
    shellElement?.focus({ preventScroll: true });
    dispatchCanvas({ type: "createNode", input: { kind, sourceNodeId, position } });
  }, [shellElement]);

  const renameNode = useCallback((nodeId: string, title: string) => {
    dispatchCanvas({ type: "renameNode", nodeId, title });
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

  const disconnectParentRef = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edge = canvasState.edges.find((item) => item.source === sourceNodeId && item.target === targetNodeId);
      if (!edge) return;
      dispatchCanvas({ type: "disconnectNodes", edgeId: edge.id });
    },
    [canvasState.edges]
  );

  const disconnectEdge = useCallback((edgeId: string) => {
    setCreateMenu(null);
    dispatchCanvas({ type: "disconnectNodes", edgeId });
  }, []);

  const hoverEdge = useCallback((edgeId: string | null) => {
    dispatchCanvas({ type: "setHoveredEdge", edgeId });
  }, []);

  const runNodeGeneration = useCallback(
    (nodeId: string) => {
      const node = findCanvasNode(canvasState.nodes, nodeId);
      if (!node || node.locked || node.status === "locked" || node.status === "running") return;

      dispatchCanvas({
        type: "failNodeGeneration",
        nodeId,
        errorMessage: "第一版已关闭占位生成；请在节点生成面板中提交真实 Vidu 任务。"
      });
    },
    [canvasState.nodes]
  );

  const startNodeGeneration = useCallback(
    (nodeId: string, prompt: string, model: string, settings: CanvasNodeSettings) => {
      const node = findCanvasNode(canvasState.nodes, nodeId);
      if (!node || node.locked || node.status === "locked" || node.status === "running") return;
      const nextSettings = { ...settings };
      delete nextSettings.errorMessage;

      dispatchCanvas({
        type: "updateNodeSettings",
        nodeId,
        title: node.title,
        output: node.output,
        model,
        settings: {
          ...nextSettings,
          prompt
        }
      });
      dispatchCanvas({ type: "runNodeGeneration", nodeId });
    },
    [canvasState.nodes]
  );

  const completeNodeGeneration = useCallback((nodeId: string, result: CanvasGenerationResult) => {
    dispatchCanvas({ type: "appendNodeVersion", nodeId, result });
  }, []);

  const failNodeGeneration = useCallback((nodeId: string, errorMessage: string) => {
    dispatchCanvas({ type: "failNodeGeneration", nodeId, errorMessage });
  }, []);

  const flowNodeHandlers = useMemo(
    () => ({
      onCreateFromNode: (nodeId: string, kind: CanvasNodeKind) => createNode(kind, nodeId),
      onRenameNode: renameNode,
      onLockNode: lockNode,
      onOpenNode: openNodeById,
      onUpdateNodeSettings: updateNodeSettings,
      onRunNode: runNodeGeneration,
      onSetPrimaryVersion: setPrimaryVersion
    }),
    [createNode, renameNode, lockNode, openNodeById, updateNodeSettings, runNodeGeneration, setPrimaryVersion]
  );

  const baseFlowNodes = useMemo(
    () => buildFlowNodes(canvasState.nodes, canvasState.edges, canvasState.selectedNodeIds, flowNodeHandlers),
    [
      canvasState.nodes,
      canvasState.edges,
      canvasState.selectedNodeIds,
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
  const selectedParentNodes = useMemo(() => {
    if (!selectedCanvasNode) return [];

    const nodeMap = new Map(canvasState.nodes.map((node) => [node.id, node]));
    return canvasState.edges
      .filter((edge) => edge.target === selectedCanvasNode.id)
      .map((edge) => nodeMap.get(edge.source))
      .filter((node): node is CanvasNode => Boolean(node));
  }, [canvasState.edges, canvasState.nodes, selectedCanvasNode]);
  const flowEdges = useMemo(
    () =>
      buildFlowEdges(canvasState.edges, canvasState.nodes, {
        selectedNodeIds: canvasState.selectedNodeIds,
        hoveredEdgeId: canvasState.hoveredEdgeId,
        draggingNodeId: canvasState.draggingNodeId,
        connectionNodeId: canvasState.connectionNodeId
      }, disconnectEdge, hoverEdge),
    [
      canvasState.edges,
      canvasState.nodes,
      canvasState.selectedNodeIds,
      canvasState.hoveredEdgeId,
      canvasState.draggingNodeId,
      canvasState.connectionNodeId,
      disconnectEdge,
      hoverEdge
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

  const handleNodesChange = useCallback(
    (changes: NodeChange<AdCanvasFlowNode>[]) => {
      setFlowNodeSnapshots((currentNodes) => applyNodeChanges(changes, mergeFlowNodes(currentNodes, baseFlowNodes)));

      const selectionChanges = changes.filter(isNodeSelectionChange);
      if (!selectionChanges.length) return;

      const nextSelectedNodeIds = new Set(selectedNodeIdsRef.current);
      selectionChanges.forEach((change) => {
        if (change.selected) {
          nextSelectedNodeIds.add(change.id);
        } else {
          nextSelectedNodeIds.delete(change.id);
        }
      });

      const nodeIds = Array.from(nextSelectedNodeIds);
      selectedNodeIdsRef.current = nodeIds;
      dispatchCanvas({ type: "selectNodes", nodeIds });
    },
    [baseFlowNodes]
  );

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
      if (!reactFlowInstance || !shellElement) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(".react-flow__node") ||
        target.closest(".react-flow__edge") ||
        target.closest(".ad-node-generation-panel") ||
        target.closest(".canvas-create-menu") ||
        target.closest(".canvas-hud") ||
        target.closest(".react-flow__minimap")
      ) {
        return;
      }

      const bounds = shellElement.getBoundingClientRect();
      setCreateMenu({
        x: Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(bounds.width - 264, 12)),
        y: Math.min(Math.max(event.clientY - bounds.top, 12), Math.max(bounds.height - 336, 12)),
        flowPosition: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      });
      shellElement.focus({ preventScroll: true });
      dispatchCanvas({ type: "selectNode", nodeId: null });
    },
    [reactFlowInstance, shellElement]
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const sourceNodeId = canvasState.connectionNodeId;
      dispatchCanvas({ type: "setConnectionNode", nodeId: null });
      if (!sourceNodeId || !reactFlowInstance || !shellElement) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".react-flow__handle") || target?.closest(".react-flow__node")) return;

      const pointer = getPointerClientPosition(event);
      if (!pointer) return;

      const bounds = shellElement.getBoundingClientRect();
      setCreateMenu({
        x: Math.min(Math.max(pointer.x - bounds.left, 12), Math.max(bounds.width - 264, 12)),
        y: Math.min(Math.max(pointer.y - bounds.top, 12), Math.max(bounds.height - 336, 12)),
        flowPosition: reactFlowInstance.screenToFlowPosition({ x: pointer.x, y: pointer.y }),
        sourceNodeId
      });
      shellElement.focus({ preventScroll: true });
    },
    [canvasState.connectionNodeId, reactFlowInstance, shellElement]
  );

  const handleMoveStart = useCallback(() => {
    shellElement?.classList.add("is-panning");
  }, [shellElement]);

  const handleMoveEnd = useCallback(() => {
    shellElement?.classList.remove("is-panning");
  }, [shellElement]);

  const handleGenerationPanelDragStart = useCallback(
    (nodeId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = reactFlowInstance?.getViewport();
      generationPanelDragRef.current = {
        nodeId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset: generationPanelOffsets[nodeId] ?? { x: 0, y: 0 },
        zoom: viewport?.zoom || 1
      };
      shellElement?.classList.add("is-panel-dragging");
    },
    [generationPanelOffsets, reactFlowInstance, shellElement]
  );

  const createNodeFromMenu = useCallback(
    (kind: CanvasNodeKind) => {
      if (!createMenu) return;
      createNode(kind, createMenu.sourceNodeId, createMenu.flowPosition);
      setCreateMenu(null);
    },
    [createMenu, createNode]
  );

  const selectedNodeIsDragging = Boolean(selectedCanvasNode && canvasState.draggingNodeId === selectedCanvasNode.id);
  const generationPanelStyle =
    selectedCanvasNode && selectedFlowNode && !selectedNodeIsDragging && shouldShowGenerationPanel(selectedCanvasNode.kind)
      ? getGenerationPanelStyle({
          kind: selectedCanvasNode.kind,
          flowNode: selectedFlowNode,
          dragOffset: generationPanelOffsets[selectedCanvasNode.id],
          reactFlowInstance,
          shellElement
        })
      : undefined;

  const hasProjectBrief = Boolean(
    session.lifecycle !== "empty" ||
    session.product.trim() ||
    session.originalPrompt.trim() ||
    session.uploadedAssets.length
  );
  const canvasTitle = hasProjectBrief
    ? `${session.product ? `${session.product} ` : ""}${session.mode === "clone" ? "竞品复刻" : "从 0 生成"} Canvas`
    : "Ad Studio Canvas";

  return (
    <div className="canvas-area ad-workbench-canvas">
      <div className="canvas-toolbar">
        <div className="canvas-title">
          <strong>{canvasTitle}</strong>
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

      <div
        className="ad-canvas-shell"
        ref={setShellElement}
        tabIndex={-1}
        onDoubleClick={handlePaneDoubleClick}
      >
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
            dispatchCanvas({ type: "setHoveredEdge", edgeId: edge.id });
          }}
          onPaneClick={() => {
            setCreateMenu(null);
            shellElement?.focus({ preventScroll: true });
            dispatchCanvas({ type: "setHoveredEdge", edgeId: null });
            dispatchCanvas({ type: "selectNode", nodeId: null });
          }}
          onConnectStart={(_, params) => {
            setCreateMenu(null);
            dispatchCanvas({ type: "setConnectionNode", nodeId: params.nodeId ?? null });
          }}
          onConnectEnd={handleConnectEnd}
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
          connectionLineComponent={DraftConnectionLine}
          defaultViewport={{ x: 54, y: 112, zoom: 1 }}
          minZoom={0.35}
          maxZoom={1.7}
          fitViewOptions={{ padding: 0.18 }}
          panOnDrag={[1, 2]}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          panOnScrollSpeed={0.82}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
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
                parentNodes={selectedParentNodes}
                style={generationPanelStyle}
                onDisconnectParentRef={disconnectParentRef}
                onStartNodeGeneration={startNodeGeneration}
                onCompleteNodeGeneration={completeNodeGeneration}
                onFailNodeGeneration={failNodeGeneration}
                onUpdateNodeSettings={updateNodeSettings}
                onPanelDragStart={(event) => handleGenerationPanelDragStart(selectedCanvasNode.id, event)}
              />
            </ViewportPortal>
          ) : null}
          {miniMapOpen ? <MiniMap className="ad-canvas-minimap" pannable zoomable /> : null}
          <CanvasHud staleCount={staleCount} runningCount={runningCount} onToggleMiniMap={() => setMiniMapOpen((value) => !value)} />
        </ReactFlow>
        {createMenu ? <CanvasCreateMenu menu={createMenu} onCreate={createNodeFromMenu} onClose={() => setCreateMenu(null)} /> : null}
      </div>
    </div>
  );
}
