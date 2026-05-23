import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { ApprovalRequestRecord } from "@/lib/agent-project-store";
import type {
  AgentProductionBrief,
  AgentRuntimeState,
  AgentWorkflowStage,
  PendingAgentConfirmation
} from "@/features/workbench/agent-types";
import type { AgentEvent } from "./agent-events";

export type AgentDecision = {
  events: AgentEvent[];
  briefPatch?: Partial<AgentProductionBrief>;
  pendingConfirmation?: PendingAgentConfirmation | null;
  canvasActions?: CanvasRuntimeAction[];
  nextStage?: AgentWorkflowStage;
};

export type AgentTransition = {
  state: AgentRuntimeState;
  canvasActions?: CanvasRuntimeAction[];
  events?: AgentEvent[];
  approvalRequest?: ApprovalRequestRecord;
};
