import type { UIMessage } from "ai";
import type { AgentEvent } from "../agent-events";
import type { AgentMessage } from "@/features/workbench/agent-types";

export type AgentAiSdkUIDataParts = {
  agent_status: Extract<AgentEvent, { kind: "status" }>;
  agent_question: Extract<AgentEvent, { kind: "question" }>;
  agent_intake_submission: Extract<AgentEvent, { kind: "intake_submission" }>;
  agent_retry: Extract<AgentEvent, { kind: "retry" }>;
  agent_confirmation: Extract<AgentEvent, { kind: "confirmation" }>;
  agent_warning: Extract<AgentEvent, { kind: "warning" }>;
  agent_canvas_action: Extract<AgentEvent, { kind: "canvas_action" }>;
  agent_node_result: Extract<AgentEvent, { kind: "node_result" }>;
};

export type AgentAiSdkUIMessageMetadata = AgentMessage["metadata"] & {
  createdAt?: string;
  adStudioRole?: AgentMessage["role"];
};

export type AgentAiSdkUIMessage = UIMessage<AgentAiSdkUIMessageMetadata, AgentAiSdkUIDataParts>;
export type AgentAiSdkUIPart = AgentAiSdkUIMessage["parts"][number];

function nowLabel() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function eventToDataPart(event: Exclude<AgentEvent, { kind: "text" }>): AgentAiSdkUIPart {
  switch (event.kind) {
    case "status":
      return { type: "data-agent_status", data: event };
    case "question":
      return { type: "data-agent_question", data: event };
    case "intake_submission":
      return { type: "data-agent_intake_submission", data: event };
    case "retry":
      return { type: "data-agent_retry", data: event };
    case "confirmation":
      return { type: "data-agent_confirmation", data: event };
    case "warning":
      return { type: "data-agent_warning", data: event };
    case "canvas_action":
      return { type: "data-agent_canvas_action", data: event };
    case "node_result":
      return { type: "data-agent_node_result", data: event };
  }
}

export function agentEventToUiParts(event: AgentEvent | AgentEvent[]): AgentAiSdkUIPart[] {
  const events = Array.isArray(event) ? event : [event];
  return events.map((item) => {
    if (item.kind === "text") {
      return {
        type: "text",
        text: item.text,
        state: "done"
      };
    }
    return eventToDataPart(item);
  });
}

function isAgentDataPart(part: AgentAiSdkUIPart): part is Extract<AgentAiSdkUIPart, { data: AgentEvent }> {
  return part.type.startsWith("data-agent_") && "data" in part;
}

export function uiPartsToAgentEvents(parts: AgentAiSdkUIPart[]): AgentEvent[] {
  return parts
    .map((part): AgentEvent | null => {
      if (part.type === "text") {
        return {
          kind: "text",
          text: part.text
        };
      }

      if (isAgentDataPart(part)) return part.data;
      return null;
    })
    .filter((event): event is AgentEvent => Boolean(event));
}

export function agentMessageToUiMessage(message: AgentMessage): AgentAiSdkUIMessage {
  const events = message.events?.length ? message.events : [{ kind: "text" as const, text: message.body }];
  return {
    id: message.id,
    role: message.role,
    metadata: {
      ...message.metadata,
      createdAt: message.createdAt,
      adStudioRole: message.role
    },
    parts: agentEventToUiParts(events)
  };
}

export function uiMessageToAgentMessage(uiMessage: AgentAiSdkUIMessage): AgentMessage {
  const events = uiPartsToAgentEvents(uiMessage.parts);
  const body = events
    .filter((event): event is Extract<AgentEvent, { kind: "text" }> => event.kind === "text")
    .map((event) => event.text)
    .join("\n")
    .trim();

  return {
    id: uiMessage.id,
    role: uiMessage.role,
    body: body || "已收到信息。",
    createdAt: uiMessage.metadata?.createdAt ?? nowLabel(),
    events,
    metadata: uiMessage.metadata
  };
}
