import { setTimeout as sleep } from "node:timers/promises";
import { NextResponse } from "next/server";
import type { GenerationKind } from "@/features/generation/types";
import {
  executeControlledGenerationTask,
  pollControlledGenerationTask,
  type ControlledGenerationExecutionResult,
  type ControlledGenerationRequest
} from "@/features/agent-runtime/generation-executor";
import {
  createViduLiveMediaGenerationProvider,
  VIDU_LIVE_PROVIDER_CONFIRM_ENV,
  VIDU_LIVE_PROVIDER_CONFIRM_VALUE,
  VIDU_LIVE_PROVIDER_ENABLE_ENV,
  type ViduLiveTransport
} from "@/features/agent-runtime/vidu-live-generation-provider";
import {
  createEmptyAgentProjectBundle,
  type AgentProjectBundle,
  type AgentProjectStore,
  type ApprovalRequestRecord,
  type GenerationTaskRecord
} from "@/lib/agent-project-store";
import { createServerAgentProjectStore } from "@/lib/agent-project-server-store";

export const runtime = "nodejs";

const ROUTE_ENABLE_ENV = "AD_STUDIO_M53B_ENABLE_REAL_VIDU_SMOKE";
const ROUTE_CONFIRM_ENV = "AD_STUDIO_M53B_CONFIRM_REAL_VIDU_SMOKE";
const ROUTE_CONFIRM_VALUE = "I_CONFIRM_M53B_REAL_VIDU_SMOKE_CAN_COST_CREDITS";
const DEFAULT_PROJECT_ID = "project-m53b-vidu-live-smoke";
const DEFAULT_SESSION_ID = "session-m53b-vidu-live-smoke";
const DEFAULT_PROMPT =
  "Create a 5 second vertical mobile app ad. A young adult checks a phone map, smiles after finding family location, realistic lifestyle scene, no text overlay, no logos.";

type SmokeRequestBody = {
  execute?: boolean;
  confirm?: string;
  projectId?: string;
  sessionId?: string;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  modeKey?: string;
  ratio?: string;
  duration?: string | number;
  resolution?: string;
  maxPolls?: number;
  pollIntervalMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function stableJson(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableHash(value: unknown) {
  return hashString(JSON.stringify(stableJson(value)));
}

function createGenerationRequest(body: SmokeRequestBody): ControlledGenerationRequest {
  return {
    kind: "video",
    surface: "agent",
    modelId: stringOrDefault(body.modelId, "viduq3-turbo"),
    modelName: stringOrDefault(body.modelName, "Vidu Q3 Turbo"),
    modeKey: stringOrDefault(body.modeKey, "text-to-video"),
    prompt: stringOrDefault(body.prompt, DEFAULT_PROMPT),
    params: {
      ratio: stringOrDefault(body.ratio, "9:16"),
      duration: body.duration ?? "5s",
      resolution: stringOrDefault(body.resolution, "720p")
    },
    slots: []
  };
}

function createSmokeIds(projectId: string, generation: ControlledGenerationRequest) {
  const actionHash = `generation:vidu-live-smoke:${stableHash(generation)}`;
  return {
    actionHash,
    idempotencyKey: `m53b:${projectId}:${actionHash}`,
    approvalRequestId: `approval-${hashString(`${projectId}:${actionHash}`)}`
  };
}

function createSmokeApproval(input: {
  projectId: string;
  sessionId: string;
  approvalRequestId: string;
  actionHash: string;
  idempotencyKey: string;
  generation: ControlledGenerationRequest;
  now: string;
}): ApprovalRequestRecord {
  return {
    schemaVersion: 1,
    id: input.approvalRequestId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    kind: "generation",
    title: "M5.3B Vidu 真实生成 smoke",
    summary: "受控执行一条低成本 Vidu text-to-video smoke，确认异步 GenerationTask 链路能跑通。",
    status: "pending",
    requestedActions: [],
    actionHash: input.actionHash,
    idempotencyKey: input.idempotencyKey,
    affectedNodeIds: [],
    affectedArtifactIds: [],
    estimatedCredits: 0,
    requestedBy: "m53b-smoke",
    requestedAt: input.now
  };
}

async function ensureProjectBundle(store: AgentProjectStore, projectId: string, now: string) {
  const existing = await store.loadProject(projectId);
  if (existing) return existing;

  const empty = createEmptyAgentProjectBundle({
    projectId,
    title: "M5.3B Vidu Live Smoke",
    mode: "clone",
    now
  });
  return store.saveProjectPatch(projectId, {
    project: {
      ...empty.project,
      lifecycle: "ready"
    },
    canvasGraph: empty.canvasGraph,
    updatedAt: now
  });
}

async function ensureApproval(input: {
  store: AgentProjectStore;
  bundle: AgentProjectBundle;
  projectId: string;
  sessionId: string;
  approvalRequestId: string;
  actionHash: string;
  idempotencyKey: string;
  generation: ControlledGenerationRequest;
  now: string;
}) {
  const existing = input.bundle.approvalRequests.find((approval) => approval.id === input.approvalRequestId);
  if (existing) return existing;

  const approval = createSmokeApproval(input);
  const patched = await input.store.saveProjectPatch(input.projectId, {
    approvalRequests: [approval],
    events: [
      {
        projectId: input.projectId,
        sessionId: input.sessionId,
        actorType: "system",
        eventType: "approval.requested",
        objectType: "approval_request",
        objectId: approval.id,
        correlationId: approval.id,
        requestId: approval.idempotencyKey,
        payload: {
          actionHash: approval.actionHash,
          idempotencyKey: approval.idempotencyKey,
          smoke: "m53b-vidu-live"
        },
        createdAt: input.now
      }
    ],
    updatedAt: input.now
  });
  return patched.approvalRequests.find((record) => record.id === approval.id) ?? approval;
}

async function approveIfNeeded(store: AgentProjectStore, approval: ApprovalRequestRecord, now: string) {
  if (approval.status === "approved" || approval.status === "executing" || approval.status === "executed" || approval.status === "execution_failed") {
    return approval;
  }
  if (approval.status === "rejected") {
    throw new Error("This smoke approval was rejected. Use a different projectId or prompt to create a new idempotency key.");
  }
  return store.updateApprovalStatus({
    projectId: approval.projectId,
    approvalRequestId: approval.id,
    status: "approved",
    respondedBy: "m53b-smoke",
    respondedAt: now
  });
}

function createTaskKinds(bundle: AgentProjectBundle) {
  const taskKinds = new Map<string, GenerationKind>();
  for (const task of bundle.generationTasks) {
    if ((task.kind === "image" || task.kind === "video") && task.providerTaskId) {
      taskKinds.set(task.providerTaskId, task.kind);
    }
  }
  return taskKinds;
}

function readProviderMessage(data: unknown, fallback: string) {
  if (isRecord(data)) {
    const message = data.message ?? data.error ?? data.err_msg ?? data.reason;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim()) return data.trim();
  return fallback;
}

function createViduLiveTransport(counter: { count: number }): ViduLiveTransport {
  return async (request) => {
    counter.count += 1;
    const response = await fetch(`${request.apiBaseUrl}${request.path}`, {
      method: request.method,
      cache: "no-store",
      headers: {
        Authorization: `Token ${request.apiKey}`,
        "Content-Type": "application/json"
      },
      body: request.body ? JSON.stringify(request.body) : undefined
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw new Error(`Vidu API ${response.status}: ${readProviderMessage(data, "request failed")}`);
    }
    return data;
  };
}

function isTerminalResult(result: ControlledGenerationExecutionResult) {
  return result.task?.status === "succeeded" || result.task?.status === "failed" || result.task?.status === "cancelled";
}

async function pollUntilTerminal(input: {
  store: AgentProjectStore;
  projectId: string;
  result: ControlledGenerationExecutionResult;
  provider: ReturnType<typeof createViduLiveMediaGenerationProvider>;
  maxPolls: number;
  pollIntervalMs: number;
}) {
  let result = input.result;
  for (let attempt = 0; attempt < input.maxPolls; attempt += 1) {
    if (!result.ok || isTerminalResult(result) || !result.task?.providerTaskId) return result;
    await sleep(input.pollIntervalMs);
    result = await pollControlledGenerationTask(input.store, {
      projectId: input.projectId,
      taskId: result.task.id,
      providerTaskId: result.task.providerTaskId,
      provider: input.provider,
      allowLiveProvider: true
    });
  }
  return result;
}

function summarizeBundle(bundle: AgentProjectBundle | undefined, task: GenerationTaskRecord | undefined) {
  if (!bundle) return undefined;
  return {
    approvalStatuses: bundle.approvalRequests.map((approval) => ({
      id: approval.id,
      status: approval.status,
      actualCredits: approval.actualCredits
    })),
    taskStatuses: bundle.generationTasks.map((record) => ({
      id: record.id,
      provider: record.provider,
      providerTaskId: record.providerTaskId,
      status: record.status,
      progress: record.progress,
      credits: record.credits,
      outputAssetId: record.outputAssetId
    })),
    mediaAssetCount: bundle.mediaAssets.length,
    currentTaskEventTypes: task
      ? bundle.events.filter((event) => event.objectId === task.id || event.payload.taskId === task.id).map((event) => event.eventType)
      : []
  };
}

function createPlanResponse(input: {
  projectId: string;
  sessionId: string;
  generation: ControlledGenerationRequest;
  actionHash: string;
  idempotencyKey: string;
  enabled: boolean;
  confirmed: boolean;
}) {
  return NextResponse.json({
    ok: false,
    status: "plan_only",
    blocker: "M5.3B real Vidu smoke requires explicit route env gates, request confirmation, and execute=true.",
    requiredEnv: [ROUTE_ENABLE_ENV, ROUTE_CONFIRM_ENV, "VIDU_API_KEY"],
    requiredConfirmValue: ROUTE_CONFIRM_VALUE,
    projectId: input.projectId,
    sessionId: input.sessionId,
    actionHash: input.actionHash,
    idempotencyKey: input.idempotencyKey,
    enabled: input.enabled,
    confirmed: input.confirmed,
    generation: input.generation,
    realProviderCalls: 0,
    oldViduRouteCalls: 0
  }, { status: 403 });
}

export async function POST(request: Request) {
  const now = new Date().toISOString();
  const body = (await request.json().catch(() => ({}))) as SmokeRequestBody;
  const projectId = stringOrDefault(body.projectId, DEFAULT_PROJECT_ID);
  const sessionId = stringOrDefault(body.sessionId, DEFAULT_SESSION_ID);
  const generation = createGenerationRequest(body);
  const { actionHash, idempotencyKey, approvalRequestId } = createSmokeIds(projectId, generation);
  const enabled = process.env[ROUTE_ENABLE_ENV] === "1";
  const confirmed = process.env[ROUTE_CONFIRM_ENV] === ROUTE_CONFIRM_VALUE && body.confirm === ROUTE_CONFIRM_VALUE;

  if (!body.execute || !enabled || !confirmed) {
    return createPlanResponse({
      projectId,
      sessionId,
      generation,
      actionHash,
      idempotencyKey,
      enabled,
      confirmed
    });
  }

  const store = createServerAgentProjectStore();
  const bundle = await ensureProjectBundle(store, projectId, now);
  const approval = await ensureApproval({
    store,
    bundle,
    projectId,
    sessionId,
    approvalRequestId,
    actionHash,
    idempotencyKey,
    generation,
    now
  });
  const approved = await approveIfNeeded(store, approval, now);
  const latestBundle = await store.loadProject(projectId) ?? bundle;
  const transportCounter = { count: 0 };
  const provider = createViduLiveMediaGenerationProvider({
    env: {
      [VIDU_LIVE_PROVIDER_ENABLE_ENV]: "1",
      [VIDU_LIVE_PROVIDER_CONFIRM_ENV]: VIDU_LIVE_PROVIDER_CONFIRM_VALUE,
      VIDU_API_KEY: process.env.VIDU_API_KEY,
      VIDU_API_BASE_URL: process.env.VIDU_API_BASE_URL
    },
    estimatedCredits: approved.estimatedCredits ?? 0,
    transport: createViduLiveTransport(transportCounter),
    taskKinds: createTaskKinds(latestBundle)
  });
  const maxPolls = finiteNumber(body.maxPolls, 48, 0, 120);
  const pollIntervalMs = finiteNumber(body.pollIntervalMs, 5000, 1000, 30000);

  const created = await executeControlledGenerationTask(store, {
    projectId,
    approvalRequestId: approved.id,
    actionHash,
    idempotencyKey,
    generation,
    provider,
    allowLiveProvider: true,
    now
  });
  const finalResult = await pollUntilTerminal({
    store,
    projectId,
    result: created,
    provider,
    maxPolls,
    pollIntervalMs
  });
  const finalBundle = await store.loadProject(projectId) ?? finalResult.bundle;

  return NextResponse.json({
    ok: finalResult.ok,
    status: finalResult.task?.status ?? "unknown",
    projectId,
    sessionId,
    approvalId: approved.id,
    approvalStatus: finalResult.approval?.status,
    actionHash,
    idempotencyKey,
    task: finalResult.task
      ? {
          id: finalResult.task.id,
          provider: finalResult.task.provider,
          providerTaskId: finalResult.task.providerTaskId,
          status: finalResult.task.status,
          progress: finalResult.task.progress,
          credits: finalResult.task.credits,
          outputAssetId: finalResult.task.outputAssetId,
          errorCode: finalResult.task.errorCode,
          errorMessage: finalResult.task.errorMessage
        }
      : undefined,
    asset: finalResult.asset
      ? {
          id: finalResult.asset.id,
          kind: finalResult.asset.kind,
          source: finalResult.asset.source,
          recoverable: finalResult.asset.recoverable,
          storageProvider: finalResult.asset.storage?.provider,
          signedUrlExpiresAt: finalResult.asset.storage?.signedUrlExpiresAt
        }
      : undefined,
    eventIds: finalResult.eventIds,
    bundleSummary: summarizeBundle(finalBundle, finalResult.task),
    blocker: finalResult.blocker,
    error: finalResult.error,
    realProviderCalls: transportCounter.count,
    oldViduRouteCalls: 0,
    maxPolls,
    pollIntervalMs
  }, { status: finalResult.ok ? 200 : 502 });
}
