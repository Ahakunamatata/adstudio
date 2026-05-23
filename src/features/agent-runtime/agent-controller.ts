import type { AgentSession } from "@/lib/domain/schemas";
import type { AgentQuickAction, AgentRuntimeState } from "@/features/workbench/agent-types";
import type { AgentTransition } from "./agent-decision";
import type { CanvasSnapshot } from "./agent-snapshot";

export type AgentControllerResult = AgentTransition | Promise<AgentTransition>;

export type AgentController = {
  start: (session: AgentSession) => AgentControllerResult;
  submitText: (state: AgentRuntimeState, text: string, session?: AgentSession, canvas?: CanvasSnapshot) => AgentControllerResult;
  submitQuickAction: (
    state: AgentRuntimeState,
    action: AgentQuickAction,
    session?: AgentSession,
    canvas?: CanvasSnapshot
  ) => AgentControllerResult;
};
