import type { Edge, Node } from "@xyflow/react";
import type {
  BusinessNodeType,
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasNodeSettings
} from "@/lib/domain/schemas";

export type CanvasCreateNodeInput = {
  kind: CanvasNodeKind;
  businessType?: BusinessNodeType;
  sourceNodeId?: string;
  position?: { x: number; y: number };
};

export type CanvasRuntimeAction =
  | { type: "createNode"; input: CanvasCreateNodeInput }
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
  | { type: "runNodeGeneration"; nodeId: string }
  | { type: "appendNodeVersion"; nodeId: string; content?: string }
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
};

export type AdCanvasFlowNode = Node<AdCanvasNodeData, "adCanvasNode">;
export type EdgeFlowVariant = "idle" | "connected" | "hovered" | "draft" | "pulse" | "stale";
export type AdCanvasFlowEdge = Edge<{ label?: string; flowVariant?: EdgeFlowVariant }>;
