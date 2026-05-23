import type { CanvasEdge, CanvasNode, AgentSession, AgentUploadedAsset } from "@/lib/domain/schemas";
import type { AgentIntakeSubmissionFact } from "./agent-events";
import { createAgentArtifactSnapshot, type AgentArtifactSnapshot } from "./artifacts";
import type {
  AgentMessage,
  AgentProductionBrief,
  AgentRuntimeState,
  PendingAgentConfirmation
} from "@/features/workbench/agent-types";

export type CanvasSnapshotNode = Pick<
  CanvasNode,
  "id" | "kind" | "businessType" | "title" | "status" | "locked" | "parentNodeIds" | "staleReason"
>;

export type CanvasSnapshotEdge = Pick<CanvasEdge, "id" | "source" | "target" | "label">;

export type CanvasSnapshot = {
  nodes: CanvasSnapshotNode[];
  edges: CanvasSnapshotEdge[];
  lockedNodeIds: string[];
  staleNodeIds: string[];
};

export type AgentInputSnapshot = {
  session: AgentSession;
  brief: AgentProductionBrief;
  messages: AgentMessage[];
  canvas: CanvasSnapshot;
  uploadedAssets: AgentUploadedAsset[];
  intakeSubmissions: AgentIntakeSubmissionFact[];
  pendingConfirmation: PendingAgentConfirmation | null;
  artifacts: AgentArtifactSnapshot;
  fallback: AgentRuntimeState["fallback"];
};

function getIntakeSubmissions(runtime: AgentRuntimeState) {
  if (runtime.intakeSubmissions?.length) return runtime.intakeSubmissions;
  return runtime.messages
    .map((message) => message.metadata?.intakeSubmission)
    .filter((submission): submission is AgentIntakeSubmissionFact => Boolean(submission));
}

function createSnapshotMessage(message: AgentMessage): AgentMessage {
  const intakeSubmission = message.metadata?.intakeSubmission;
  return {
    ...message,
    metadata: intakeSubmission
      ? {
          intakeSubmission
        }
      : undefined
  };
}

export function createEmptyCanvasSnapshot(): CanvasSnapshot {
  return {
    nodes: [],
    edges: [],
    lockedNodeIds: [],
    staleNodeIds: []
  };
}

export function createAgentInputSnapshot(
  session: AgentSession,
  runtime: AgentRuntimeState,
  canvas: CanvasSnapshot = createEmptyCanvasSnapshot()
): AgentInputSnapshot {
  return {
    session,
    brief: runtime.brief,
    messages: runtime.messages.map(createSnapshotMessage),
    canvas,
    uploadedAssets: session.uploadedAssets,
    intakeSubmissions: getIntakeSubmissions(runtime),
    pendingConfirmation: runtime.pendingConfirmation,
    artifacts: createAgentArtifactSnapshot(runtime.artifacts),
    fallback: runtime.fallback ?? null
  };
}
