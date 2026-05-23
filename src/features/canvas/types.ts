import type { Edge, Node } from "@xyflow/react";
import type {
  BusinessNodeType,
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasNodeSettings,
  NodeStatus
} from "@/lib/domain/schemas";
import type { GenerationParamValue, GenerationSlotInput } from "@/features/generation/types";

export type CanvasCreateNodeInput = {
  id?: string;
  kind: CanvasNodeKind;
  businessType?: BusinessNodeType;
  sourceNodeId?: string;
  position?: { x: number; y: number };
  title?: string;
  input?: string;
  output?: string;
  model?: string;
  status?: NodeStatus;
  locked?: boolean;
  previewClass?: string;
  settings?: CanvasNodeSettings;
};

export type CanvasGenerationResult = {
  content: string;
  assetUrl?: string;
  downloadUrl?: string;
  providerTaskId?: string;
  model?: string;
  time?: string;
  cost?: string;
  params?: Record<string, GenerationParamValue>;
  slots?: GenerationSlotInput[];
};

export type CanvasRuntimeAction =
  | { type: "createNode"; input: CanvasCreateNodeInput }
  | { type: "deleteNodes"; nodeIds: string[] }
  | { type: "renameNode"; nodeId: string; title: string }
  | { type: "updateNodeContent"; nodeId: string; output: string }
  | {
      type: "updateNodeSettings";
      nodeId: string;
      title: string;
      output: string;
      model: string;
      settings?: CanvasNodeSettings;
    }
  | { type: "connectNodes"; source: string; target: string }
  | { type: "disconnectNodes"; edgeId: string }
  | { type: "runNodeGeneration"; nodeId: string; content?: string; delayMs?: number }
  | { type: "appendNodeVersion"; nodeId: string; content?: string; result?: CanvasGenerationResult }
  | { type: "failNodeGeneration"; nodeId: string; errorMessage: string }
  | { type: "setPrimaryVersion"; nodeId: string; versionId: string }
  | { type: "lockNode"; nodeId: string; locked?: boolean }
  | { type: "markNodeStale"; nodeId: string; reason?: string }
  | { type: "openNodeDetail"; nodeId: string };

export type CanvasActionResult = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  changedNodeId?: string;
  selectedNodeId?: string;
};

export type AdCanvasNodeData = {
  canvasNode: CanvasNode;
  parentTitles: string[];
  parentRefs: Array<{
    id: string;
    title: string;
    kind: CanvasNodeKind;
    previewClass: string;
    status: string;
  }>;
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
  nodeTitles: Array<{ id: string; title: string }>;
};

export type AdCanvasFlowNode = Node<AdCanvasNodeData, "adCanvasNode">;
export type EdgeFlowVariant = "idle" | "connected" | "hovered" | "draft" | "pulse" | "stale";
export type AdCanvasFlowEdge = Edge<{
  label?: string;
  flowVariant?: EdgeFlowVariant;
  onDisconnect?: (edgeId: string) => void;
  onHoverChange?: (edgeId: string | null) => void;
}>;
