import {
  artifactStatusSchema,
  type ArtifactSource,
  type ArtifactStatus,
  type ArtifactSummary
} from "@/features/agent-runtime/artifacts";
import type { CanvasSnapshot } from "@/features/agent-runtime/agent-snapshot";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { GenerationParamValue, GenerationSlotInput } from "@/features/generation/types";
import {
  canvasEdgeSchema,
  canvasNodeSchema,
  type AgentMediaAnalysis,
  type AgentMode,
  type AgentProjectLifecycle,
  type AgentSession,
  type CanvasEdge,
  type CanvasNode
} from "@/lib/domain/schemas";

export type AgentProjectLifecycleV2 = AgentProjectLifecycle | "archived";

export type AgentProjectRecord = {
  schemaVersion: 1;
  id: string;
  title: string;
  productName?: string;
  mode: AgentMode;
  lifecycle: AgentProjectLifecycleV2;
  activeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type AgentSessionRecordV2 = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  session: AgentSession;
  runtimeSummary?: {
    stage: string;
    messageCount: number;
    pendingApprovalId?: string;
    artifactSummaryCount: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentArtifactEvidenceRef = {
  kind: "asset" | "canvas_node" | "message" | "artifact" | "external";
  refId: string;
  note?: string;
};

export type AgentArtifactRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  artifactType: ArtifactSummary["kind"];
  artifactKey: string;
  status: ArtifactStatus;
  source: ArtifactSource;
  version: number;
  body: unknown;
  summary: ArtifactSummary;
  evidenceRefs: AgentArtifactEvidenceRef[];
  linkedNodeIds: string[];
  linkedTaskIds: string[];
  sourceMessageId?: string;
  sourceToolCallId?: string;
  supersedesArtifactId?: string;
  supersededByArtifactId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequestKind =
  | "action_batch"
  | "generation"
  | "node_overwrite"
  | "locked_anchor_change"
  | "repair_plan"
  | "export";

export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "execution_failed";

export type ApprovalExecutionResult = {
  ok: boolean;
  eventIds: string[];
  taskIds?: string[];
  nodeVersionIds?: string[];
  error?: string;
};

export type ApprovalRequestRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  kind: ApprovalRequestKind;
  title: string;
  summary: string;
  status: ApprovalRequestStatus;
  requestedActions: CanvasRuntimeAction[];
  actionHash: string;
  idempotencyKey: string;
  affectedNodeIds: string[];
  affectedArtifactIds: string[];
  estimatedCredits?: number;
  actualCredits?: number;
  expiresAt?: string;
  requestedBy?: string;
  respondedBy?: string;
  requestedAt: string;
  respondedAt?: string;
  executedAt?: string;
  executionResult?: ApprovalExecutionResult;
};

export type CanvasGraphRecord = {
  schemaVersion: 1;
  projectId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  graphVersion: string;
  updatedAt: string;
};

export type CanvasSnapshotRecord = CanvasSnapshot & {
  schemaVersion: 1;
  projectId: string;
  derivedFromGraphVersion: string;
  createdAt: string;
};

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type GenerationTaskRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  nodeId?: string;
  nodeVersionId?: string;
  artifactId?: string;
  approvalRequestId?: string;
  kind: "image" | "video" | "audio" | "text";
  surface: "standalone" | "canvas" | "agent";
  provider: string;
  providerTaskId?: string;
  modelId: string;
  modelName: string;
  modeKey: string;
  prompt: string;
  params: Record<string, GenerationParamValue>;
  slots: GenerationSlotInput[];
  status: GenerationTaskStatus;
  progress: number;
  credits: number;
  costUsd?: number;
  outputAssetId?: string;
  output?: {
    kind: "image" | "video" | "audio" | "text";
    title: string;
    assetUrl?: string;
    downloadUrl?: string;
    ratio?: string;
  };
  errorCode?: string;
  errorMessage?: string;
  idempotencyKey: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type MediaAssetRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  kind: "product" | "image" | "video" | "audio" | "file" | "thumbnail" | "keyframe";
  role:
    | "product_pack"
    | "competitor_asset"
    | "reference_asset"
    | "generated_output"
    | "storyboard_frame"
    | "canvas_version_asset";
  source: "upload" | "generation" | "mock" | "external_url";
  originalFileName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  storage?: {
    provider: "local_json" | "supabase_storage" | "vercel_blob" | "external";
    key?: string;
    publicUrl?: string;
    signedUrlExpiresAt?: string;
  };
  recoverable?: boolean;
  analysisStatus?: "idle" | "running" | "succeeded" | "failed";
  analysis?: AgentMediaAnalysis;
  createdAt: string;
  updatedAt: string;
};

export type AgentEventActorType = "user" | "agent" | "system" | "tool" | "provider";

export type AgentEventLogType =
  | "project.updated"
  | "project.archived"
  | "message.created"
  | "artifact.created"
  | "artifact.versioned"
  | "artifact.status_changed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.executing"
  | "approval.executed"
  | "approval.execution_failed"
  | "tool.called"
  | "tool.blocked"
  | "canvas.node.created"
  | "canvas.node.updated"
  | "canvas.node.locked"
  | "canvas.downstream_stale_marked"
  | "generation.queued"
  | "generation.provider_task_created"
  | "generation.status_changed"
  | "generation.succeeded"
  | "generation.failed"
  | "generation.cancelled"
  | "asset.uploaded"
  | "asset.persisted"
  | "asset.not_persisted"
  | "repair.proposed";

export type AgentEventLogRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  sequence: number;
  actorType: AgentEventActorType;
  actorId?: string;
  eventType: AgentEventLogType;
  objectType?: string;
  objectId?: string;
  correlationId?: string;
  requestId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CreateAgentEventInput = Omit<AgentEventLogRecord, "schemaVersion" | "id" | "sequence" | "createdAt"> & {
  id?: string;
  sequence?: number;
  createdAt?: string;
};

export type UpdateApprovalStatusInput = {
  projectId: string;
  approvalRequestId: string;
  status: ApprovalRequestStatus;
  respondedBy?: string;
  respondedAt?: string;
  executedAt?: string;
  actualCredits?: number;
  executionResult?: ApprovalExecutionResult;
};

export type AgentProjectBundle = {
  schemaVersion: 1;
  project: AgentProjectRecord;
  sessions: AgentSessionRecordV2[];
  artifacts: AgentArtifactRecord[];
  approvalRequests: ApprovalRequestRecord[];
  canvasGraph: CanvasGraphRecord;
  generationTasks: GenerationTaskRecord[];
  mediaAssets: MediaAssetRecord[];
  events: AgentEventLogRecord[];
  updatedAt: string;
};

export type AgentProjectPatch = Partial<
  Pick<
    AgentProjectBundle,
    "project" | "sessions" | "artifacts" | "approvalRequests" | "canvasGraph" | "generationTasks" | "mediaAssets"
  >
> & {
  events?: CreateAgentEventInput[];
  updatedAt?: string;
};

export type AgentProjectStore = {
  loadProject(projectId: string): Promise<AgentProjectBundle | null>;
  saveProjectPatch(projectId: string, patch: AgentProjectPatch): Promise<AgentProjectBundle>;
  archiveProject(projectId: string): Promise<void>;
  updateApprovalStatus(input: UpdateApprovalStatusInput): Promise<ApprovalRequestRecord>;
  appendEvent(event: CreateAgentEventInput): Promise<AgentEventLogRecord>;
};

type AgentProjectWorkspaceEnvelope = Record<string, unknown> & {
  projectBundles?: unknown;
};

const agentModes = new Set<AgentMode>(["clone", "create"]);
const projectLifecycles = new Set<AgentProjectLifecycleV2>([
  "empty",
  "intake",
  "ready",
  "producing",
  "paused",
  "archived"
]);
const artifactTypes = new Set<ArtifactSummary["kind"]>([
  "referenceAnalysis",
  "creativePlan",
  "anchorRegistry",
  "scriptDoc",
  "clipTable",
  "promptPack",
  "workflowPlan",
  "repairPlan"
]);
const artifactSources = new Set<ArtifactSource>(["fact", "model_suggestion", "user_confirmation", "mixed"]);
const approvalKinds = new Set<ApprovalRequestKind>([
  "action_batch",
  "generation",
  "node_overwrite",
  "locked_anchor_change",
  "repair_plan",
  "export"
]);
const approvalStatuses = new Set<ApprovalRequestStatus>([
  "pending",
  "approved",
  "rejected",
  "executing",
  "executed",
  "execution_failed"
]);
const generationTaskStatuses = new Set<GenerationTaskStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);
const eventActorTypes = new Set<AgentEventActorType>(["user", "agent", "system", "tool", "provider"]);
const eventTypes = new Set<AgentEventLogType>([
  "project.updated",
  "project.archived",
  "message.created",
  "artifact.created",
  "artifact.versioned",
  "artifact.status_changed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.executing",
  "approval.executed",
  "approval.execution_failed",
  "tool.called",
  "tool.blocked",
  "canvas.node.created",
  "canvas.node.updated",
  "canvas.node.locked",
  "canvas.downstream_stale_marked",
  "generation.queued",
  "generation.provider_task_created",
  "generation.status_changed",
  "generation.succeeded",
  "generation.failed",
  "generation.cancelled",
  "asset.uploaded",
  "asset.persisted",
  "asset.not_persisted",
  "repair.proposed"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function timestampOrNow(value: unknown, now = new Date().toISOString()) {
  return typeof value === "string" && value.trim() ? value : now;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeProjectRecord(value: unknown, fallbackProjectId: string, now = new Date().toISOString()): AgentProjectRecord {
  const source = isRecord(value) ? value : {};
  const id = stringOrUndefined(source.id) ?? fallbackProjectId;
  const mode = typeof source.mode === "string" && agentModes.has(source.mode as AgentMode)
    ? (source.mode as AgentMode)
    : "clone";
  const lifecycle = typeof source.lifecycle === "string" && projectLifecycles.has(source.lifecycle as AgentProjectLifecycleV2)
    ? (source.lifecycle as AgentProjectLifecycleV2)
    : "empty";

  return {
    schemaVersion: 1,
    id,
    title: stringOrUndefined(source.title) ?? "未命名项目",
    productName: stringOrUndefined(source.productName),
    mode,
    lifecycle,
    activeSessionId: stringOrUndefined(source.activeSessionId),
    createdAt: timestampOrNow(source.createdAt, now),
    updatedAt: timestampOrNow(source.updatedAt, now),
    archivedAt: stringOrUndefined(source.archivedAt)
  };
}

function normalizeAgentSessionRecordV2(value: unknown, projectId: string, now = new Date().toISOString()): AgentSessionRecordV2 | null {
  if (!isRecord(value) || !isRecord(value.session)) return null;
  const session = value.session as Partial<AgentSession>;
  const id = stringOrUndefined(value.id) ?? stringOrUndefined(session.id);
  if (!id) return null;

  return {
    schemaVersion: 1,
    id,
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    session: {
      ...(value.session as AgentSession),
      id
    },
    runtimeSummary: normalizeRuntimeSummary(value.runtimeSummary),
    createdAt: timestampOrNow(value.createdAt, now),
    updatedAt: timestampOrNow(value.updatedAt, now)
  };
}

function normalizeRuntimeSummary(value: unknown): AgentSessionRecordV2["runtimeSummary"] {
  if (!isRecord(value)) return undefined;
  return {
    stage: stringOrUndefined(value.stage) ?? "collecting",
    messageCount: numberOrUndefined(value.messageCount) ?? 0,
    pendingApprovalId: stringOrUndefined(value.pendingApprovalId),
    artifactSummaryCount: numberOrUndefined(value.artifactSummaryCount) ?? 0
  };
}

function normalizeArtifactEvidenceRefs(value: unknown): AgentArtifactEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AgentArtifactEvidenceRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const kind = stringOrUndefined(item.kind);
    const refId = stringOrUndefined(item.refId);
    if (
      !kind ||
      !refId ||
      !["asset", "canvas_node", "message", "artifact", "external"].includes(kind)
    ) {
      continue;
    }
    refs.push({
      kind: kind as AgentArtifactEvidenceRef["kind"],
      refId,
      ...(stringOrUndefined(item.note) ? { note: stringOrUndefined(item.note) } : {})
    });
  }
  return refs;
}

function normalizeArtifactSummary(value: unknown): ArtifactSummary | null {
  if (!isRecord(value)) return null;
  const kind = stringOrUndefined(value.kind);
  const id = stringOrUndefined(value.id);
  const parsedStatus = artifactStatusSchema.safeParse(value.status);
  const source = stringOrUndefined(value.source);
  const summary = stringOrUndefined(value.summary);
  if (!kind || !id || !artifactTypes.has(kind as ArtifactSummary["kind"]) || !parsedStatus.success || !source || !artifactSources.has(source as ArtifactSource) || !summary) {
    return null;
  }

  return {
    kind: kind as ArtifactSummary["kind"],
    id,
    source: source as ArtifactSource,
    status: parsedStatus.data,
    title: stringOrUndefined(value.title),
    summary,
    factRefs: stringArray(value.factRefs),
    modelSuggestionRefs: stringArray(value.modelSuggestionRefs),
    needsUserConfirmation: Boolean(value.needsUserConfirmation),
    userConfirmationFields: stringArray(value.userConfirmationFields)
  };
}

function normalizeArtifactRecord(value: unknown, projectId: string, now = new Date().toISOString()): AgentArtifactRecord | null {
  if (!isRecord(value)) return null;
  const id = stringOrUndefined(value.id);
  const artifactType = stringOrUndefined(value.artifactType);
  const artifactKey = stringOrUndefined(value.artifactKey);
  const parsedStatus = artifactStatusSchema.safeParse(value.status);
  const source = stringOrUndefined(value.source);
  const version = numberOrUndefined(value.version);
  const summary = normalizeArtifactSummary(value.summary);
  if (
    !id ||
    !artifactType ||
    !artifactTypes.has(artifactType as ArtifactSummary["kind"]) ||
    !artifactKey ||
    !parsedStatus.success ||
    !source ||
    !artifactSources.has(source as ArtifactSource) ||
    !version ||
    !summary
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    id,
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    sessionId: stringOrUndefined(value.sessionId),
    artifactType: artifactType as ArtifactSummary["kind"],
    artifactKey,
    status: parsedStatus.data,
    source: source as ArtifactSource,
    version,
    body: value.body,
    summary,
    evidenceRefs: normalizeArtifactEvidenceRefs(value.evidenceRefs),
    linkedNodeIds: stringArray(value.linkedNodeIds),
    linkedTaskIds: stringArray(value.linkedTaskIds),
    sourceMessageId: stringOrUndefined(value.sourceMessageId),
    sourceToolCallId: stringOrUndefined(value.sourceToolCallId),
    supersedesArtifactId: stringOrUndefined(value.supersedesArtifactId),
    supersededByArtifactId: stringOrUndefined(value.supersededByArtifactId),
    createdAt: timestampOrNow(value.createdAt, now),
    updatedAt: timestampOrNow(value.updatedAt, now)
  };
}

function normalizeApprovalRequest(value: unknown, projectId: string, now = new Date().toISOString()): ApprovalRequestRecord | null {
  if (!isRecord(value)) return null;
  const id = stringOrUndefined(value.id);
  const kind = stringOrUndefined(value.kind);
  const status = stringOrUndefined(value.status);
  const title = stringOrUndefined(value.title);
  const summary = stringOrUndefined(value.summary);
  const actionHash = stringOrUndefined(value.actionHash);
  const idempotencyKey = stringOrUndefined(value.idempotencyKey);
  if (
    !id ||
    !kind ||
    !approvalKinds.has(kind as ApprovalRequestKind) ||
    !status ||
    !approvalStatuses.has(status as ApprovalRequestStatus) ||
    !title ||
    !summary ||
    !actionHash ||
    !idempotencyKey
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    id,
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    sessionId: stringOrUndefined(value.sessionId),
    kind: kind as ApprovalRequestKind,
    title,
    summary,
    status: status as ApprovalRequestStatus,
    requestedActions: Array.isArray(value.requestedActions) ? (value.requestedActions as CanvasRuntimeAction[]) : [],
    actionHash,
    idempotencyKey,
    affectedNodeIds: stringArray(value.affectedNodeIds),
    affectedArtifactIds: stringArray(value.affectedArtifactIds),
    estimatedCredits: numberOrUndefined(value.estimatedCredits),
    actualCredits: numberOrUndefined(value.actualCredits),
    expiresAt: stringOrUndefined(value.expiresAt),
    requestedBy: stringOrUndefined(value.requestedBy),
    respondedBy: stringOrUndefined(value.respondedBy),
    requestedAt: timestampOrNow(value.requestedAt, now),
    respondedAt: stringOrUndefined(value.respondedAt),
    executedAt: stringOrUndefined(value.executedAt),
    executionResult: normalizeApprovalExecutionResult(value.executionResult)
  };
}

function normalizeApprovalExecutionResult(value: unknown): ApprovalExecutionResult | undefined {
  if (!isRecord(value)) return undefined;
  const ok = booleanOrUndefined(value.ok);
  if (ok === undefined) return undefined;
  return {
    ok,
    eventIds: stringArray(value.eventIds),
    taskIds: stringArray(value.taskIds),
    nodeVersionIds: stringArray(value.nodeVersionIds),
    error: stringOrUndefined(value.error)
  };
}

function normalizeCanvasGraph(value: unknown, projectId: string, now = new Date().toISOString()): CanvasGraphRecord {
  const source = isRecord(value) ? value : {};
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .map((node) => canvasNodeSchema.safeParse(node))
        .filter((node): node is { success: true; data: CanvasNode } => node.success)
        .map((node) => node.data)
    : [];
  const edges = Array.isArray(source.edges)
    ? source.edges
        .map((edge) => canvasEdgeSchema.safeParse(edge))
        .filter((edge): edge is { success: true; data: CanvasEdge } => edge.success)
        .map((edge) => edge.data)
    : [];

  return {
    schemaVersion: 1,
    projectId: stringOrUndefined(source.projectId) ?? projectId,
    nodes,
    edges,
    graphVersion: stringOrUndefined(source.graphVersion) ?? `graph-${now}`,
    updatedAt: timestampOrNow(source.updatedAt, now)
  };
}

function normalizeGenerationTask(value: unknown, projectId: string, now = new Date().toISOString()): GenerationTaskRecord | null {
  if (!isRecord(value)) return null;
  const id = stringOrUndefined(value.id);
  const kind = stringOrUndefined(value.kind);
  const surface = stringOrUndefined(value.surface);
  const provider = stringOrUndefined(value.provider);
  const modelId = stringOrUndefined(value.modelId);
  const modelName = stringOrUndefined(value.modelName);
  const modeKey = stringOrUndefined(value.modeKey);
  const prompt = stringOrUndefined(value.prompt);
  const status = stringOrUndefined(value.status);
  const progress = numberOrUndefined(value.progress);
  const credits = numberOrUndefined(value.credits);
  const idempotencyKey = stringOrUndefined(value.idempotencyKey);
  if (
    !id ||
    !kind ||
    !["image", "video", "audio", "text"].includes(kind) ||
    !surface ||
    !["standalone", "canvas", "agent"].includes(surface) ||
    !provider ||
    !modelId ||
    !modelName ||
    !modeKey ||
    !prompt ||
    !status ||
    !generationTaskStatuses.has(status as GenerationTaskStatus) ||
    progress === undefined ||
    credits === undefined ||
    !idempotencyKey
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    id,
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    sessionId: stringOrUndefined(value.sessionId),
    nodeId: stringOrUndefined(value.nodeId),
    nodeVersionId: stringOrUndefined(value.nodeVersionId),
    artifactId: stringOrUndefined(value.artifactId),
    approvalRequestId: stringOrUndefined(value.approvalRequestId),
    kind: kind as GenerationTaskRecord["kind"],
    surface: surface as GenerationTaskRecord["surface"],
    provider,
    providerTaskId: stringOrUndefined(value.providerTaskId),
    modelId,
    modelName,
    modeKey,
    prompt,
    params: isRecord(value.params) ? (value.params as Record<string, GenerationParamValue>) : {},
    slots: Array.isArray(value.slots) ? (value.slots as GenerationSlotInput[]) : [],
    status: status as GenerationTaskStatus,
    progress,
    credits,
    costUsd: numberOrUndefined(value.costUsd),
    outputAssetId: stringOrUndefined(value.outputAssetId),
    output: normalizeGenerationTaskOutput(value.output),
    errorCode: stringOrUndefined(value.errorCode),
    errorMessage: stringOrUndefined(value.errorMessage),
    idempotencyKey,
    createdAt: timestampOrNow(value.createdAt, now),
    startedAt: stringOrUndefined(value.startedAt),
    completedAt: stringOrUndefined(value.completedAt),
    updatedAt: timestampOrNow(value.updatedAt, now)
  };
}

function normalizeGenerationTaskOutput(value: unknown): GenerationTaskRecord["output"] {
  if (!isRecord(value)) return undefined;
  const kind = stringOrUndefined(value.kind);
  const title = stringOrUndefined(value.title);
  if (!kind || !["image", "video", "audio", "text"].includes(kind) || !title) return undefined;
  return {
    kind: kind as GenerationTaskRecord["kind"],
    title,
    assetUrl: stringOrUndefined(value.assetUrl),
    downloadUrl: stringOrUndefined(value.downloadUrl),
    ratio: stringOrUndefined(value.ratio)
  };
}

function normalizeMediaAsset(value: unknown, projectId: string, now = new Date().toISOString()): MediaAssetRecord | null {
  if (!isRecord(value)) return null;
  const id = stringOrUndefined(value.id);
  const kind = stringOrUndefined(value.kind);
  const role = stringOrUndefined(value.role);
  const source = stringOrUndefined(value.source);
  if (
    !id ||
    !kind ||
    !["product", "image", "video", "audio", "file", "thumbnail", "keyframe"].includes(kind) ||
    !role ||
    !["product_pack", "competitor_asset", "reference_asset", "generated_output", "storyboard_frame", "canvas_version_asset"].includes(role) ||
    !source ||
    !["upload", "generation", "mock", "external_url"].includes(source)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    id,
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    sessionId: stringOrUndefined(value.sessionId),
    kind: kind as MediaAssetRecord["kind"],
    role: role as MediaAssetRecord["role"],
    source: source as MediaAssetRecord["source"],
    originalFileName: stringOrUndefined(value.originalFileName),
    mimeType: stringOrUndefined(value.mimeType),
    byteSize: numberOrUndefined(value.byteSize),
    width: numberOrUndefined(value.width),
    height: numberOrUndefined(value.height),
    durationMs: numberOrUndefined(value.durationMs),
    storage: normalizeMediaAssetStorage(value.storage),
    recoverable: booleanOrUndefined(value.recoverable),
    analysisStatus: normalizeMediaAnalysisStatus(value.analysisStatus),
    analysis: isRecord(value.analysis) ? (value.analysis as AgentMediaAnalysis) : undefined,
    createdAt: timestampOrNow(value.createdAt, now),
    updatedAt: timestampOrNow(value.updatedAt, now)
  };
}

function normalizeMediaAssetStorage(value: unknown): MediaAssetRecord["storage"] {
  if (!isRecord(value)) return undefined;
  const provider = stringOrUndefined(value.provider);
  if (!provider || !["local_json", "supabase_storage", "vercel_blob", "external"].includes(provider)) return undefined;
  return {
    provider: provider as NonNullable<MediaAssetRecord["storage"]>["provider"],
    key: stringOrUndefined(value.key),
    publicUrl: stringOrUndefined(value.publicUrl),
    signedUrlExpiresAt: stringOrUndefined(value.signedUrlExpiresAt)
  };
}

function normalizeMediaAnalysisStatus(value: unknown): MediaAssetRecord["analysisStatus"] {
  return typeof value === "string" && ["idle", "running", "succeeded", "failed"].includes(value)
    ? (value as MediaAssetRecord["analysisStatus"])
    : undefined;
}

function normalizeEventRecord(value: unknown, projectId: string, fallbackSequence = 0, now = new Date().toISOString()): AgentEventLogRecord | null {
  if (!isRecord(value)) return null;
  const actorType = stringOrUndefined(value.actorType);
  const eventType = stringOrUndefined(value.eventType);
  if (!actorType || !eventActorTypes.has(actorType as AgentEventActorType) || !eventType || !eventTypes.has(eventType as AgentEventLogType)) {
    return null;
  }

  return {
    schemaVersion: 1,
    id: stringOrUndefined(value.id) ?? createLocalId("event"),
    projectId: stringOrUndefined(value.projectId) ?? projectId,
    sessionId: stringOrUndefined(value.sessionId),
    sequence: numberOrUndefined(value.sequence) ?? fallbackSequence,
    actorType: actorType as AgentEventActorType,
    actorId: stringOrUndefined(value.actorId),
    eventType: eventType as AgentEventLogType,
    objectType: stringOrUndefined(value.objectType),
    objectId: stringOrUndefined(value.objectId),
    correlationId: stringOrUndefined(value.correlationId),
    requestId: stringOrUndefined(value.requestId),
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt: timestampOrNow(value.createdAt, now)
  };
}

function normalizeEventLog(value: unknown, projectId: string, now = new Date().toISOString()) {
  if (!Array.isArray(value)) return [];
  return value
    .map((event, index) => normalizeEventRecord(event, projectId, index + 1, now))
    .filter((event): event is AgentEventLogRecord => Boolean(event))
    .sort((left, right) => left.sequence - right.sequence || Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function normalizeAgentProjectBundle(value: unknown, fallbackProjectId?: string): AgentProjectBundle | null {
  if (!isRecord(value)) return null;
  const now = new Date().toISOString();
  const inferredProjectId = stringOrUndefined(value.projectId) ?? (isRecord(value.project) ? stringOrUndefined(value.project.id) : undefined) ?? fallbackProjectId;
  if (!inferredProjectId) return null;
  const project = normalizeProjectRecord(value.project, inferredProjectId, now);

  return {
    schemaVersion: 1,
    project,
    sessions: Array.isArray(value.sessions)
      ? value.sessions
          .map((session) => normalizeAgentSessionRecordV2(session, project.id, now))
          .filter((session): session is AgentSessionRecordV2 => Boolean(session))
      : [],
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts
          .map((artifact) => normalizeArtifactRecord(artifact, project.id, now))
          .filter((artifact): artifact is AgentArtifactRecord => Boolean(artifact))
      : [],
    approvalRequests: Array.isArray(value.approvalRequests)
      ? value.approvalRequests
          .map((approval) => normalizeApprovalRequest(approval, project.id, now))
          .filter((approval): approval is ApprovalRequestRecord => Boolean(approval))
      : [],
    canvasGraph: normalizeCanvasGraph(value.canvasGraph, project.id, now),
    generationTasks: Array.isArray(value.generationTasks)
      ? value.generationTasks
          .map((task) => normalizeGenerationTask(task, project.id, now))
          .filter((task): task is GenerationTaskRecord => Boolean(task))
      : [],
    mediaAssets: Array.isArray(value.mediaAssets)
      ? value.mediaAssets
          .map((asset) => normalizeMediaAsset(asset, project.id, now))
          .filter((asset): asset is MediaAssetRecord => Boolean(asset))
      : [],
    events: normalizeEventLog(value.events, project.id, now),
    updatedAt: timestampOrNow(value.updatedAt ?? project.updatedAt, now)
  };
}

export function normalizeAgentProjectBundles(value: unknown): AgentProjectBundle[] {
  if (!Array.isArray(value)) return [];
  const bundles = new Map<string, AgentProjectBundle>();
  for (const item of value) {
    const bundle = normalizeAgentProjectBundle(item);
    if (!bundle) continue;
    const existing = bundles.get(bundle.project.id);
    if (!existing || compareTimestamp(existing.updatedAt, bundle.updatedAt) <= 0) {
      bundles.set(bundle.project.id, bundle);
    }
  }
  return Array.from(bundles.values()).sort((left, right) => compareTimestamp(right.updatedAt, left.updatedAt));
}

export function createEmptyCanvasGraph(projectId: string, now = new Date().toISOString()): CanvasGraphRecord {
  return {
    schemaVersion: 1,
    projectId,
    nodes: [],
    edges: [],
    graphVersion: `graph-${now}`,
    updatedAt: now
  };
}

export function createEmptyAgentProjectBundle(input: {
  projectId: string;
  title?: string;
  mode?: AgentMode;
  now?: string;
}): AgentProjectBundle {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      id: input.projectId,
      title: input.title ?? "未命名项目",
      mode: input.mode ?? "clone",
      lifecycle: "empty",
      createdAt: now,
      updatedAt: now
    },
    sessions: [],
    artifacts: [],
    approvalRequests: [],
    canvasGraph: createEmptyCanvasGraph(input.projectId, now),
    generationTasks: [],
    mediaAssets: [],
    events: [],
    updatedAt: now
  };
}

export function deriveCanvasSnapshot(graph: CanvasGraphRecord, now = new Date().toISOString()): CanvasSnapshotRecord {
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    businessType: node.businessType,
    title: node.title,
    status: node.status,
    locked: node.locked,
    parentNodeIds: node.parentNodeIds,
    staleReason: node.staleReason
  }));
  return {
    schemaVersion: 1,
    projectId: graph.projectId,
    derivedFromGraphVersion: graph.graphVersion,
    createdAt: now,
    nodes,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label
    })),
    lockedNodeIds: nodes.filter((node) => node.locked).map((node) => node.id),
    staleNodeIds: nodes.filter((node) => node.status === "stale" || node.staleReason).map((node) => node.id)
  };
}

function compareTimestamp(left: string | undefined, right: string | undefined) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return leftTime - rightTime;
}

function getMergeTimestamp(record: { updatedAt?: string; createdAt?: string; requestedAt?: string }) {
  return record.updatedAt ?? record.createdAt ?? record.requestedAt;
}

function mergeById<T extends { id: string; updatedAt?: string; createdAt?: string; requestedAt?: string }>(current: T[], patch: T[] | undefined) {
  if (!patch) return current;
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of patch) {
    const existing = records.get(record.id);
    if (!existing || compareTimestamp(getMergeTimestamp(existing), getMergeTimestamp(record)) <= 0) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values());
}

function nextEventSequence(events: AgentEventLogRecord[]) {
  return events.reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
}

export function createAgentEventRecord(input: CreateAgentEventInput, projectId: string, sequence: number, now = new Date().toISOString()): AgentEventLogRecord {
  const normalized = normalizeEventRecord(
    {
      ...input,
      projectId: input.projectId || projectId,
      id: input.id ?? createLocalId("event"),
      sequence,
      createdAt: input.createdAt ?? now
    },
    projectId,
    sequence,
    now
  );
  if (!normalized) {
    throw new Error("Invalid Agent event log input.");
  }
  return normalized;
}

function appendEvents(
  bundle: AgentProjectBundle,
  events: CreateAgentEventInput[] | undefined,
  now = new Date().toISOString()
) {
  if (!events?.length) return bundle.events;
  let sequence = nextEventSequence(bundle.events);
  const nextEvents = [...bundle.events];
  for (const event of events) {
    nextEvents.push(createAgentEventRecord(event, bundle.project.id, sequence, now));
    sequence += 1;
  }
  return nextEvents;
}

export function applyAgentProjectPatch(projectId: string, current: AgentProjectBundle | null, patch: AgentProjectPatch): AgentProjectBundle {
  const now = patch.updatedAt ?? new Date().toISOString();
  const base = current ?? createEmptyAgentProjectBundle({ projectId, now });
  const project = patch.project
    ? normalizeProjectRecord(
        {
          ...base.project,
          ...patch.project,
          id: projectId,
          updatedAt: patch.project.updatedAt ?? now
        },
        projectId,
        now
      )
    : {
        ...base.project,
        updatedAt: now
      };
  const candidate: AgentProjectBundle = {
    schemaVersion: 1,
    project,
    sessions: mergeById(base.sessions, patch.sessions),
    artifacts: mergeById(base.artifacts, patch.artifacts),
    approvalRequests: mergeById(base.approvalRequests, patch.approvalRequests),
    canvasGraph: patch.canvasGraph ? normalizeCanvasGraph(patch.canvasGraph, projectId, now) : base.canvasGraph,
    generationTasks: mergeById(base.generationTasks, patch.generationTasks),
    mediaAssets: mergeById(base.mediaAssets, patch.mediaAssets),
    events: base.events,
    updatedAt: now
  };
  return {
    ...candidate,
    events: appendEvents(candidate, patch.events, now)
  };
}

function mergeProjectBundleList(bundles: AgentProjectBundle[], bundle: AgentProjectBundle) {
  return normalizeAgentProjectBundles([...bundles.filter((item) => item.project.id !== bundle.project.id), bundle]);
}

function approvalStatusToEventType(status: ApprovalRequestStatus): AgentEventLogType {
  switch (status) {
    case "approved":
      return "approval.approved";
    case "rejected":
      return "approval.rejected";
    case "executing":
      return "approval.executing";
    case "executed":
      return "approval.executed";
    case "execution_failed":
      return "approval.execution_failed";
    case "pending":
    default:
      return "approval.requested";
  }
}

function assertApprovalTransition(current: ApprovalRequestStatus, next: ApprovalRequestStatus) {
  if (current === next) return;
  if (current === "pending" && (next === "approved" || next === "rejected")) return;
  if (current === "approved" && next === "executing") return;
  if (current === "executing" && (next === "executed" || next === "execution_failed")) return;
  throw new Error(`Invalid approval status transition: ${current} -> ${next}.`);
}

export function updateAgentProjectBundleApprovalStatus(bundle: AgentProjectBundle, input: UpdateApprovalStatusInput): AgentProjectBundle {
  const now = new Date().toISOString();
  const approval = bundle.approvalRequests.find((record) => record.id === input.approvalRequestId);
  if (!approval) throw new Error(`Approval request not found: ${input.approvalRequestId}.`);
  assertApprovalTransition(approval.status, input.status);

  const nextApproval: ApprovalRequestRecord = {
    ...approval,
    status: input.status,
    respondedBy: input.respondedBy ?? approval.respondedBy,
    respondedAt: input.status === "approved" || input.status === "rejected"
      ? input.respondedAt ?? approval.respondedAt ?? now
      : approval.respondedAt,
    executedAt: input.status === "executed" || input.status === "execution_failed"
      ? input.executedAt ?? approval.executedAt ?? now
      : approval.executedAt,
    actualCredits: input.actualCredits ?? approval.actualCredits,
    executionResult: input.executionResult ?? approval.executionResult
  };

  const patched = applyAgentProjectPatch(bundle.project.id, bundle, {
    approvalRequests: [nextApproval],
    updatedAt: now,
    events: [
      {
        projectId: bundle.project.id,
        sessionId: nextApproval.sessionId,
        actorType: "system",
        eventType: approvalStatusToEventType(input.status),
        objectType: "approval_request",
        objectId: nextApproval.id,
        payload: {
          previousStatus: approval.status,
          status: nextApproval.status,
          actionHash: nextApproval.actionHash,
          idempotencyKey: nextApproval.idempotencyKey
        },
        createdAt: now
      }
    ]
  });
  return patched;
}

export function createMemoryAgentProjectStore(initialBundles?: Iterable<AgentProjectBundle>): AgentProjectStore {
  const bundles = new Map<string, AgentProjectBundle>();
  for (const bundle of initialBundles ?? []) {
    bundles.set(bundle.project.id, normalizeAgentProjectBundle(bundle) ?? bundle);
  }

  return {
    async loadProject(projectId) {
      return bundles.get(projectId) ?? null;
    },
    async saveProjectPatch(projectId, patch) {
      const nextBundle = applyAgentProjectPatch(projectId, bundles.get(projectId) ?? null, patch);
      bundles.set(projectId, nextBundle);
      return nextBundle;
    },
    async archiveProject(projectId) {
      const current = bundles.get(projectId);
      if (!current) return;
      const now = new Date().toISOString();
      const nextBundle = applyAgentProjectPatch(projectId, current, {
        project: {
          ...current.project,
          lifecycle: "archived",
          archivedAt: now,
          updatedAt: now
        },
        updatedAt: now,
        events: [
          {
            projectId,
            actorType: "system",
            eventType: "project.archived",
            objectType: "project",
            objectId: projectId,
            payload: {}
          }
        ]
      });
      bundles.set(projectId, nextBundle);
    },
    async updateApprovalStatus(input) {
      const current = bundles.get(input.projectId);
      if (!current) throw new Error(`Agent project not found: ${input.projectId}.`);
      const nextBundle = updateAgentProjectBundleApprovalStatus(current, input);
      bundles.set(input.projectId, nextBundle);
      return nextBundle.approvalRequests.find((record) => record.id === input.approvalRequestId)!;
    },
    async appendEvent(event) {
      const current = bundles.get(event.projectId) ?? createEmptyAgentProjectBundle({ projectId: event.projectId });
      const nextBundle = applyAgentProjectPatch(event.projectId, current, {
        events: [event]
      });
      bundles.set(event.projectId, nextBundle);
      return nextBundle.events[nextBundle.events.length - 1];
    }
  };
}

export function createWorkspaceAgentProjectStore(options: {
  readWorkspace: () => Promise<AgentProjectWorkspaceEnvelope>;
  writeWorkspace: (workspace: AgentProjectWorkspaceEnvelope) => Promise<void>;
}): AgentProjectStore {
  async function readBundles() {
    const workspace = await options.readWorkspace();
    return {
      workspace,
      bundles: normalizeAgentProjectBundles(workspace.projectBundles)
    };
  }

  async function writeBundles(workspace: AgentProjectWorkspaceEnvelope, bundles: AgentProjectBundle[]) {
    await options.writeWorkspace({
      ...workspace,
      projectBundles: normalizeAgentProjectBundles(bundles)
    });
  }

  return {
    async loadProject(projectId) {
      const { bundles } = await readBundles();
      return bundles.find((bundle) => bundle.project.id === projectId) ?? null;
    },
    async saveProjectPatch(projectId, patch) {
      const { workspace, bundles } = await readBundles();
      const current = bundles.find((bundle) => bundle.project.id === projectId) ?? null;
      const nextBundle = applyAgentProjectPatch(projectId, current, patch);
      await writeBundles(workspace, mergeProjectBundleList(bundles, nextBundle));
      return nextBundle;
    },
    async archiveProject(projectId) {
      const { workspace, bundles } = await readBundles();
      const current = bundles.find((bundle) => bundle.project.id === projectId);
      if (!current) return;
      const now = new Date().toISOString();
      const nextBundle = applyAgentProjectPatch(projectId, current, {
        project: {
          ...current.project,
          lifecycle: "archived",
          archivedAt: now,
          updatedAt: now
        },
        updatedAt: now,
        events: [
          {
            projectId,
            actorType: "system",
            eventType: "project.archived",
            objectType: "project",
            objectId: projectId,
            payload: {}
          }
        ]
      });
      await writeBundles(workspace, mergeProjectBundleList(bundles, nextBundle));
    },
    async updateApprovalStatus(input) {
      const { workspace, bundles } = await readBundles();
      const current = bundles.find((bundle) => bundle.project.id === input.projectId);
      if (!current) throw new Error(`Agent project not found: ${input.projectId}.`);
      const nextBundle = updateAgentProjectBundleApprovalStatus(current, input);
      await writeBundles(workspace, mergeProjectBundleList(bundles, nextBundle));
      return nextBundle.approvalRequests.find((record) => record.id === input.approvalRequestId)!;
    },
    async appendEvent(event) {
      const { workspace, bundles } = await readBundles();
      const current = bundles.find((bundle) => bundle.project.id === event.projectId) ?? createEmptyAgentProjectBundle({ projectId: event.projectId });
      const nextBundle = applyAgentProjectPatch(event.projectId, current, {
        events: [event]
      });
      await writeBundles(workspace, mergeProjectBundleList(bundles, nextBundle));
      return nextBundle.events[nextBundle.events.length - 1];
    }
  };
}
