import type {
  AgentConfirmationEvent,
  AgentEvent,
  AgentQuestionField,
  AgentQuestionForm,
  AgentQuestionOption
} from "../agent-events";
import type { LlmAgentOutput } from "./agent-output-schema";
import type { ApprovalRequestRecord } from "@/lib/agent-project-store";

export const internalAgentUiTermPattern =
  /\b(fallbackUsed|fallbackReason|runtime|workspace|snapshot|schema|structured fact|provider|M3\.?2|Zod|LLM|canvasActions|uploadedAssets|executable|connectNodes|source|target|nodeId|validator|Action\s*\d+)\b|Agent LLM 决策失败|决策失败|目标节点.*不存在|不能连接到自身/i;

export function sanitizeAgentVisibleText(text: string, fallback = "我已收到信息，正在整理下一步。") {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (!internalAgentUiTermPattern.test(trimmed)) return trimmed;

  const visibleLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !internalAgentUiTermPattern.test(line));
  return visibleLines.join("\n") || fallback;
}

function sanitizeOption(option: AgentQuestionOption): AgentQuestionOption {
  return {
    ...option,
    label: sanitizeAgentVisibleText(option.label, "选项"),
    description: option.description
      ? sanitizeAgentVisibleText(option.description, "")
      : option.description
  };
}

function sanitizeField(field: AgentQuestionField): AgentQuestionField {
  return {
    ...field,
    label: sanitizeAgentVisibleText(field.label, "补充信息"),
    help: field.help ? sanitizeAgentVisibleText(field.help, "") : field.help,
    placeholder: field.placeholder ? sanitizeAgentVisibleText(field.placeholder, "") : field.placeholder,
    options: field.options?.map(sanitizeOption),
    requiredGroupLabel: field.requiredGroupLabel
      ? sanitizeAgentVisibleText(field.requiredGroupLabel, "必填信息")
      : field.requiredGroupLabel
  };
}

function sanitizeQuestionForm(form: AgentQuestionForm): AgentQuestionForm {
  return {
    ...form,
    title: sanitizeAgentVisibleText(form.title, "需要补充的信息"),
    description: form.description ? sanitizeAgentVisibleText(form.description, "") : form.description,
    submitLabel: form.submitLabel ? sanitizeAgentVisibleText(form.submitLabel, "继续") : form.submitLabel,
    fields: form.fields.map(sanitizeField)
  };
}

type LlmAgentOutputEventOptions = {
  approvalRequest?: ApprovalRequestRecord;
  generation?: AgentConfirmationEvent["generation"];
  approvalErrors?: string[];
  approvalWarnings?: string[];
};

function sanitizeConfirmation(confirmation: AgentConfirmationEvent): AgentConfirmationEvent {
  return {
    ...confirmation,
    title: sanitizeAgentVisibleText(confirmation.title, "方案预览"),
    summary: sanitizeAgentVisibleText(confirmation.summary, "请确认是否按当前方案继续。"),
    bullets: confirmation.bullets.map((bullet) => sanitizeAgentVisibleText(bullet, "待确认事项")),
    confirmLabel: sanitizeAgentVisibleText(confirmation.confirmLabel, "确认方案"),
    secondaryLabel: confirmation.secondaryLabel
      ? sanitizeAgentVisibleText(confirmation.secondaryLabel, "先调整")
      : confirmation.secondaryLabel,
    executable: confirmation.executable
  };
}

function createStatusEvent(output: LlmAgentOutput): AgentEvent {
  if (output.questions?.length) {
    return {
      kind: "status",
      label: "waiting_user",
      detail: "需要补充信息"
    };
  }

  if (output.confirmation) {
    return {
      kind: "status",
      label: "waiting_user",
      detail: "等待确认执行"
    };
  }

  return {
    kind: "status",
    label: "received",
    detail: "已收到信息"
  };
}

function createApprovalConfirmationEvent(output: LlmAgentOutput, approvalRequest: ApprovalRequestRecord): AgentConfirmationEvent {
  return sanitizeConfirmation({
    ...(output.confirmation ?? {
      id: approvalRequest.id,
      title: approvalRequest.title,
      summary: approvalRequest.summary,
      bullets: [],
      confirmLabel: "确认方案"
    }),
    id: approvalRequest.id,
    kind: approvalRequest.kind === "generation" ? "controlled_generation" : "canvas_proposal",
    approvalKind: approvalRequest.kind,
    approvalRequestId: approvalRequest.id,
    actionHash: approvalRequest.actionHash,
    idempotencyKey: approvalRequest.idempotencyKey,
    affectedNodeIds: approvalRequest.affectedNodeIds,
    estimatedCredits: approvalRequest.estimatedCredits ?? 0,
    actions: approvalRequest.requestedActions,
    status: approvalRequest.status,
    executable: true
  });
}

export function llmAgentOutputToEvents(output: LlmAgentOutput, options: LlmAgentOutputEventOptions = {}): AgentEvent[] {
  const events: AgentEvent[] = [
    createStatusEvent(output),
    {
      kind: "text",
      text: sanitizeAgentVisibleText(output.message)
    }
  ];

  output.questions?.forEach((form) => {
    events.push({
      kind: "question",
      form: sanitizeQuestionForm(form)
    });
  });

  if (options.approvalRequest) {
    events.push({
      kind: "confirmation",
      confirmation: {
        ...createApprovalConfirmationEvent(output, options.approvalRequest),
        generation: options.generation
      }
    });
  } else if (output.confirmation) {
    events.push({
      kind: "confirmation",
      confirmation: sanitizeConfirmation({
        ...output.confirmation,
        executable: false
      })
    });
  }

  if (options.approvalErrors?.length) {
    events.push({
      kind: "warning",
      text: "这个画布方案暂时无法创建，我会重新整理一个可执行的方案。"
    });
  } else if (options.approvalWarnings?.length) {
    events.push({
      kind: "warning",
      text: "这个画布方案还需要整理，我会先保留你的需求并重新生成可执行方案。"
    });
  } else if (output.canvasActions?.length && !options.approvalRequest) {
    events.push({
      kind: "warning",
      text: "当前版本只保留对话能力，已忽略本轮返回的画布动作草案。"
    });
  }

  output.safetyNotes?.forEach((note) => {
    events.push({
      kind: "warning",
      text: sanitizeAgentVisibleText(note, "这一步需要先确认边界。")
    });
  });

  return events;
}
