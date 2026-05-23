import type { AgentEvent } from "../agent-events";
import type { AgentMessage } from "@/features/workbench/agent-types";
import {
  agentEventToUiParts,
  agentMessageToUiMessage,
  uiMessageToAgentMessage,
  uiPartsToAgentEvents,
  type AgentAiSdkUIMessage
} from "./ui-message-adapter";

const sampleEvents: AgentEvent[] = [
  { kind: "text", text: "收到。" },
  { kind: "status", label: "received", detail: "已收到信息" },
  {
    kind: "retry",
    label: "重新连接 Agent",
    text: "我要复刻一个广告"
  }
];

const sampleMessage: AgentMessage = {
  id: "message-ui-adapter",
  role: "assistant",
  body: "收到。",
  createdAt: "12:00",
  events: sampleEvents
};

export function typecheckAgentUiMessageAdapter() {
  const uiMessage: AgentAiSdkUIMessage = agentMessageToUiMessage(sampleMessage);
  const events = uiPartsToAgentEvents(agentEventToUiParts(sampleEvents[0]));
  const message = uiMessageToAgentMessage(uiMessage);

  return {
    role: uiMessage.role,
    parts: uiMessage.parts.length,
    events: events.length,
    messageBody: message.body
  };
}
