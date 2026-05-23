import type { AgentEvent } from "../agent-events";
import type { LlmAgentOutput } from "./agent-output-schema";
import { llmAgentOutputToEvents, sanitizeAgentVisibleText } from "./agent-output-adapter";

const sampleOutput: LlmAgentOutput = {
  message: "我会先确认参考素材和产品。",
  questions: [
    {
      id: "sample-intake",
      title: "补充复刻任务信息",
      description: undefined,
      fields: [
        {
          id: "reference_upload",
          label: "参考广告素材",
          type: "upload",
          display: undefined,
          required: true,
          help: undefined,
          placeholder: undefined,
          options: undefined,
          maxSelections: undefined,
          accept: undefined,
          multiple: undefined,
          uploadRole: "competitor_asset",
          requiredGroup: undefined,
          requiredGroupLabel: undefined
        }
      ],
      submitLabel: undefined
    }
  ],
  confirmation: {
    id: "sample-confirmation",
    title: "方案预览",
    summary: "确认后也不会在 M3.2.5 执行画布动作。",
    bullets: ["只保存方案预览。"],
    confirmLabel: "确认方案",
    secondaryLabel: undefined
  },
  canvasActions: [],
  briefPatch: {
    originalPrompt: "复刻这个参考广告"
  },
  safetyNotes: ["不会生成媒体。"]
};

export function typecheckLlmAgentOutputAdapter() {
  const events: AgentEvent[] = llmAgentOutputToEvents(sampleOutput);
  const sanitized = sanitizeAgentVisibleText("provider fallbackReason schema", "连接失败，可重试。");

  return {
    hasText: events.some((event) => event.kind === "text"),
    hasQuestion: events.some((event) => event.kind === "question"),
    hasConfirmation: events.some((event) => event.kind === "confirmation"),
    sanitized
  };
}
