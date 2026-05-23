import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { PendingAgentConfirmation } from "@/features/workbench/agent-types";
import type { ApprovalRequestKind, ApprovalRequestStatus } from "@/lib/agent-project-store";
import type { AgentAssetRole, AgentUploadedAsset } from "@/lib/domain/schemas";

export type AgentQuestionFieldType =
  | "radio"
  | "checkbox"
  | "text"
  | "textarea"
  | "upload"
  | "product_asset"
  | "confirmation";

export type AgentQuestionOption = {
  id: string;
  label: string;
  description?: string;
};

export type AgentQuestionField = {
  id: string;
  label: string;
  type: AgentQuestionFieldType;
  display?: "segmented";
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: AgentQuestionOption[];
  maxSelections?: number;
  accept?: string;
  multiple?: boolean;
  uploadRole?: AgentAssetRole;
  requiredGroup?: string;
  requiredGroupLabel?: string;
};

export type AgentQuestionForm = {
  id: string;
  title: string;
  description?: string;
  fields: AgentQuestionField[];
  submitLabel?: string;
};

export type AgentQuestionSubmittedAsset = Pick<AgentUploadedAsset, "id" | "name" | "kind" | "previewUrl"> & {
  fieldId: string;
  uploadRole?: AgentAssetRole;
  source?: AgentUploadedAsset["source"];
};

export type AgentQuestionAnswerValue = string | string[] | AgentQuestionSubmittedAsset[];

export type AgentQuestionSubmission = {
  formId: string;
  title: string;
  answers: Record<string, AgentQuestionAnswerValue>;
  assets: AgentQuestionSubmittedAsset[];
  summary: string;
};

export type AgentIntakeSubmissionFact = {
  formId: string;
  title: string;
  answers: Record<string, AgentQuestionAnswerValue>;
  uploadedAssetIds: string[];
  selectedProductAssetId?: string;
  productName?: string;
  submittedAt: string;
  sourceMessageId: string;
};

export type AgentConfirmationEvent = Pick<
  PendingAgentConfirmation,
  "id" | "title" | "summary" | "bullets" | "confirmLabel" | "secondaryLabel" | "generation"
> & {
  kind?: PendingAgentConfirmation["kind"];
  executable?: boolean;
  approvalKind?: ApprovalRequestKind;
  approvalRequestId?: string;
  actionHash?: string;
  idempotencyKey?: string;
  affectedNodeIds?: string[];
  estimatedCredits?: number;
  actions?: CanvasRuntimeAction[];
  status?: ApprovalRequestStatus;
};

export type AgentEvent =
  | { kind: "text"; text: string }
  | {
      kind: "status";
      label:
        | "thinking"
        | "planning"
        | "waiting_user"
        | "executing"
        | "done"
        | "error"
        | "received";
      detail?: string;
    }
  | { kind: "question"; form: AgentQuestionForm }
  | { kind: "intake_submission"; submission: AgentIntakeSubmissionFact }
  | { kind: "retry"; label: string; text: string }
  | { kind: "confirmation"; confirmation: AgentConfirmationEvent }
  | {
      kind: "canvas_action";
      action: CanvasRuntimeAction;
      status: "pending" | "running" | "done" | "failed";
    }
  | { kind: "node_result"; nodeId: string; summary: string }
  | { kind: "warning"; text: string };
