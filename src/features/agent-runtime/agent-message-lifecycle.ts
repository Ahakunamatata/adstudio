export type AgentTurnLifecycleStatus =
  | "idle"
  | "submitted"
  | "requesting"
  | "received"
  | "failed"
  | "retrying"
  | "cancelled";

export type PendingAgentTurn = {
  id: string;
  userInput?: string;
  createdAt: string;
  title: string;
  detail: string;
  status: Exclude<AgentTurnLifecycleStatus, "idle">;
  userVisibleError?: string;
  developerError?: string;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowLabel() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function createPendingAgentTurn(input: {
  userInput?: string;
  title: string;
  detail: string;
  status?: "submitted" | "retrying" | "requesting";
}): PendingAgentTurn {
  return {
    id: createId(input.status === "retrying" ? "retrying" : "pending"),
    createdAt: nowLabel(),
    status: input.status ?? "submitted",
    userInput: input.userInput,
    title: input.title,
    detail: input.detail
  };
}

export function markAgentTurnRequesting(turn: PendingAgentTurn): PendingAgentTurn {
  if (turn.status === "failed" || turn.status === "cancelled" || turn.status === "received") return turn;
  return {
    ...turn,
    status: turn.status === "retrying" ? "retrying" : "requesting"
  };
}

export function markAgentTurnReceived(turn: PendingAgentTurn): PendingAgentTurn {
  return {
    ...turn,
    status: "received"
  };
}

export function markAgentTurnFailed(
  turn: PendingAgentTurn,
  input: {
    userVisibleError: string;
    developerError?: string;
  }
): PendingAgentTurn {
  return {
    ...turn,
    status: "failed",
    userVisibleError: input.userVisibleError,
    developerError: input.developerError
  };
}

export function markAgentTurnCancelled(turn: PendingAgentTurn): PendingAgentTurn {
  return {
    ...turn,
    status: "cancelled"
  };
}

export function isActiveAgentTurn(turn: PendingAgentTurn | null) {
  return turn?.status === "submitted" || turn?.status === "requesting" || turn?.status === "retrying";
}

export function getPendingTurnRetryInput(turn: PendingAgentTurn) {
  return turn.userInput?.trim() ?? "";
}
