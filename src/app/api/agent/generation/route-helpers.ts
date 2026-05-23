import type { GenerationKind, GenerationParamValue, GenerationSlotInput } from "@/features/generation/types";
import type {
  ControlledGenerationExecutionResult,
  ControlledGenerationRequest
} from "@/features/agent-runtime/generation-executor";
import {
  createViduLiveMediaGenerationProvider,
  VIDU_LIVE_PROVIDER_CONFIRM_ENV,
  VIDU_LIVE_PROVIDER_CONFIRM_VALUE,
  VIDU_LIVE_PROVIDER_ENABLE_ENV,
  type ViduLiveTransport
} from "@/features/agent-runtime/vidu-live-generation-provider";
import type {
  AgentProjectBundle,
  GenerationTaskRecord,
  MediaAssetRecord
} from "@/lib/agent-project-store";

export const M54_ENABLE_ENV = "AD_STUDIO_M54_ENABLE_REAL_VIDU_WORKBENCH";
export const M54_CONFIRM_ENV = "AD_STUDIO_M54_CONFIRM_REAL_VIDU_WORKBENCH";
export const M54_CONFIRM_VALUE = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";

type TransportCounter = { count: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scalarRecord(value: unknown): Record<string, GenerationParamValue> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, GenerationParamValue] => {
      const item = entry[1];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean";
    })
  );
}

function parseSlots(value: unknown): GenerationSlotInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GenerationSlotInput[] => {
    if (!isRecord(item)) return [];
    const id = stringOrUndefined(item.id);
    const slotKey = stringOrUndefined(item.slotKey);
    const kind = stringOrUndefined(item.kind);
    const label = stringOrUndefined(item.label);
    const fileName = stringOrUndefined(item.fileName);
    const status = stringOrUndefined(item.status);
    if (!id || !slotKey || (kind !== "image" && kind !== "video") || !label || !fileName || (status !== "uploaded" && status !== "referenced")) return [];
    return [
      {
        id,
        slotKey: slotKey as GenerationSlotInput["slotKey"],
        kind,
        label,
        fileName,
        previewUrl: stringOrUndefined(item.previewUrl),
        status
      }
    ];
  });
}

export function parseControlledGenerationRequest(value: unknown): ControlledGenerationRequest | null {
  if (!isRecord(value)) return null;
  const kind = stringOrUndefined(value.kind);
  const prompt = stringOrUndefined(value.prompt);
  const modelId = stringOrUndefined(value.modelId);
  const modelName = stringOrUndefined(value.modelName);
  const modeKey = stringOrUndefined(value.modeKey);
  if ((kind !== "image" && kind !== "video") || !prompt || !modelId || !modelName || !modeKey) return null;

  return {
    nodeId: stringOrUndefined(value.nodeId),
    nodeVersionId: stringOrUndefined(value.nodeVersionId),
    artifactId: stringOrUndefined(value.artifactId),
    kind,
    surface: "agent",
    modelId,
    modelName,
    modeKey,
    prompt,
    params: scalarRecord(value.params),
    slots: parseSlots(value.slots)
  };
}

function readProviderMessage(data: unknown, fallback: string) {
  if (isRecord(data)) {
    const message = data.message ?? data.error ?? data.err_msg ?? data.reason;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim()) return data.trim();
  return fallback;
}

export function createViduLiveFetchTransport(counter: TransportCounter): ViduLiveTransport {
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

export function getM54Gate() {
  const enabled = process.env[M54_ENABLE_ENV] === "1";
  const confirmed = process.env[M54_CONFIRM_ENV] === M54_CONFIRM_VALUE;
  return {
    enabled,
    confirmed,
    ready: enabled && confirmed,
    requiredEnv: [M54_ENABLE_ENV, M54_CONFIRM_ENV, "VIDU_API_KEY"],
    requiredConfirmValue: M54_CONFIRM_VALUE
  };
}

export function createTaskKinds(bundle: AgentProjectBundle) {
  const taskKinds = new Map<string, GenerationKind>();
  for (const task of bundle.generationTasks) {
    if ((task.kind === "image" || task.kind === "video") && task.providerTaskId) {
      taskKinds.set(task.providerTaskId, task.kind);
    }
  }
  return taskKinds;
}

export function createM54ViduProvider(bundle: AgentProjectBundle, counter: TransportCounter, estimatedCredits = 0) {
  return createViduLiveMediaGenerationProvider({
    env: {
      [VIDU_LIVE_PROVIDER_ENABLE_ENV]: "1",
      [VIDU_LIVE_PROVIDER_CONFIRM_ENV]: VIDU_LIVE_PROVIDER_CONFIRM_VALUE,
      VIDU_API_KEY: process.env.VIDU_API_KEY,
      VIDU_API_BASE_URL: process.env.VIDU_API_BASE_URL
    },
    estimatedCredits,
    transport: createViduLiveFetchTransport(counter),
    taskKinds: createTaskKinds(bundle)
  });
}

function summarizeTask(task: GenerationTaskRecord | undefined) {
  if (!task) return undefined;
  return {
    id: task.id,
    approvalRequestId: task.approvalRequestId,
    provider: task.provider,
    providerTaskId: task.providerTaskId,
    status: task.status,
    progress: task.progress,
    credits: task.credits,
    costUsd: task.costUsd,
    outputAssetId: task.outputAssetId,
    output: task.output,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    updatedAt: task.updatedAt
  };
}

function summarizeAsset(asset: MediaAssetRecord | undefined) {
  if (!asset) return undefined;
  return {
    id: asset.id,
    kind: asset.kind,
    role: asset.role,
    source: asset.source,
    recoverable: asset.recoverable,
    storageProvider: asset.storage?.provider,
    storageKey: asset.storage?.key,
    publicUrl: asset.storage?.publicUrl,
    signedUrlExpiresAt: asset.storage?.signedUrlExpiresAt
  };
}

export function createGenerationRouteResponse(result: ControlledGenerationExecutionResult, realProviderCalls: number) {
  const externalTemporaryAsset =
    result.asset?.storage?.provider === "external" && result.asset.recoverable === false;
  return {
    ok: result.ok,
    status: result.task?.status ?? "unknown",
    projectId: result.task?.projectId ?? result.approval?.projectId,
    approvalId: result.approval?.id,
    approvalStatus: result.approval?.status,
    task: summarizeTask(result.task),
    asset: summarizeAsset(result.asset),
    eventIds: result.eventIds,
    idempotent: result.idempotent,
    blocker: result.blocker,
    error: result.error,
    bundle: result.bundle,
    temporaryExternalAssetWarning: externalTemporaryAsset
      ? "结果仅可临时预览，长期保存失败；外链过期后可能无法恢复。"
      : undefined,
    realProviderCalls,
    oldViduRouteCalls: 0
  };
}
