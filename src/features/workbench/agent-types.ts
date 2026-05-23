import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { ControlledGenerationRequest } from "@/features/agent-runtime/generation-executor";
import type { AgentEvent, AgentIntakeSubmissionFact } from "@/features/agent-runtime/agent-events";
import type { AgentArtifacts } from "@/features/agent-runtime/artifacts";
import type {
  AgentProviderErrorReason,
  AgentProviderMetadata
} from "@/features/agent-runtime/ai-sdk/provider-metadata";

export type AgentWorkflowStage =
  | "collecting"
  | "awaiting_confirmation"
  | "executing"
  | "script_review"
  | "asset_review"
  | "storyboard_review"
  | "rework";

export type AgentConfirmationKind =
  | "strategy"
  | "script_assets"
  | "storyboard_video"
  | "controlled_generation"
  | "rework_icon"
  | "subtitles"
  | "canvas_proposal";

export type AgentQuickAction =
  | "apply_default_boundaries"
  | "strict_plot"
  | "structure_only"
  | "confirm_pending"
  | "request_adjustment"
  | "generate_storyboard_video"
  | "rework_icon"
  | "add_subtitles";

export type AgentQuestionOption = {
  id: AgentQuickAction;
  label: string;
  description: string;
};

export type AgentCard =
  | {
      kind: "question";
      title: string;
      body: string;
      options: AgentQuestionOption[];
    }
  | {
      kind: "confirmation";
      confirmationId: string;
      title: string;
      summary: string;
      bullets: string[];
      confirmLabel: string;
      secondaryLabel?: string;
    }
  | {
      kind: "actionTrace";
      title: string;
      status: "running" | "done";
      items: string[];
    };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
  card?: AgentCard;
  events?: AgentEvent[];
  metadata?: {
    intakeSubmission?: AgentIntakeSubmissionFact;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    errorReason?: AgentProviderErrorReason | string;
    developerError?: string;
    debugLog?: {
      kind: string;
      details: unknown;
    };
    providerMetadata?: Partial<AgentProviderMetadata>;
  };
};

export type AgentProductionBrief = {
  product: string;
  competitorAsset: string;
  referenceMode: string;
  subjectFocus: string;
  audioSubtitle: string;
  language: string;
  channel: string;
  ratio: string;
  duration: string;
  originalPrompt: string;
};

export type AgentNodeRefs = {
  productPack: string;
  competitorAsset: string;
  analysis: string;
  cloneStrategy: string;
  script: string;
  appUi: string;
  character: string;
  scene: string;
  shotPromptC1: string;
  storyboardC1: string;
  finalVideo: string;
};

export type PendingAgentConfirmation = {
  id: string;
  kind: AgentConfirmationKind;
  title: string;
  summary: string;
  bullets: string[];
  confirmLabel: string;
  secondaryLabel?: string;
  actions: CanvasRuntimeAction[];
  completionMessage: string;
  nextStage: AgentWorkflowStage;
  nextConfirmation?: PendingAgentConfirmation;
  generation?: ControlledGenerationRequest;
  approvalRequestId?: string;
  actionHash?: string;
  idempotencyKey?: string;
  affectedNodeIds?: string[];
  estimatedCredits?: number;
};

export type AgentRuntimeState = {
  stage: AgentWorkflowStage;
  brief: AgentProductionBrief;
  messages: AgentMessage[];
  pendingConfirmation: PendingAgentConfirmation | null;
  nodeRefs: AgentNodeRefs;
  artifacts?: AgentArtifacts;
  intakeSubmissions?: AgentIntakeSubmissionFact[];
  fallback?: {
    fallbackUsed: boolean;
    fallbackReason?: string;
  } | null;
  actionHistory: Array<{
    id: string;
    title: string;
    actionCount: number;
    createdAt: string;
  }>;
};

export type AgentTransition = {
  state: AgentRuntimeState;
  canvasActions?: CanvasRuntimeAction[];
};
