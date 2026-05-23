import type { GenerationParamValue, GenerationSlotInput } from "@/features/generation/types";
import { applyCanvasAction } from "@/features/canvas/actions";
import type { CanvasGenerationResult, CanvasRuntimeAction } from "@/features/canvas/types";
import {
  type AgentEventLogRecord,
  type AgentProjectBundle,
  type AgentProjectStore,
  type ApprovalRequestRecord,
  type CanvasGraphRecord,
  type CreateAgentEventInput,
  type GenerationTaskRecord,
  type MediaAssetRecord
} from "@/lib/agent-project-store";
import type { MediaGenerationCreateResult, MediaGenerationInput, MediaGenerationProvider } from "./generation-provider";
import type { MediaStorageProvider, PersistMediaAssetResult } from "./media-storage-provider";
import { createMockMediaGenerationProvider } from "./mock-generation-provider";

export type ControlledGenerationRequest = {
  nodeId?: string;
  nodeVersionId?: string;
  artifactId?: string;
  kind: "image" | "video";
  surface: "standalone" | "canvas" | "agent";
  modelId: string;
  modelName: string;
  modeKey: string;
  prompt: string;
  params: Record<string, GenerationParamValue>;
  slots: readonly GenerationSlotInput[];
};

export type ControlledGenerationExecutionResult = {
  ok: boolean;
  task?: GenerationTaskRecord;
  asset?: MediaAssetRecord;
  approval?: ApprovalRequestRecord;
  bundle?: AgentProjectBundle;
  eventIds: string[];
  idempotent?: boolean;
  blocker?: string;
  error?: string;
};

export type ExecuteControlledGenerationInput = {
  projectId: string;
  approvalRequestId: string;
  actionHash: string;
  idempotencyKey: string;
  generation: ControlledGenerationRequest;
  provider?: MediaGenerationProvider;
  mediaStorageProvider?: MediaStorageProvider;
  allowLiveProvider?: boolean;
  actorId?: string;
  now?: string;
};

export type PollControlledGenerationInput = {
  projectId: string;
  taskId?: string;
  providerTaskId?: string;
  provider: MediaGenerationProvider;
  mediaStorageProvider?: MediaStorageProvider;
  allowLiveProvider?: boolean;
  now?: string;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createStableId(prefix: string, value: string) {
  return `${prefix}-${hashString(value)}`;
}

function addHours(isoTimestamp: string, hours: number) {
  return new Date(Date.parse(isoTimestamp) + hours * 60 * 60 * 1000).toISOString();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getExistingTask(bundle: AgentProjectBundle, idempotencyKey: string) {
  return bundle.generationTasks.find((task) => task.idempotencyKey === idempotencyKey);
}

function getTaskForPoll(bundle: AgentProjectBundle, input: PollControlledGenerationInput) {
  return bundle.generationTasks.find((task) => (
    input.taskId ? task.id === input.taskId : Boolean(input.providerTaskId) && task.providerTaskId === input.providerTaskId
  ));
}

function canReturnExistingTaskForApproval(status: ApprovalRequestRecord["status"]) {
  return status === "approved" || status === "executing" || status === "executed" || status === "execution_failed";
}

function isTerminalTaskStatus(status: GenerationTaskRecord["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function isAcceptedTaskStatus(status: GenerationTaskRecord["status"]) {
  return status === "queued" || status === "running" || status === "succeeded";
}

function canUseProviderForControlledGeneration(provider: MediaGenerationProvider, allowLiveProvider = false) {
  return provider.key === "mock" ||
    provider.capabilities.dryRun === true ||
    (allowLiveProvider && provider.capabilities.liveSmoke === true);
}

function providerBlockedMessage() {
  return "M5 controlled generation only allows mock, dry-run, or explicit live smoke media generation provider.";
}

function getTaskAsset(bundle: AgentProjectBundle, task: GenerationTaskRecord | undefined) {
  if (!task?.outputAssetId) return undefined;
  return bundle.mediaAssets.find((asset) => asset.id === task.outputAssetId);
}

function getNewEventIds(before: AgentEventLogRecord[], after: AgentEventLogRecord[]) {
  const previousIds = new Set(before.map((event) => event.id));
  return after.filter((event) => !previousIds.has(event.id)).map((event) => event.id);
}

function getApprovalBlocker(approval: ApprovalRequestRecord, input: ExecuteControlledGenerationInput, now: string) {
  if (approval.projectId !== input.projectId) return "Approval projectId 与执行请求不一致。";
  if (approval.kind !== "generation") return "M5 generation executor 只接受 generation 类型的 ApprovalRequest。";
  if (approval.actionHash !== input.actionHash) return "确认内容已过期：actionHash 与当前请求不一致。";
  if (approval.idempotencyKey !== input.idempotencyKey) return "确认内容已过期：idempotencyKey 与当前请求不一致。";
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.parse(now)) return "确认已过期，请重新生成确认单。";
  return "";
}

function createProviderInput(
  approval: ApprovalRequestRecord,
  input: ExecuteControlledGenerationInput
): MediaGenerationInput {
  return {
    projectId: input.projectId,
    sessionId: approval.sessionId,
    approvalRequestId: approval.id,
    idempotencyKey: input.idempotencyKey,
    kind: input.generation.kind,
    surface: input.generation.surface,
    modelId: input.generation.modelId,
    modelName: input.generation.modelName,
    modeKey: input.generation.modeKey,
    prompt: input.generation.prompt,
    params: input.generation.params,
    slots: Array.from(input.generation.slots)
  };
}

function createQueuedTask(input: {
  approval: ApprovalRequestRecord;
  request: ControlledGenerationRequest;
  provider: MediaGenerationProvider;
  idempotencyKey: string;
  now: string;
  credits: number;
}): GenerationTaskRecord {
  const id = createStableId("generation-task", `${input.approval.projectId}:${input.idempotencyKey}`);
  return {
    schemaVersion: 1,
    id,
    projectId: input.approval.projectId,
    sessionId: input.approval.sessionId,
    nodeId: input.request.nodeId,
    nodeVersionId: input.request.nodeVersionId,
    artifactId: input.request.artifactId,
    approvalRequestId: input.approval.id,
    kind: input.request.kind,
    surface: input.request.surface,
    provider: input.provider.key,
    modelId: input.request.modelId,
    modelName: input.request.modelName,
    modeKey: input.request.modeKey,
    prompt: input.request.prompt.trim(),
    params: input.request.params,
    slots: Array.from(input.request.slots),
    status: "queued",
    progress: 0,
    credits: input.credits,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now,
    startedAt: input.now,
    updatedAt: input.now
  };
}

function createGenerationEvent(input: {
  approval: ApprovalRequestRecord;
  task: GenerationTaskRecord;
  eventType: CreateAgentEventInput["eventType"];
  now: string;
  actorType?: CreateAgentEventInput["actorType"];
  objectType?: string;
  objectId?: string;
  payload?: Record<string, unknown>;
}): CreateAgentEventInput {
  return {
    projectId: input.approval.projectId,
    sessionId: input.approval.sessionId,
    actorType: input.actorType ?? "system",
    eventType: input.eventType,
    objectType: input.objectType ?? "generation_task",
    objectId: input.objectId ?? input.task.id,
    correlationId: input.approval.id,
    requestId: input.approval.idempotencyKey,
    payload: {
      approvalRequestId: input.approval.id,
      taskId: input.task.id,
      provider: input.task.provider,
      providerTaskId: input.task.providerTaskId,
      status: input.task.status,
      actionHash: input.approval.actionHash,
      idempotencyKey: input.approval.idempotencyKey,
      ...(input.payload ?? {})
    },
    createdAt: input.now
  };
}

function createTaskOutput(providerResult: MediaGenerationCreateResult): GenerationTaskRecord["output"] {
  if (!providerResult.output) return undefined;
  return {
    kind: providerResult.output.kind,
    title: providerResult.output.title,
    assetUrl: providerResult.output.assetUrl,
    downloadUrl: providerResult.output.downloadUrl,
    ratio: providerResult.output.ratio
  };
}

function getCanvasProjectionNodeId(task: GenerationTaskRecord) {
  return task.nodeId?.trim() || createStableId("canvas-generation-node", `${task.projectId}:${task.id}`);
}

function getAssetPublicUrl(asset: MediaAssetRecord | undefined, task: GenerationTaskRecord) {
  return asset?.storage?.publicUrl ?? task.output?.downloadUrl ?? task.output?.assetUrl;
}

function createCanvasProjectionContent(task: GenerationTaskRecord, asset: MediaAssetRecord | undefined) {
  const storageProvider = asset?.storage?.provider ?? "unknown";
  const recoverable = asset?.recoverable === true ? "recoverable" : "not recoverable";
  return [
    task.output?.title ?? "Generated media output",
    `Storage: ${storageProvider} / ${recoverable}`,
    `GenerationTask: ${task.id}`
  ].join("\n");
}

function createCanvasProjectionResult(task: GenerationTaskRecord, asset: MediaAssetRecord | undefined): CanvasGenerationResult {
  const publicUrl = getAssetPublicUrl(asset, task);
  return {
    content: createCanvasProjectionContent(task, asset),
    assetUrl: publicUrl,
    downloadUrl: publicUrl,
    providerTaskId: task.providerTaskId,
    model: task.modelName,
    time: task.completedAt && task.startedAt
      ? `${Math.max(1, Math.round((Date.parse(task.completedAt) - Date.parse(task.startedAt)) / 1000))}s`
      : undefined,
    cost: `${task.credits} credits`,
    params: task.params,
    slots: task.slots
  };
}

function createCanvasProjectionSettings(task: GenerationTaskRecord) {
  const settings: Record<string, string> = {
    prompt: task.prompt,
    modelId: task.modelId,
    modeKey: task.modeKey
  };
  for (const key of ["ratio", "duration", "resolution"]) {
    const value = task.params[key];
    if (typeof value === "string" && value.trim()) settings[key] = value;
  }
  return settings;
}

function taskAlreadyProjectedToCanvas(graph: CanvasGraphRecord, task: GenerationTaskRecord) {
  if (!task.providerTaskId) return false;
  return graph.nodes.some((node) =>
    node.versions.some((version) => version.providerTaskId === task.providerTaskId)
  );
}

function applyActionsToCanvasGraph(graph: CanvasGraphRecord, actions: CanvasRuntimeAction[], now: string): CanvasGraphRecord {
  let nodes = graph.nodes;
  let edges = graph.edges;

  for (const action of actions) {
    const result = applyCanvasAction(nodes, edges, action);
    nodes = result.nodes;
    edges = result.edges;
  }

  return {
    ...graph,
    nodes,
    edges,
    graphVersion: `graph-${hashString(`${graph.projectId}:${now}:${actions.map((action) => action.type).join(":")}`)}`,
    updatedAt: now
  };
}

function createCanvasProjection(input: {
  approval: ApprovalRequestRecord;
  bundle: AgentProjectBundle;
  task: GenerationTaskRecord;
  asset?: MediaAssetRecord;
  now: string;
}): { canvasGraph: CanvasGraphRecord; actions: CanvasRuntimeAction[]; events: CreateAgentEventInput[]; nodeVersionIds: string[] } | undefined {
  if (!input.asset || !input.task.output || (input.task.output.kind !== "image" && input.task.output.kind !== "video")) return undefined;
  if (taskAlreadyProjectedToCanvas(input.bundle.canvasGraph, input.task)) {
    return {
      canvasGraph: input.bundle.canvasGraph,
      actions: [],
      events: [],
      nodeVersionIds: []
    };
  }

  const nodeId = getCanvasProjectionNodeId(input.task);
  const existingNode = input.bundle.canvasGraph.nodes.find((node) => node.id === nodeId);
  const kind = input.task.output.kind;
  const actions: CanvasRuntimeAction[] = [];

  if (!existingNode) {
    actions.push({
      type: "createNode",
      input: {
        id: nodeId,
        kind,
        businessType: kind === "video" ? "final_video" : "storyboard_frame",
        title: kind === "video" ? "生成视频结果" : "生成图片结果",
        input: `来自 GenerationTask ${input.task.id}`,
        output: "等待生成结果写入。",
        model: input.task.modelName,
        status: "succeeded",
        previewClass: kind === "video" ? "final-video" : "storyboard",
        settings: createCanvasProjectionSettings(input.task)
      }
    });
  }

  actions.push({
    type: "appendNodeVersion",
    nodeId,
    result: createCanvasProjectionResult(input.task, input.asset)
  });

  const canvasGraph = applyActionsToCanvasGraph(input.bundle.canvasGraph, actions, input.now);
  const projectedNode = canvasGraph.nodes.find((node) => node.id === nodeId);
  const projectedVersion = projectedNode?.versions.find((version) => version.providerTaskId === input.task.providerTaskId);
  const events = actions.map((action) =>
    createGenerationEvent({
      approval: input.approval,
      task: input.task,
      eventType: action.type === "createNode" ? "canvas.node.created" : "canvas.node.updated",
      now: input.now,
      actorType: "system",
      objectType: "canvas_node",
      objectId: nodeId,
      payload: {
        actionType: action.type,
        nodeId,
        nodeVersionId: action.type === "appendNodeVersion" ? projectedVersion?.id : undefined,
        mediaAssetId: input.asset?.id,
        storageProvider: input.asset?.storage?.provider,
        recoverable: input.asset?.recoverable
      }
    })
  );

  return {
    canvasGraph,
    actions,
    events,
    nodeVersionIds: projectedVersion?.id ? [projectedVersion.id] : []
  };
}

function getProgressForProviderResult(providerResult: MediaGenerationCreateResult, currentProgress: number) {
  if (providerResult.progress !== undefined) return providerResult.progress;
  if (providerResult.status === "succeeded" || providerResult.status === "failed" || providerResult.status === "cancelled") return 100;
  if (providerResult.status === "running") return Math.max(currentProgress, 25);
  return currentProgress;
}

function applyProviderResultToTask(
  task: GenerationTaskRecord,
  providerResult: MediaGenerationCreateResult,
  now: string
): GenerationTaskRecord {
  const terminal = providerResult.status === "succeeded" || providerResult.status === "failed" || providerResult.status === "cancelled";
  return {
    ...task,
    providerTaskId: providerResult.providerTaskId,
    status: providerResult.status,
    progress: getProgressForProviderResult(providerResult, task.progress),
    credits: providerResult.credits ?? task.credits,
    costUsd: providerResult.costUsd ?? task.costUsd,
    output: providerResult.status === "succeeded" ? createTaskOutput(providerResult) : task.output,
    errorCode: providerResult.status === "failed" || providerResult.status === "cancelled"
      ? providerResult.errorCode ?? (providerResult.status === "cancelled" ? "generation_cancelled" : task.errorCode)
      : undefined,
    errorMessage: providerResult.status === "failed" || providerResult.status === "cancelled"
      ? providerResult.errorMessage ?? (providerResult.status === "cancelled" ? "Generation was cancelled." : task.errorMessage)
      : undefined,
    completedAt: terminal ? now : task.completedAt,
    updatedAt: now
  };
}

function hasTaskStatusChanged(previous: GenerationTaskRecord, next: GenerationTaskRecord) {
  return previous.status !== next.status ||
    previous.progress !== next.progress ||
    previous.credits !== next.credits ||
    previous.costUsd !== next.costUsd ||
    previous.errorCode !== next.errorCode ||
    previous.errorMessage !== next.errorMessage;
}

function createMediaAsset(input: {
  approval: ApprovalRequestRecord;
  task: GenerationTaskRecord;
  now: string;
}): MediaAssetRecord | undefined {
  const output = input.task.output;
  if (!output || (output.kind !== "image" && output.kind !== "video")) return undefined;
  const assetId = input.task.outputAssetId ?? createStableId("media-asset", `${input.task.projectId}:${input.task.id}`);

  return {
    schemaVersion: 1,
    id: assetId,
    projectId: input.task.projectId,
    sessionId: input.task.sessionId,
    kind: output.kind,
    role: "generated_output",
    source: input.task.provider === "mock" ? "mock" : "generation",
    mimeType: output.kind === "video" ? "video/mp4" : "image/png",
    durationMs: output.kind === "video" ? 5000 : undefined,
    storage: {
      provider: "external",
      publicUrl: output.downloadUrl ?? output.assetUrl,
      signedUrlExpiresAt: input.task.provider === "mock" ? undefined : addHours(input.now, 24)
    },
    recoverable: input.task.provider === "mock",
    createdAt: input.now,
    updatedAt: input.now
  };
}

async function persistGeneratedAsset(input: {
  mediaStorageProvider?: MediaStorageProvider;
  asset: MediaAssetRecord;
  task: GenerationTaskRecord;
}): Promise<{ asset: MediaAssetRecord; persistence?: PersistMediaAssetResult }> {
  const sourceUrl = input.task.output?.downloadUrl ?? input.task.output?.assetUrl ?? input.asset.storage?.publicUrl;
  if (!input.mediaStorageProvider || input.asset.recoverable !== false || !sourceUrl) {
    return { asset: input.asset };
  }

  const persistence = await input.mediaStorageProvider.persist({
    projectId: input.task.projectId,
    taskId: input.task.id,
    assetId: input.asset.id,
    kind: input.asset.kind,
    sourceUrl,
    mimeType: input.asset.mimeType
  }).catch((error): PersistMediaAssetResult => ({
    ok: false,
    errorCode: "media_persist_failed",
    errorMessage: getErrorMessage(error)
  }));

  if (!persistence.ok) return { asset: input.asset, persistence };

  return {
    asset: {
      ...input.asset,
      mimeType: persistence.mimeType ?? input.asset.mimeType,
      byteSize: persistence.byteSize ?? input.asset.byteSize,
      storage: persistence.storage,
      recoverable: true,
      updatedAt: input.task.updatedAt
    },
    persistence
  };
}

async function markApprovalFailed(
  store: AgentProjectStore,
  approval: ApprovalRequestRecord,
  now: string,
  task: GenerationTaskRecord | undefined,
  error: string,
  eventIds: string[]
) {
  const latestBundle = await store.loadProject(approval.projectId);
  const latestApproval = latestBundle?.approvalRequests.find((record) => record.id === approval.id);
  if (latestApproval?.status === "executing") {
    await store.updateApprovalStatus({
      projectId: approval.projectId,
      approvalRequestId: approval.id,
      status: "execution_failed",
      executedAt: now,
      actualCredits: task?.credits ?? approval.actualCredits ?? 0,
      executionResult: {
        ok: false,
        eventIds,
        taskIds: task ? [task.id] : [],
        error
      }
    });
  }
}

async function markApprovalExecuted(
  store: AgentProjectStore,
  approval: ApprovalRequestRecord,
  now: string,
  task: GenerationTaskRecord,
  eventIds: string[],
  nodeVersionIds: string[] = []
) {
  const latestBundle = await store.loadProject(approval.projectId);
  const latestApproval = latestBundle?.approvalRequests.find((record) => record.id === approval.id);
  if (latestApproval?.status === "executing") {
    return store.updateApprovalStatus({
      projectId: approval.projectId,
      approvalRequestId: approval.id,
      status: "executed",
      executedAt: now,
      actualCredits: task.credits,
      executionResult: {
        ok: true,
        eventIds,
        taskIds: [task.id],
        nodeVersionIds
      }
    });
  }
  return latestApproval ?? approval;
}

function terminalFailureEventType(status: GenerationTaskRecord["status"]): CreateAgentEventInput["eventType"] {
  return status === "cancelled" ? "generation.cancelled" : "generation.failed";
}

async function writeTerminalFailure(input: {
  store: AgentProjectStore;
  approval: ApprovalRequestRecord;
  bundle: AgentProjectBundle;
  task: GenerationTaskRecord;
  now: string;
  eventIds: string[];
}) {
  const beforeBundle = input.bundle;
  const patchedBundle = await input.store.saveProjectPatch(input.approval.projectId, {
    generationTasks: [input.task],
    events: [
      createGenerationEvent({
        approval: input.approval,
        task: input.task,
        eventType: terminalFailureEventType(input.task.status),
        now: input.now,
        actorType: "provider",
        payload: {
          errorCode: input.task.errorCode,
          errorMessage: input.task.errorMessage
        }
      })
    ],
    updatedAt: input.now
  });
  const eventIds = [...input.eventIds, ...getNewEventIds(beforeBundle.events, patchedBundle.events)];
  await markApprovalFailed(
    input.store,
    input.approval,
    input.now,
    input.task,
    input.task.errorMessage ?? (input.task.status === "cancelled" ? "Generation was cancelled." : "Generation failed."),
    eventIds
  );
  const finalBundle = await input.store.loadProject(input.approval.projectId) ?? patchedBundle;
  const finalTask = finalBundle.generationTasks.find((record) => record.id === input.task.id) ?? input.task;
  return {
    ok: false,
    approval: finalBundle.approvalRequests.find((record) => record.id === input.approval.id) ?? input.approval,
    bundle: finalBundle,
    task: finalTask,
    asset: getTaskAsset(finalBundle, finalTask),
    eventIds,
    blocker: finalTask.errorMessage,
    error: finalTask.errorCode
  } satisfies ControlledGenerationExecutionResult;
}

async function writeSuccessfulResult(input: {
  store: AgentProjectStore;
  approval: ApprovalRequestRecord;
  bundle: AgentProjectBundle;
  task: GenerationTaskRecord;
  mediaStorageProvider?: MediaStorageProvider;
  now: string;
  eventIds: string[];
}) {
  const outputAssetId = input.task.outputAssetId ?? createStableId("media-asset", `${input.task.projectId}:${input.task.id}`);
  const task: GenerationTaskRecord = {
    ...input.task,
    status: "succeeded",
    progress: 100,
    outputAssetId,
    completedAt: input.now,
    updatedAt: input.now
  };
  const initialAsset = createMediaAsset({
    approval: input.approval,
    task,
    now: input.now
  });
  const persisted = initialAsset
    ? await persistGeneratedAsset({
        mediaStorageProvider: input.mediaStorageProvider,
        asset: initialAsset,
        task
      })
    : undefined;
  const asset = persisted?.asset;
  const assetEventType: CreateAgentEventInput["eventType"] = asset?.recoverable === false ? "asset.not_persisted" : "asset.persisted";
  const persistenceFailed = persisted?.persistence?.ok === false ? persisted.persistence : undefined;
  const beforeBundle = input.bundle;
  const canvasProjection = createCanvasProjection({
    approval: input.approval,
    bundle: input.bundle,
    task,
    asset,
    now: input.now
  });
  const patchedBundle = await input.store.saveProjectPatch(input.approval.projectId, {
    generationTasks: [task],
    mediaAssets: asset ? [asset] : [],
    canvasGraph: canvasProjection?.canvasGraph,
    events: [
      ...(asset
        ? [
            createGenerationEvent({
              approval: input.approval,
              task,
              eventType: assetEventType,
              now: input.now,
              objectType: "media_asset",
              objectId: asset.id,
              payload: {
                mediaAssetId: asset.id,
                source: asset.source,
                storageProvider: asset.storage?.provider,
                storageKey: asset.storage?.key,
                publicUrl: asset.storage?.publicUrl,
                signedUrlExpiresAt: asset.storage?.signedUrlExpiresAt,
                recoverable: asset.recoverable,
                persistenceErrorCode: persistenceFailed?.errorCode,
                persistenceErrorMessage: persistenceFailed?.errorMessage
              }
            })
          ]
        : []),
      ...(canvasProjection?.events ?? []),
      createGenerationEvent({
        approval: input.approval,
        task,
        eventType: "generation.succeeded",
        now: input.now,
        actorType: "provider",
        payload: {
          outputAssetId: task.outputAssetId,
          credits: task.credits
        }
      })
    ],
    updatedAt: input.now
  });
  const eventIds = [...input.eventIds, ...getNewEventIds(beforeBundle.events, patchedBundle.events)];
  const executedApproval = await markApprovalExecuted(
    input.store,
    input.approval,
    input.now,
    task,
    eventIds,
    canvasProjection?.nodeVersionIds ?? []
  );
  const finalBundle = await input.store.loadProject(input.approval.projectId) ?? patchedBundle;
  const finalTask = finalBundle.generationTasks.find((record) => record.id === task.id) ?? task;
  return {
    ok: true,
    approval: executedApproval,
    bundle: finalBundle,
    task: finalTask,
    asset: getTaskAsset(finalBundle, finalTask) ?? asset,
    eventIds
  } satisfies ControlledGenerationExecutionResult;
}

export async function executeControlledGenerationTask(
  store: AgentProjectStore,
  input: ExecuteControlledGenerationInput
): Promise<ControlledGenerationExecutionResult> {
  const now = input.now ?? new Date().toISOString();
  const provider = input.provider ?? createMockMediaGenerationProvider();
  const bundle = await store.loadProject(input.projectId);
  if (!bundle) {
    return {
      ok: false,
      eventIds: [],
      blocker: `Agent project not found: ${input.projectId}.`
    };
  }

  const approval = bundle.approvalRequests.find((record) => record.id === input.approvalRequestId);
  if (!approval) {
    return {
      ok: false,
      bundle,
      eventIds: [],
      blocker: `Approval request not found: ${input.approvalRequestId}.`
    };
  }

  const approvalBlocker = getApprovalBlocker(approval, input, now);
  if (approvalBlocker) {
    return {
      ok: false,
      approval,
      bundle,
      eventIds: [],
      blocker: approvalBlocker
    };
  }

  const existingTask = getExistingTask(bundle, input.idempotencyKey);
  if (existingTask) {
    if (!canReturnExistingTaskForApproval(approval.status)) {
      return {
        ok: false,
        approval,
        bundle,
        task: existingTask,
        eventIds: [],
        blocker: `Approval status must be approved before generation execution; received ${approval.status}.`
      };
    }

    return {
      ok: isAcceptedTaskStatus(existingTask.status),
      approval,
      bundle,
      task: existingTask,
      asset: getTaskAsset(bundle, existingTask),
      eventIds: isTerminalTaskStatus(existingTask.status)
        ? existingTask.approvalRequestId ? approval.executionResult?.eventIds ?? [] : []
        : [],
      idempotent: true,
      blocker: existingTask.status === "failed" || existingTask.status === "cancelled" ? existingTask.errorMessage : undefined
    };
  }

  if (approval.status !== "approved") {
    return {
      ok: false,
      approval,
      bundle,
      eventIds: [],
      blocker: `Approval status must be approved before generation execution; received ${approval.status}.`
    };
  }

  if (!canUseProviderForControlledGeneration(provider, input.allowLiveProvider)) {
    return {
      ok: false,
      approval,
      bundle,
      eventIds: [],
      blocker: providerBlockedMessage()
    };
  }

  const providerInput = createProviderInput(approval, input);
  const validation = provider.validate(providerInput);
  if (!validation.ok) {
    return {
      ok: false,
      approval,
      bundle,
      eventIds: [],
      blocker: validation.errorMessage,
      error: validation.errorCode
    };
  }

  const estimatedCost = provider.estimateCost(providerInput);
  const task = createQueuedTask({
    approval,
    request: input.generation,
    provider,
    idempotencyKey: input.idempotencyKey,
    now,
    credits: estimatedCost.credits
  });
  let eventIds: string[] = [];
  let executingApproval: ApprovalRequestRecord | undefined;
  let latestPatchedBundle = bundle;
  let queuedTaskPersisted = false;
  let providerCreateStarted = false;
  let providerCreateCompleted = false;

  try {
    executingApproval = await store.updateApprovalStatus({
      projectId: input.projectId,
      approvalRequestId: approval.id,
      status: "executing",
      actualCredits: 0
    });

    let beforeBundle = await store.loadProject(input.projectId) ?? bundle;
    let patchedBundle = await store.saveProjectPatch(input.projectId, {
      generationTasks: [task],
      events: [
        createGenerationEvent({
          approval: executingApproval,
          task,
          eventType: "generation.queued",
          now,
          payload: {
            progress: task.progress,
            credits: task.credits
          }
        })
      ],
      updatedAt: now
    });
    latestPatchedBundle = patchedBundle;
    queuedTaskPersisted = true;
    eventIds = [...eventIds, ...getNewEventIds(beforeBundle.events, patchedBundle.events)];

    providerCreateStarted = true;
    const providerResult = await provider.createTask(providerInput);
    providerCreateCompleted = true;
    const providerCreatedTask = applyProviderResultToTask(task, providerResult, now);

    beforeBundle = patchedBundle;
    patchedBundle = await store.saveProjectPatch(input.projectId, {
      generationTasks: [providerCreatedTask],
      events: [
        createGenerationEvent({
          approval: executingApproval,
          task: providerCreatedTask,
          eventType: "generation.provider_task_created",
          now,
          actorType: "provider",
          payload: {
            providerTaskId: providerCreatedTask.providerTaskId,
            providerStatus: providerResult.status
          }
        })
      ],
      updatedAt: now
    });
    latestPatchedBundle = patchedBundle;
    eventIds = [...eventIds, ...getNewEventIds(beforeBundle.events, patchedBundle.events)];

    if (providerCreatedTask.status === "failed" || providerCreatedTask.status === "cancelled") {
      return writeTerminalFailure({
        store,
        approval: executingApproval,
        bundle: patchedBundle,
        task: providerCreatedTask,
        now,
        eventIds
      });
    }

    if (providerCreatedTask.status === "succeeded") {
      return writeSuccessfulResult({
        store,
        approval: executingApproval,
        bundle: patchedBundle,
        task: providerCreatedTask,
        mediaStorageProvider: input.mediaStorageProvider,
        now,
        eventIds
      });
    }

    const finalBundle = await store.loadProject(input.projectId) ?? patchedBundle;
    const finalTask = finalBundle.generationTasks.find((record) => record.id === providerCreatedTask.id) ?? providerCreatedTask;
    return {
      ok: true,
      approval: finalBundle.approvalRequests.find((record) => record.id === approval.id) ?? executingApproval,
      bundle: finalBundle,
      task: finalTask,
      eventIds
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (executingApproval && queuedTaskPersisted) {
      const failedTask: GenerationTaskRecord = {
        ...task,
        status: "failed",
        progress: 100,
        errorCode: providerCreateStarted && !providerCreateCompleted ? "provider_create_failed" : "generation_execution_failed",
        errorMessage,
        completedAt: now,
        updatedAt: now
      };
      return writeTerminalFailure({
        store,
        approval: executingApproval,
        bundle: latestPatchedBundle,
        task: failedTask,
        now,
        eventIds
      });
    }

    await markApprovalFailed(store, approval, now, task, errorMessage, eventIds);
    const finalBundle = await store.loadProject(input.projectId) ?? bundle;
    return {
      ok: false,
      approval: finalBundle.approvalRequests.find((record) => record.id === approval.id) ?? approval,
      bundle: finalBundle,
      task: finalBundle.generationTasks.find((record) => record.id === task.id) ?? task,
      eventIds,
      blocker: errorMessage,
      error: errorMessage
    };
  }
}

export async function pollControlledGenerationTask(
  store: AgentProjectStore,
  input: PollControlledGenerationInput
): Promise<ControlledGenerationExecutionResult> {
  const now = input.now ?? new Date().toISOString();
  const bundle = await store.loadProject(input.projectId);
  if (!bundle) {
    return {
      ok: false,
      eventIds: [],
      blocker: `Agent project not found: ${input.projectId}.`
    };
  }

  const task = getTaskForPoll(bundle, input);
  if (!task) {
    return {
      ok: false,
      bundle,
      eventIds: [],
      blocker: `Generation task not found: ${input.taskId ?? input.providerTaskId ?? "(missing task id)"}.`
    };
  }

  const approval = task.approvalRequestId
    ? bundle.approvalRequests.find((record) => record.id === task.approvalRequestId)
    : undefined;
  if (!approval) {
    return {
      ok: false,
      bundle,
      task,
      eventIds: [],
      blocker: `Approval request not found for generation task: ${task.id}.`
    };
  }

  if (task.provider !== input.provider.key) {
    return {
      ok: false,
      approval,
      bundle,
      task,
      eventIds: [],
      blocker: `Provider mismatch for generation task ${task.id}: expected ${task.provider}, received ${input.provider.key}.`
    };
  }

  if (!canUseProviderForControlledGeneration(input.provider, input.allowLiveProvider)) {
    return {
      ok: false,
      approval,
      bundle,
      task,
      eventIds: [],
      blocker: providerBlockedMessage()
    };
  }

  if (isTerminalTaskStatus(task.status)) {
    return {
      ok: isAcceptedTaskStatus(task.status),
      approval,
      bundle,
      task,
      asset: getTaskAsset(bundle, task),
      eventIds: approval.executionResult?.eventIds ?? [],
      idempotent: true,
      blocker: task.status === "failed" || task.status === "cancelled" ? task.errorMessage : undefined,
      error: task.status === "failed" || task.status === "cancelled" ? task.errorCode : undefined
    };
  }

  if (!task.providerTaskId) {
    return {
      ok: false,
      approval,
      bundle,
      task,
      eventIds: [],
      blocker: `Generation task has no providerTaskId: ${task.id}.`
    };
  }

  let providerResult: MediaGenerationCreateResult;
  try {
    providerResult = await input.provider.getTask(task.providerTaskId);
  } catch (error) {
    const failedTask: GenerationTaskRecord = {
      ...task,
      status: "failed",
      progress: 100,
      errorCode: "provider_poll_failed",
      errorMessage: getErrorMessage(error),
      completedAt: now,
      updatedAt: now
    };
    return writeTerminalFailure({
      store,
      approval,
      bundle,
      task: failedTask,
      now,
      eventIds: []
    });
  }

  if (providerResult.providerTaskId !== task.providerTaskId) {
    return {
      ok: false,
      approval,
      bundle,
      task,
      eventIds: [],
      blocker: `Provider task id mismatch: expected ${task.providerTaskId}, received ${providerResult.providerTaskId}.`
    };
  }

  const nextTask = applyProviderResultToTask(task, providerResult, now);
  if (nextTask.status === "queued" || nextTask.status === "running") {
    if (!hasTaskStatusChanged(task, nextTask)) {
      return {
        ok: true,
        approval,
        bundle,
        task,
        eventIds: [],
        idempotent: true
      };
    }

    const patchedBundle = await store.saveProjectPatch(input.projectId, {
      generationTasks: [nextTask],
      events: [
        createGenerationEvent({
          approval,
          task: nextTask,
          eventType: "generation.status_changed",
          now,
          actorType: "provider",
          payload: {
            previousStatus: task.status,
            status: nextTask.status,
            progress: nextTask.progress,
            credits: nextTask.credits
          }
        })
      ],
      updatedAt: now
    });
    const eventIds = getNewEventIds(bundle.events, patchedBundle.events);
    const finalBundle = await store.loadProject(input.projectId) ?? patchedBundle;
    const finalTask = finalBundle.generationTasks.find((record) => record.id === nextTask.id) ?? nextTask;
    return {
      ok: true,
      approval: finalBundle.approvalRequests.find((record) => record.id === approval.id) ?? approval,
      bundle: finalBundle,
      task: finalTask,
      eventIds
    };
  }

  if (nextTask.status === "failed" || nextTask.status === "cancelled") {
    return writeTerminalFailure({
      store,
      approval,
      bundle,
      task: nextTask,
      now,
      eventIds: []
    });
  }

  if (!nextTask.output) {
    return writeTerminalFailure({
      store,
      approval,
      bundle,
      task: {
        ...nextTask,
        status: "failed",
        progress: 100,
        errorCode: "generation_missing_output",
        errorMessage: "Provider reported success without a usable output URL.",
        completedAt: now,
        updatedAt: now
      },
      now,
      eventIds: []
    });
  }

  return writeSuccessfulResult({
    store,
    approval,
    bundle,
    task: nextTask,
    mediaStorageProvider: input.mediaStorageProvider,
    now,
    eventIds: []
  });
}
