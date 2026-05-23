import type { AgentSession } from "@/lib/domain/schemas";
import type {
  AgentMessage,
  AgentQuickAction,
  AgentRuntimeState,
  AgentWorkflowStage,
  PendingAgentConfirmation
} from "@/features/workbench/agent-types";
import { createInitialLlmAgentRuntime } from "@/features/workbench/agent-orchestrator";
import type { AgentController } from "./agent-controller";
import type { AgentEvent } from "./agent-events";
import { createAgentInputSnapshot, type CanvasSnapshot } from "./agent-snapshot";
import { createCanvasActionApprovalRequest, type CanvasApprovalBuildResult } from "./approval-flow";
import { createGenerationApprovalRequest } from "./generation-approval";
import { AgentDecideRequestError, decideWithGemini } from "./llm/gemini-agent-provider";
import type { LlmAgentOutput } from "./llm/agent-output-schema";
import { llmAgentOutputToEvents } from "./llm/agent-output-adapter";
import type { ApprovalRequestRecord } from "@/lib/agent-project-store";

type DecideOptions = {
  showUserMessage?: boolean;
  appendUserMessage?: boolean;
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

function createMessage(
  role: AgentMessage["role"],
  body: string,
  events?: AgentEvent[],
  metadata?: AgentMessage["metadata"]
): AgentMessage {
  return {
    id: createId(role),
    role,
    body,
    events: events ?? [{ kind: "text", text: body }],
    createdAt: nowLabel(),
    metadata
  };
}

function getFallbackReason(error: unknown) {
  if (error instanceof AgentDecideRequestError) {
    return [error.reason, `http_${error.status}`].filter(Boolean).join(":") || "agent_decide_failed";
  }
  if (error instanceof Error) return error.message || "agent_decide_failed";
  return "agent_decide_failed";
}

function getFailureBody(error: unknown) {
  if (error instanceof AgentDecideRequestError && error.reason === "configuration_missing") {
    return "Agent 还没有配置好，暂时不能继续理解这条消息。请先保留你的补充内容，稍后再重试。";
  }
  return "暂时连接不上 Agent，未能继续理解这条消息。请稍后重试，或先保留你的补充内容。";
}

function getStageForOutput(output: LlmAgentOutput, fallback: AgentWorkflowStage): AgentWorkflowStage {
  if (output.questions?.length) return "collecting";
  if (output.confirmation) return "awaiting_confirmation";
  return fallback;
}

function getLatestUserMessageText(state: AgentRuntimeState) {
  return [...state.messages].reverse().find((message) => message.role === "user")?.body.trim() ?? "";
}

function createApprovalBuildResult(
  output: LlmAgentOutput,
  session: AgentSession,
  canvas?: CanvasSnapshot
): CanvasApprovalBuildResult | null {
  if (!output.confirmation || !output.canvasActions?.length) return null;
  return createCanvasActionApprovalRequest({
    projectId: session.id,
    sessionId: session.id,
    title: output.confirmation.title,
    summary: output.confirmation.summary,
    actions: output.canvasActions,
    canvas,
    approvalId: output.confirmation.id,
    requestedBy: "agent"
  });
}

function createGenerationApprovalBuildResult(
  output: LlmAgentOutput,
  session: AgentSession
): ApprovalRequestRecord | null {
  if (!output.confirmation || !output.generation || output.canvasActions?.length) return null;
  return createGenerationApprovalRequest({
    projectId: session.id,
    sessionId: session.id,
    title: output.confirmation.title,
    summary: output.confirmation.summary,
    generation: output.generation,
    approvalId: output.confirmation.id,
    estimatedCredits: 0,
    requestedBy: "agent"
  });
}

function createPendingConfirmationFromApproval(
  output: LlmAgentOutput,
  approval: ApprovalRequestRecord
): PendingAgentConfirmation {
  const confirmation = output.confirmation;
  const isGenerationApproval = approval.kind === "generation";
  return {
    id: approval.id,
    kind: isGenerationApproval ? "controlled_generation" : "canvas_proposal",
    title: confirmation?.title ?? approval.title,
    summary: confirmation?.summary ?? approval.summary,
    bullets: confirmation?.bullets ?? [],
    confirmLabel: confirmation?.confirmLabel ?? "确认方案",
    secondaryLabel: confirmation?.secondaryLabel ?? "先调整",
    actions: approval.requestedActions,
    completionMessage: isGenerationApproval
      ? "已开始真实生成，任务状态会在下方持续更新。"
      : "已按确认方案创建/更新画布结构。没有生成媒体，也没有扣 credits。",
    nextStage: isGenerationApproval ? "executing" : "collecting",
    generation: isGenerationApproval ? output.generation : undefined,
    approvalRequestId: approval.id,
    actionHash: approval.actionHash,
    idempotencyKey: approval.idempotencyKey,
    affectedNodeIds: approval.affectedNodeIds,
    estimatedCredits: approval.estimatedCredits ?? 0
  };
}

function createDecisionFailureMessage(error: unknown, retryText: string): AgentMessage {
  const fallbackReason = getFallbackReason(error);
  if (process.env.NODE_ENV !== "production") {
    console.warn("[ad-studio-agent] decision failed", {
      fallbackReason,
      status: error instanceof AgentDecideRequestError ? error.status : undefined,
      reason: error instanceof AgentDecideRequestError ? error.reason : undefined,
      runtime: error instanceof AgentDecideRequestError ? error.runtime : undefined,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const body = getFailureBody(error);
  return createMessage(
    "system",
    body,
    [
      {
        kind: "status",
        label: "error",
        detail: "连接失败，可重试"
      },
      {
        kind: "text",
        text: body
      },
      {
        kind: "retry",
        label: "重新连接 Agent",
        text: retryText
      }
    ],
    {
      fallbackUsed: true,
      fallbackReason,
      errorReason: error instanceof AgentDecideRequestError ? error.reason : undefined,
      developerError: error instanceof Error ? error.message : String(error),
      providerMetadata: error instanceof AgentDecideRequestError ? error.runtime : undefined
    }
  );
}

function quickActionToText(action: AgentQuickAction) {
  const labels: Record<AgentQuickAction, string> = {
    apply_default_boundaries: "用推荐边界继续",
    strict_plot: "参考程度：严格复刻剧情结构",
    structure_only: "参考程度：只参考节奏和叙事结构",
    confirm_pending: "确认执行",
    request_adjustment: "我想先调整方案",
    generate_storyboard_video: "确认生成分镜和视频",
    rework_icon: "App icon 不准确，需要局部返工",
    add_subtitles: "给结果加字幕"
  };
  return labels[action];
}

async function decide(
  state: AgentRuntimeState,
  text: string,
  session: AgentSession,
  canvas?: CanvasSnapshot,
  options: DecideOptions = {}
) {
  const shouldAppendUserMessage = options.appendUserMessage !== false;
  const modelState: AgentRuntimeState = shouldAppendUserMessage
    ? {
        ...state,
        messages: [...state.messages, createMessage("user", text)]
      }
    : state;
  const visibleState = options.showUserMessage === false || !shouldAppendUserMessage ? state : modelState;

  try {
    const result = await decideWithGemini(createAgentInputSnapshot(session, modelState, canvas));
    const output = result.output;
    const generationApprovalRequest = createGenerationApprovalBuildResult(output, session);
    const approvalBuildResult = generationApprovalRequest ? null : createApprovalBuildResult(output, session, canvas);
    const approvalRequest = approvalBuildResult?.approval;
    const durableApprovalRequest = generationApprovalRequest ?? approvalRequest;
    const pendingConfirmation = durableApprovalRequest
      ? createPendingConfirmationFromApproval(output, durableApprovalRequest)
      : null;
    const approvalDebugLog = approvalBuildResult && (!approvalBuildResult.ok || approvalBuildResult.warnings.length)
      ? {
          kind: "canvas_approval_validation",
          details: {
            ok: approvalBuildResult.ok,
            errors: approvalBuildResult.errors,
            warnings: approvalBuildResult.warnings,
            actionHash: approvalBuildResult.actionHash,
            idempotencyKey: approvalBuildResult.idempotencyKey,
            affectedNodeIds: approvalBuildResult.affectedNodeIds,
            canvasActions: output.canvasActions ?? []
          }
        }
      : undefined;
    const outputEvents = llmAgentOutputToEvents(output, {
      approvalRequest: durableApprovalRequest,
      generation: pendingConfirmation?.generation,
      approvalErrors: approvalBuildResult && !approvalBuildResult.ok ? approvalBuildResult.errors : undefined,
      approvalWarnings: approvalBuildResult?.warnings
    });

    return {
      state: {
        ...visibleState,
        stage: pendingConfirmation ? "awaiting_confirmation" : getStageForOutput(output, visibleState.stage),
        brief: {
          ...visibleState.brief,
          ...output.briefPatch
        },
        pendingConfirmation,
        fallback: null,
        messages: [
          ...visibleState.messages,
          createMessage("assistant", output.message, outputEvents, {
            providerMetadata: result.runtime,
            debugLog: approvalDebugLog
          })
        ]
      },
      approvalRequest: durableApprovalRequest
    };
  } catch (error) {
    return {
      state: {
        ...visibleState,
        stage: "collecting" as const,
        fallback: {
          fallbackUsed: true,
          fallbackReason: getFallbackReason(error)
        },
        messages: [
          ...visibleState.messages,
          createDecisionFailureMessage(error, text.trim() || getLatestUserMessageText(modelState))
        ]
      }
    };
  }
}

export function submitInternalAgentTask(
  state: AgentRuntimeState,
  text: string,
  session: AgentSession,
  canvas?: CanvasSnapshot
) {
  return decide(state, text, session, canvas, { showUserMessage: false });
}

export function resumeAgentDecision(
  state: AgentRuntimeState,
  session: AgentSession,
  canvas?: CanvasSnapshot
) {
  return decide(state, "", session, canvas, { appendUserMessage: false, showUserMessage: false });
}

export const llmAgentController: AgentController = {
  start(session) {
    return { state: createInitialLlmAgentRuntime(session) };
  },
  async submitText(state: AgentRuntimeState, text: string, session?: AgentSession, canvas?: CanvasSnapshot) {
    if (!session) return { state };
    return decide(state, text, session, canvas);
  },
  submitQuickAction(state, action, session, canvas) {
    if (!session) return { state };
    return decide(state, quickActionToText(action), session, canvas);
  }
};
