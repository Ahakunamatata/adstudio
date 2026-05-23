import {
  createEmptyAgentProjectBundle,
  createMemoryAgentProjectStore,
  type AgentProjectBundle,
  type ApprovalRequestRecord
} from "@/lib/agent-project-store";
import type { MediaGenerationCreateResult, MediaGenerationInput, MediaGenerationProvider } from "./generation-provider";
import type { MediaStorageProvider } from "./media-storage-provider";
import { createMockMediaGenerationProvider } from "./mock-generation-provider";
import { executeControlledGenerationTask, pollControlledGenerationTask } from "./generation-executor";
import { createViduDryRunMediaGenerationProvider } from "./vidu-generation-provider";

const sampleProjectId = "project-m5-phase0-typecheck";
const sampleSessionId = "session-m5-phase0-typecheck";
const sampleActionHash = "generation:mock-action-hash";
const sampleIdempotencyKey = "m5:project-m5-phase0-typecheck:generation:mock-action-hash";
const sampleNow = "2026-05-22T00:00:00.000Z";

function createGenerationApproval(status: ApprovalRequestRecord["status"]): ApprovalRequestRecord {
  return {
    schemaVersion: 1,
    id: `approval-m5-${status}`,
    projectId: sampleProjectId,
    sessionId: sampleSessionId,
    kind: "generation",
    title: "Mock 生成确认",
    summary: "Phase 0 只允许 mock provider，不调用真实生成。",
    status,
    requestedActions: [],
    actionHash: sampleActionHash,
    idempotencyKey: sampleIdempotencyKey,
    affectedNodeIds: ["node-m5-video"],
    affectedArtifactIds: ["artifact-m5-prompt-pack"],
    estimatedCredits: 0,
    requestedAt: sampleNow,
    respondedAt: status === "approved" ? sampleNow : undefined
  };
}

function createBundle(approval: ApprovalRequestRecord): AgentProjectBundle {
  return {
    ...createEmptyAgentProjectBundle({
      projectId: sampleProjectId,
      title: "M5 Phase 0",
      mode: "clone",
      now: sampleNow
    }),
    approvalRequests: [approval],
    updatedAt: sampleNow
  };
}

const sampleGenerationInput = {
  kind: "video",
  surface: "agent",
  modelId: "mock-video-v1",
  modelName: "Mock Video v1",
  modeKey: "text-to-video",
  prompt: "Mock 9:16 app ad video.",
  params: {
    ratio: "9:16",
    duration: "5s"
  },
  slots: []
} as const;

function assertTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type ScriptedProviderOptions = {
  createResult: MediaGenerationCreateResult;
  pollResults: MediaGenerationCreateResult[];
};

type ScriptedProvider = MediaGenerationProvider & {
  readonly createTaskCallCount: number;
  readonly getTaskCallCount: number;
};

function createScriptedDryRunProvider(options: ScriptedProviderOptions): ScriptedProvider {
  let createTaskCallCount = 0;
  let getTaskCallCount = 0;
  const pollResults = [...options.pollResults];

  return {
    key: "vidu",
    displayName: "Scripted Vidu Dry-run Provider",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-video"],
      ratios: ["9:16"],
      durations: ["5s"],
      supportsPolling: true,
      supportsCallback: false,
      supportsProviderIdempotency: false,
      acceptsDataUrl: true,
      acceptsPublicUrl: false,
      dryRun: true
    },
    get createTaskCallCount() {
      return createTaskCallCount;
    },
    get getTaskCallCount() {
      return getTaskCallCount;
    },
    validate(input: MediaGenerationInput) {
      return input.prompt.trim()
        ? { ok: true }
        : { ok: false, errorCode: "scripted_empty_prompt", errorMessage: "Prompt is required." };
    },
    estimateCost() {
      return { credits: 0 };
    },
    async createTask() {
      createTaskCallCount += 1;
      return options.createResult;
    },
    async getTask(providerTaskId) {
      getTaskCallCount += 1;
      return pollResults.shift() ?? {
        ...options.createResult,
        providerTaskId
      };
    }
  };
}

function createThrowingDryRunProvider(errorMessage: string): ScriptedProvider {
  let createTaskCallCount = 0;
  let getTaskCallCount = 0;

  return {
    key: "vidu",
    displayName: "Throwing Vidu Dry-run Provider",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-video"],
      ratios: ["9:16"],
      durations: ["5s"],
      supportsPolling: true,
      supportsCallback: false,
      supportsProviderIdempotency: false,
      acceptsDataUrl: true,
      acceptsPublicUrl: false,
      dryRun: true
    },
    get createTaskCallCount() {
      return createTaskCallCount;
    },
    get getTaskCallCount() {
      return getTaskCallCount;
    },
    validate(input: MediaGenerationInput) {
      return input.prompt.trim()
        ? { ok: true }
        : { ok: false, errorCode: "throwing_empty_prompt", errorMessage: "Prompt is required." };
    },
    estimateCost() {
      return { credits: 0 };
    },
    async createTask() {
      createTaskCallCount += 1;
      throw new Error(errorMessage);
    },
    async getTask() {
      getTaskCallCount += 1;
      throw new Error("Throwing provider should not be polled after create failure.");
    }
  };
}

function createScriptedLiveSmokeProvider(options: ScriptedProviderOptions): ScriptedProvider {
  let createTaskCallCount = 0;
  let getTaskCallCount = 0;
  const pollResults = [...options.pollResults];

  return {
    key: "vidu",
    displayName: "Scripted Vidu Live Smoke Provider",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-video"],
      ratios: ["9:16"],
      durations: ["5s"],
      supportsPolling: true,
      supportsCallback: false,
      supportsProviderIdempotency: false,
      acceptsDataUrl: true,
      acceptsPublicUrl: false,
      dryRun: false,
      liveSmoke: true
    },
    get createTaskCallCount() {
      return createTaskCallCount;
    },
    get getTaskCallCount() {
      return getTaskCallCount;
    },
    validate(input: MediaGenerationInput) {
      return input.prompt.trim()
        ? { ok: true }
        : { ok: false, errorCode: "live_smoke_empty_prompt", errorMessage: "Prompt is required." };
    },
    estimateCost() {
      return { credits: 0 };
    },
    async createTask() {
      createTaskCallCount += 1;
      return options.createResult;
    },
    async getTask(providerTaskId) {
      getTaskCallCount += 1;
      return pollResults.shift() ?? {
        ...options.createResult,
        providerTaskId
      };
    }
  };
}

function createSuccessfulMediaStorageProvider(callCounter: { count: number }): MediaStorageProvider {
  return {
    key: "supabase_storage",
    async persist(input) {
      callCounter.count += 1;
      return {
        ok: true,
        storage: {
          provider: "supabase_storage",
          key: `projects/${input.projectId}/generations/${input.taskId}/output.mp4`,
          publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/ad-studio-media/projects/${input.projectId}/generations/${input.taskId}/output.mp4`
        },
        byteSize: 12,
        mimeType: input.mimeType ?? "video/mp4"
      };
    }
  };
}

function createFailingMediaStorageProvider(callCounter: { count: number }): MediaStorageProvider {
  return {
    key: "supabase_storage",
    async persist() {
      callCounter.count += 1;
      return {
        ok: false,
        errorCode: "supabase_storage_upload_failed",
        errorMessage: "fixture upload failed"
      };
    }
  };
}

export async function typecheckM5GenerationExecutorPhase0() {
  const pendingStore = createMemoryAgentProjectStore([createBundle(createGenerationApproval("pending"))]);
  const pendingBlocked = await executeControlledGenerationTask(pendingStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m5-pending",
    actionHash: sampleActionHash,
    idempotencyKey: sampleIdempotencyKey,
    generation: sampleGenerationInput,
    provider: createMockMediaGenerationProvider(),
    now: sampleNow
  });
  assertTrue(!pendingBlocked.ok && pendingBlocked.blocker?.includes("approved"), "pending approval must not create task");
  assertTrue((await pendingStore.loadProject(sampleProjectId))?.generationTasks.length === 0, "pending approval created task");

  const hashStore = createMemoryAgentProjectStore([createBundle(createGenerationApproval("approved"))]);
  const staleHashBlocked = await executeControlledGenerationTask(hashStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m5-approved",
    actionHash: "generation:stale",
    idempotencyKey: sampleIdempotencyKey,
    generation: sampleGenerationInput,
    provider: createMockMediaGenerationProvider(),
    now: sampleNow
  });
  assertTrue(!staleHashBlocked.ok && staleHashBlocked.blocker?.includes("actionHash"), "stale actionHash must be blocked");
  assertTrue((await hashStore.loadProject(sampleProjectId))?.generationTasks.length === 0, "stale actionHash created task");

  const successProvider = createMockMediaGenerationProvider();
  const successStore = createMemoryAgentProjectStore([createBundle(createGenerationApproval("approved"))]);
  const succeeded = await executeControlledGenerationTask(successStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m5-approved",
    actionHash: sampleActionHash,
    idempotencyKey: sampleIdempotencyKey,
    generation: sampleGenerationInput,
    provider: successProvider,
    now: sampleNow
  });
  assertTrue(succeeded.ok, "mock generation should succeed");
  assertTrue(succeeded.task?.status === "succeeded", "mock success should write succeeded task");
  assertTrue(succeeded.asset?.source === "mock", "mock success should write mock media asset");
  assertTrue(succeeded.bundle?.events.some((event) => event.eventType === "generation.queued"), "missing generation.queued");
  assertTrue(succeeded.bundle?.events.some((event) => event.eventType === "generation.provider_task_created"), "missing provider task event");
  assertTrue(succeeded.bundle?.events.some((event) => event.eventType === "asset.persisted"), "missing asset persisted event");
  assertTrue(succeeded.bundle?.events.some((event) => event.eventType === "generation.succeeded"), "missing generation succeeded event");
  assertTrue(successProvider.createTaskCallCount === 1, "mock provider should be called once");

  const idempotent = await executeControlledGenerationTask(successStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m5-approved",
    actionHash: sampleActionHash,
    idempotencyKey: sampleIdempotencyKey,
    generation: sampleGenerationInput,
    provider: successProvider,
    now: "2026-05-22T00:01:00.000Z"
  });
  assertTrue(idempotent.ok && idempotent.idempotent, "same idempotencyKey should return existing result");
  assertTrue(successProvider.createTaskCallCount === 1, "idempotent execution must not call provider again");
  assertTrue((await successStore.loadProject(sampleProjectId))?.generationTasks.length === 1, "idempotent execution created duplicate task");

  const failedProvider = createMockMediaGenerationProvider({ outcome: "failed" });
  const failedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m5-failed",
    idempotencyKey: `${sampleIdempotencyKey}:failed`
  })]);
  const failed = await executeControlledGenerationTask(failedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m5-failed",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:failed`,
    generation: sampleGenerationInput,
    provider: failedProvider,
    now: sampleNow
  });
  assertTrue(!failed.ok, "mock failed provider should return failed execution");
  assertTrue(failed.task?.status === "failed", "mock failure should write failed task");
  assertTrue(failed.task?.errorCode === "mock_generation_failed", "mock failure should write errorCode");
  assertTrue(failed.bundle?.events.some((event) => event.eventType === "generation.failed"), "missing generation failed event");

  return {
    pendingBlocked: Boolean(pendingBlocked.blocker),
    staleHashBlocked: Boolean(staleHashBlocked.blocker),
    succeededTaskStatus: succeeded.task?.status,
    succeededAssetSource: succeeded.asset?.source,
    idempotent: Boolean(idempotent.idempotent),
    failedTaskStatus: failed.task?.status,
    viduGenerateCalls: 0,
    realProviderCalls: 0
  };
}

export async function typecheckM52AsyncGenerationExecutor() {
  const viduDryRunProvider = createViduDryRunMediaGenerationProvider();
  const queuedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m52-queued",
    idempotencyKey: `${sampleIdempotencyKey}:queued`
  })]);
  const queued = await executeControlledGenerationTask(queuedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-queued",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:queued`,
    generation: {
      ...sampleGenerationInput,
      modelId: "viduq3-turbo",
      modelName: "Vidu Q3 Turbo"
    },
    provider: viduDryRunProvider,
    now: sampleNow
  });
  assertTrue(queued.ok, "Vidu dry-run create should be accepted");
  assertTrue(queued.task?.status === "queued" || queued.task?.status === "running", "Vidu dry-run create must stay non-terminal");
  assertTrue(queued.asset === undefined, "queued create must not write media asset");
  assertTrue(queued.approval?.status === "executing", "queued create must leave approval executing");
  assertTrue(!queued.bundle?.events.some((event) => event.eventType === "generation.succeeded"), "queued create wrote generation.succeeded");
  assertTrue(viduDryRunProvider.createTaskCallCount === 1, "dry-run create should call provider once");

  const duplicateQueued = await executeControlledGenerationTask(queuedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-queued",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:queued`,
    generation: {
      ...sampleGenerationInput,
      modelId: "viduq3-turbo",
      modelName: "Vidu Q3 Turbo"
    },
    provider: viduDryRunProvider,
    now: "2026-05-22T00:01:00.000Z"
  });
  assertTrue(duplicateQueued.idempotent, "duplicate async create must return existing task");
  assertTrue(viduDryRunProvider.createTaskCallCount === 1, "duplicate async create must not call provider again");

  const throwingProvider = createThrowingDryRunProvider("create failed before provider task id");
  const throwingStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m52-create-throws",
    idempotencyKey: `${sampleIdempotencyKey}:create-throws`
  })]);
  const createThrows = await executeControlledGenerationTask(throwingStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-create-throws",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:create-throws`,
    generation: sampleGenerationInput,
    provider: throwingProvider,
    now: sampleNow
  });
  assertTrue(!createThrows.ok, "provider create throw should fail execution");
  assertTrue(createThrows.task?.status === "failed", "provider create throw must write failed task");
  assertTrue(createThrows.task?.errorCode === "provider_create_failed", "provider create throw must preserve failure code");
  assertTrue(createThrows.approval?.status === "execution_failed", "provider create throw must mark approval execution_failed");
  assertTrue(createThrows.bundle?.events.some((event) => event.eventType === "generation.failed"), "provider create throw must write generation.failed");

  const runningProvider = createScriptedDryRunProvider({
    createResult: {
      providerTaskId: "vidu-dry-run-running",
      status: "queued",
      progress: 12,
      credits: 0
    },
    pollResults: [
      {
        providerTaskId: "vidu-dry-run-running",
        status: "running",
        progress: 40,
        credits: 0
      }
    ]
  });
  const runningStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m52-running",
    idempotencyKey: `${sampleIdempotencyKey}:running`
  })]);
  const runningCreated = await executeControlledGenerationTask(runningStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-running",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:running`,
    generation: sampleGenerationInput,
    provider: runningProvider,
    now: sampleNow
  });
  const runningPoll = await pollControlledGenerationTask(runningStore, {
    projectId: sampleProjectId,
    taskId: runningCreated.task?.id ?? "",
    provider: runningProvider,
    now: "2026-05-22T00:02:00.000Z"
  });
  assertTrue(runningPoll.ok, "running poll should succeed");
  assertTrue(runningPoll.task?.status === "running", "running poll must keep task running");
  assertTrue(runningPoll.asset === undefined, "running poll must not write media asset");
  assertTrue(runningPoll.approval?.status === "executing", "running poll must keep approval executing");
  assertTrue(runningPoll.bundle?.events.some((event) => event.eventType === "generation.status_changed"), "running poll must write status_changed");

  const succeededProvider = createScriptedDryRunProvider({
    createResult: {
      providerTaskId: "vidu-dry-run-succeeded",
      status: "queued",
      progress: 12,
      credits: 0
    },
    pollResults: [
      {
        providerTaskId: "vidu-dry-run-succeeded",
        status: "succeeded",
        progress: 100,
        credits: 3,
        output: {
          kind: "video",
          title: "Vidu dry-run video",
          assetUrl: "https://cdn.example.com/cover.png",
          downloadUrl: "https://cdn.example.com/video.mp4",
          mimeType: "video/mp4",
          durationMs: 5000
        }
      }
    ]
  });
  const succeededStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m52-succeeded",
    idempotencyKey: `${sampleIdempotencyKey}:succeeded`
  })]);
  const succeededCreated = await executeControlledGenerationTask(succeededStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-succeeded",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:succeeded`,
    generation: sampleGenerationInput,
    provider: succeededProvider,
    now: sampleNow
  });
  const succeededPoll = await pollControlledGenerationTask(succeededStore, {
    projectId: sampleProjectId,
    taskId: succeededCreated.task?.id ?? "",
    provider: succeededProvider,
    now: "2026-05-22T00:03:00.000Z"
  });
  assertTrue(succeededPoll.ok, "succeeded poll should succeed");
  assertTrue(succeededPoll.task?.status === "succeeded", "succeeded poll must write succeeded task");
  assertTrue(succeededPoll.asset?.source === "generation", "Vidu succeeded poll must write generated media asset");
  assertTrue(succeededPoll.asset?.recoverable === false, "Vidu temporary URL must be marked unrecoverable");
  assertTrue(Boolean(succeededPoll.asset?.storage?.signedUrlExpiresAt), "Vidu temporary URL must carry expiry marker");
  assertTrue(succeededPoll.approval?.status === "executed", "succeeded poll must mark approval executed");
  assertTrue(succeededPoll.bundle?.events.some((event) => event.eventType === "asset.not_persisted"), "Vidu temporary asset must write not_persisted event");
  assertTrue(succeededPoll.bundle?.events.some((event) => event.eventType === "generation.succeeded"), "succeeded poll must write generation.succeeded");

  const assetCountAfterSuccess = succeededPoll.bundle?.mediaAssets.length ?? 0;
  const eventCountAfterSuccess = succeededPoll.bundle?.events.length ?? 0;
  const duplicateSuccessPoll = await pollControlledGenerationTask(succeededStore, {
    projectId: sampleProjectId,
    taskId: succeededCreated.task?.id ?? "",
    provider: succeededProvider,
    now: "2026-05-22T00:04:00.000Z"
  });
  assertTrue(duplicateSuccessPoll.idempotent, "duplicate succeeded poll must be idempotent");
  assertTrue((duplicateSuccessPoll.bundle?.mediaAssets.length ?? 0) === assetCountAfterSuccess, "duplicate succeeded poll wrote duplicate asset");
  assertTrue((duplicateSuccessPoll.bundle?.events.length ?? 0) === eventCountAfterSuccess, "duplicate succeeded poll wrote duplicate event");

  const storageSuccessCalls = { count: 0 };
  const persistedProvider = createScriptedDryRunProvider({
    createResult: {
      providerTaskId: "vidu-dry-run-storage-succeeded",
      status: "succeeded",
      progress: 100,
      credits: 3,
      output: {
        kind: "video",
        title: "Vidu persisted video",
        downloadUrl: "https://cdn.example.com/persisted-video.mp4"
      }
    },
    pollResults: []
  });
  const persistedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m55-persisted",
    idempotencyKey: `${sampleIdempotencyKey}:m55-persisted`
  })]);
  const persisted = await executeControlledGenerationTask(persistedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m55-persisted",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:m55-persisted`,
    generation: sampleGenerationInput,
    provider: persistedProvider,
    mediaStorageProvider: createSuccessfulMediaStorageProvider(storageSuccessCalls),
    now: sampleNow
  });
  assertTrue(persisted.ok, "storage-backed generation should succeed");
  assertTrue(storageSuccessCalls.count === 1, "storage-backed generation must call media storage once");
  assertTrue(persisted.asset?.recoverable === true, "persisted asset must be recoverable");
  assertTrue(persisted.asset?.storage?.provider === "supabase_storage", "persisted asset must use supabase_storage");
  assertTrue(Boolean(persisted.asset?.storage?.key), "persisted asset must write storage key");
  assertTrue(persisted.bundle?.events.some((event) => event.eventType === "asset.persisted"), "persisted asset must write asset.persisted");
  assertTrue(!persisted.bundle?.events.some((event) => event.eventType === "asset.not_persisted"), "persisted asset must not write asset.not_persisted");

  const storageFailureCalls = { count: 0 };
  const notPersistedProvider = createScriptedDryRunProvider({
    createResult: {
      providerTaskId: "vidu-dry-run-storage-failed",
      status: "succeeded",
      progress: 100,
      credits: 3,
      output: {
        kind: "video",
        title: "Vidu temporary video",
        downloadUrl: "https://cdn.example.com/temporary-video.mp4"
      }
    },
    pollResults: []
  });
  const notPersistedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m55-not-persisted",
    idempotencyKey: `${sampleIdempotencyKey}:m55-not-persisted`
  })]);
  const notPersisted = await executeControlledGenerationTask(notPersistedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m55-not-persisted",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:m55-not-persisted`,
    generation: sampleGenerationInput,
    provider: notPersistedProvider,
    mediaStorageProvider: createFailingMediaStorageProvider(storageFailureCalls),
    now: sampleNow
  });
  assertTrue(notPersisted.ok, "storage failure must not block generation success");
  assertTrue(storageFailureCalls.count === 1, "storage failure path must call media storage once");
  assertTrue(notPersisted.task?.status === "succeeded", "storage failure must keep task succeeded");
  assertTrue(notPersisted.asset?.storage?.provider === "external", "storage failure must keep external asset");
  assertTrue(notPersisted.asset?.recoverable === false, "storage failure must keep asset unrecoverable");
  assertTrue(notPersisted.bundle?.events.some((event) => event.eventType === "asset.not_persisted"), "storage failure must write asset.not_persisted");
  assertTrue(notPersisted.bundle?.events.some((event) => event.eventType === "generation.succeeded"), "storage failure must still write generation.succeeded");

  const failedProvider = createScriptedDryRunProvider({
    createResult: {
      providerTaskId: "vidu-dry-run-failed",
      status: "queued",
      progress: 12,
      credits: 0
    },
    pollResults: [
      {
        providerTaskId: "vidu-dry-run-failed",
        status: "failed",
        progress: 100,
        credits: 1,
        errorCode: "vidu_content_policy",
        errorMessage: "Vidu rejected the request."
      }
    ]
  });
  const failedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m52-poll-failed",
    idempotencyKey: `${sampleIdempotencyKey}:poll-failed`
  })]);
  const failedCreated = await executeControlledGenerationTask(failedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m52-poll-failed",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:poll-failed`,
    generation: sampleGenerationInput,
    provider: failedProvider,
    now: sampleNow
  });
  const failedPoll = await pollControlledGenerationTask(failedStore, {
    projectId: sampleProjectId,
    taskId: failedCreated.task?.id ?? "",
    provider: failedProvider,
    now: "2026-05-22T00:05:00.000Z"
  });
  assertTrue(!failedPoll.ok, "failed poll should return failed execution");
  assertTrue(failedPoll.task?.status === "failed", "failed poll must write failed task");
  assertTrue(failedPoll.task?.errorCode === "vidu_content_policy", "failed poll must write provider error code");
  assertTrue(failedPoll.approval?.status === "execution_failed", "failed poll must mark approval execution_failed");
  assertTrue(failedPoll.bundle?.events.some((event) => event.eventType === "generation.failed"), "failed poll must write generation.failed");

  return {
    queuedStatus: queued.task?.status,
    queuedApprovalStatus: queued.approval?.status,
    duplicateCreateIdempotent: Boolean(duplicateQueued.idempotent),
    runningPollStatus: runningPoll.task?.status,
    createThrowTaskStatus: createThrows.task?.status,
    succeededPollStatus: succeededPoll.task?.status,
    succeededAssetRecoverable: succeededPoll.asset?.recoverable,
    persistedAssetStorageProvider: persisted.asset?.storage?.provider,
    notPersistedAssetStorageProvider: notPersisted.asset?.storage?.provider,
    duplicateSuccessIdempotent: Boolean(duplicateSuccessPoll.idempotent),
    failedPollStatus: failedPoll.task?.status,
    failedApprovalStatus: failedPoll.approval?.status,
    viduGenerateCalls: 0,
    realProviderCalls: 0
  };
}

export async function typecheckM53BLiveSmokeGenerationExecutorGate() {
  const liveProvider = createScriptedLiveSmokeProvider({
    createResult: {
      providerTaskId: "vidu-live-smoke-queued",
      status: "queued",
      progress: 12,
      credits: 0
    },
    pollResults: [
      {
        providerTaskId: "vidu-live-smoke-queued",
        status: "running",
        progress: 50,
        credits: 0
      }
    ]
  });
  const blockedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m53b-live-blocked",
    idempotencyKey: `${sampleIdempotencyKey}:live-blocked`
  })]);
  const blocked = await executeControlledGenerationTask(blockedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m53b-live-blocked",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:live-blocked`,
    generation: sampleGenerationInput,
    provider: liveProvider,
    now: sampleNow
  });
  assertTrue(!blocked.ok, "live smoke provider must be blocked without allowLiveProvider");
  assertTrue(liveProvider.createTaskCallCount === 0, "blocked live smoke provider must not call createTask");

  const allowedStore = createMemoryAgentProjectStore([createBundle({
    ...createGenerationApproval("approved"),
    id: "approval-m53b-live-allowed",
    idempotencyKey: `${sampleIdempotencyKey}:live-allowed`
  })]);
  const allowed = await executeControlledGenerationTask(allowedStore, {
    projectId: sampleProjectId,
    approvalRequestId: "approval-m53b-live-allowed",
    actionHash: sampleActionHash,
    idempotencyKey: `${sampleIdempotencyKey}:live-allowed`,
    generation: sampleGenerationInput,
    provider: liveProvider,
    allowLiveProvider: true,
    now: sampleNow
  });
  assertTrue(allowed.ok, "explicit live smoke provider should be allowed");
  assertTrue(allowed.task?.status === "queued", "live smoke create should remain queued");
  assertTrue(Number(liveProvider.createTaskCallCount) === 1, "allowed live smoke provider should call createTask once");

  const pollBlocked = await pollControlledGenerationTask(allowedStore, {
    projectId: sampleProjectId,
    taskId: allowed.task?.id ?? "",
    provider: liveProvider,
    now: "2026-05-22T00:06:00.000Z"
  });
  assertTrue(!pollBlocked.ok, "live smoke poll must be blocked without allowLiveProvider");
  assertTrue(liveProvider.getTaskCallCount === 0, "blocked live smoke poll must not call getTask");

  const pollAllowed = await pollControlledGenerationTask(allowedStore, {
    projectId: sampleProjectId,
    taskId: allowed.task?.id ?? "",
    provider: liveProvider,
    allowLiveProvider: true,
    now: "2026-05-22T00:07:00.000Z"
  });
  assertTrue(pollAllowed.ok, "explicit live smoke poll should be allowed");
  assertTrue(pollAllowed.task?.status === "running", "live smoke poll should update running status");
  assertTrue(Number(liveProvider.getTaskCallCount) === 1, "allowed live smoke poll should call getTask once");

  return {
    blockedWithoutAllow: Boolean(blocked.blocker),
    allowedStatus: allowed.task?.status,
    pollBlockedWithoutAllow: Boolean(pollBlocked.blocker),
    pollAllowedStatus: pollAllowed.task?.status,
    realProviderCalls: 0,
    viduGenerateCalls: 0
  };
}
