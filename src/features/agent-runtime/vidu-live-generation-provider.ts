import type { GenerationKind } from "@/features/generation/types";
import type {
  MediaGenerationCreateResult,
  MediaGenerationInput,
  MediaGenerationProvider
} from "./generation-provider";
import {
  buildViduGenerationPayload,
  mapViduProviderStatus,
  mapViduTaskResult,
  normalizeViduProviderError,
  type ViduCreatePath,
  type ViduTaskLike,
  validateViduGenerationInput
} from "./vidu-generation-provider";

const DEFAULT_VIDU_API_BASE_URL = "https://api.vidu.cn/ent/v2";

export const VIDU_LIVE_PROVIDER_ENABLE_ENV = "AD_STUDIO_M53A_ENABLE_VIDU_LIVE_PROVIDER";
export const VIDU_LIVE_PROVIDER_CONFIRM_ENV = "AD_STUDIO_M53A_CONFIRM_REAL_VIDU_SMOKE";
export const VIDU_LIVE_PROVIDER_CONFIRM_VALUE = "I_CONFIRM_REAL_VIDU_SMOKE_CAN_COST_CREDITS";

type ViduLiveEnv = Record<string, string | undefined>;

export type ViduLiveTransportRequest = {
  apiBaseUrl: string;
  apiKey: string;
  method: "GET" | "POST";
  path: ViduCreatePath | `/tasks/${string}/creations`;
  body?: Record<string, unknown>;
};

export type ViduLiveTransport = (request: ViduLiveTransportRequest) => Promise<unknown>;

export type ViduLiveGenerationPlan = {
  ok: boolean;
  enabled: boolean;
  confirmed: boolean;
  requiredEnv: string[];
  blocker?: string;
  request?: {
    method: "POST";
    apiBaseUrl: string;
    path: ViduCreatePath;
    model: string;
    body: Record<string, unknown>;
  };
};

export type ViduLiveGenerationProviderOptions = {
  apiBaseUrl?: string;
  apiKey?: string;
  env?: ViduLiveEnv;
  estimatedCredits?: number;
  transport?: ViduLiveTransport;
  taskKinds?: Map<string, GenerationKind>;
};

export class ViduLiveProviderBlockedError extends Error {
  errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = "ViduLiveProviderBlockedError";
    this.errorCode = errorCode;
  }
}

function envValue(options: ViduLiveGenerationProviderOptions, key: string) {
  if (options.env && Object.prototype.hasOwnProperty.call(options.env, key)) return options.env[key];
  if (typeof process !== "undefined") return process.env[key];
  return undefined;
}

function apiBaseUrl(options: ViduLiveGenerationProviderOptions) {
  return (options.apiBaseUrl ?? envValue(options, "VIDU_API_BASE_URL") ?? DEFAULT_VIDU_API_BASE_URL).replace(/\/+$/, "");
}

function isEnabled(options: ViduLiveGenerationProviderOptions) {
  return envValue(options, VIDU_LIVE_PROVIDER_ENABLE_ENV) === "1";
}

function isConfirmed(options: ViduLiveGenerationProviderOptions) {
  return envValue(options, VIDU_LIVE_PROVIDER_CONFIRM_ENV) === VIDU_LIVE_PROVIDER_CONFIRM_VALUE;
}

function resolveApiKey(options: ViduLiveGenerationProviderOptions) {
  return options.apiKey ?? envValue(options, "VIDU_API_KEY")?.trim();
}

function assertLiveSmokeAllowed(options: ViduLiveGenerationProviderOptions) {
  if (!isEnabled(options)) {
    throw new ViduLiveProviderBlockedError(
      "vidu_live_provider_disabled",
      `${VIDU_LIVE_PROVIDER_ENABLE_ENV}=1 is required before a live Vidu smoke can be attempted.`
    );
  }

  if (!isConfirmed(options)) {
    throw new ViduLiveProviderBlockedError(
      "vidu_live_provider_unconfirmed",
      `${VIDU_LIVE_PROVIDER_CONFIRM_ENV} must match the confirmation value before a live Vidu smoke can be attempted.`
    );
  }

  if (!resolveApiKey(options)) {
    throw new ViduLiveProviderBlockedError("vidu_live_missing_api_key", "VIDU_API_KEY is required for live Vidu smoke.");
  }

  if (!options.transport) {
    throw new ViduLiveProviderBlockedError(
      "vidu_live_transport_missing",
      "Live Vidu smoke requires an explicit transport; no default network transport is installed in M5.3A."
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeCreations(value: unknown): NonNullable<ViduTaskLike["creations"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return [
      {
        id: getString(record, "id"),
        url: getString(record, "url"),
        coverUrl: getString(record, "coverUrl"),
        cover_url: getString(record, "cover_url"),
        watermarkedUrl: getString(record, "watermarkedUrl"),
        watermarked_url: getString(record, "watermarked_url")
      }
    ];
  });
}

function mapCreateResponse(data: unknown): MediaGenerationCreateResult {
  const record = asRecord(data);
  const providerTaskId = getString(record, "task_id") ?? getString(record, "taskId") ?? getString(record, "id");
  if (!providerTaskId) {
    throw new ViduLiveProviderBlockedError("vidu_live_missing_task_id", "Vidu create response did not include a task id.");
  }

  const providerState = getString(record, "state") ?? "created";
  const status = mapViduProviderStatus(providerState);
  const normalizedError = status === "failed" ? normalizeViduProviderError(record) : undefined;
  return {
    providerTaskId,
    status,
    progress: status === "queued" ? 12 : status === "running" ? 25 : status === "succeeded" ? 100 : undefined,
    credits: getNumber(record, "credits"),
    errorCode: normalizedError?.errorCode,
    errorMessage: normalizedError?.errorMessage,
    raw: {
      live: true,
      state: providerState,
      model: getString(record, "model")
    }
  };
}

function normalizeTaskResponse(providerTaskId: string, data: unknown): ViduTaskLike {
  const record = asRecord(data);
  return {
    id: getString(record, "id") ?? providerTaskId,
    state: getString(record, "state") ?? "created",
    errCode: getString(record, "errCode"),
    err_code: getString(record, "err_code"),
    credits: getNumber(record, "credits"),
    progress: getNumber(record, "progress"),
    creations: normalizeCreations(record.creations)
  };
}

function taskPath(providerTaskId: string): `/tasks/${string}/creations` {
  return `/tasks/${encodeURIComponent(providerTaskId)}/creations` as `/tasks/${string}/creations`;
}

export function createViduLiveGenerationPlan(
  input: MediaGenerationInput,
  options: ViduLiveGenerationProviderOptions = {}
): ViduLiveGenerationPlan {
  const validation = validateViduGenerationInput(input);
  const requiredEnv = [VIDU_LIVE_PROVIDER_ENABLE_ENV, VIDU_LIVE_PROVIDER_CONFIRM_ENV, "VIDU_API_KEY"];

  if (!validation.ok) {
    return {
      ok: false,
      enabled: isEnabled(options),
      confirmed: isConfirmed(options),
      requiredEnv,
      blocker: validation.errorMessage
    };
  }

  const request = buildViduGenerationPayload(input);
  const enabled = isEnabled(options);
  const confirmed = isConfirmed(options);
  return {
    ok: true,
    enabled,
    confirmed,
    requiredEnv,
    blocker: enabled && confirmed ? undefined : "Live Vidu smoke is still disabled or unconfirmed.",
    request: {
      method: "POST",
      apiBaseUrl: apiBaseUrl(options),
      path: request.path,
      model: request.model,
      body: request.body
    }
  };
}

export function createViduLiveMediaGenerationProvider(
  options: ViduLiveGenerationProviderOptions = {}
): MediaGenerationProvider {
  const taskKinds = options.taskKinds ?? new Map<string, GenerationKind>();

  return {
    key: "vidu",
    displayName: "Vidu Live Media Generation Provider (M5.3B smoke only)",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-image", "image-reference", "text-to-video", "image-to-video", "first-last-frame", "reference"],
      ratios: ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9", "2:3", "3:2", "auto"],
      durations: Array.from({ length: 16 }, (_, index) => `${index + 1}s`),
      supportsPolling: true,
      supportsCallback: false,
      supportsProviderIdempotency: false,
      acceptsDataUrl: true,
      acceptsPublicUrl: false,
      dryRun: false,
      liveSmoke: true
    },
    validate: validateViduGenerationInput,
    estimateCost() {
      return { credits: options.estimatedCredits ?? 0 };
    },
    async createTask(input) {
      const plan = createViduLiveGenerationPlan(input, options);
      if (!plan.ok || !plan.request) {
        throw new ViduLiveProviderBlockedError("vidu_live_invalid_input", plan.blocker ?? "Invalid Vidu live smoke input.");
      }

      assertLiveSmokeAllowed(options);
      const apiKey = resolveApiKey(options);
      if (!apiKey || !options.transport) {
        throw new ViduLiveProviderBlockedError("vidu_live_not_ready", "Live Vidu smoke is not ready.");
      }

      const data = await options.transport({
        apiBaseUrl: plan.request.apiBaseUrl,
        apiKey,
        method: "POST",
        path: plan.request.path,
        body: plan.request.body
      });
      const result = mapCreateResponse(data);
      taskKinds.set(result.providerTaskId, input.kind);
      return result;
    },
    async getTask(providerTaskId) {
      assertLiveSmokeAllowed(options);
      const apiKey = resolveApiKey(options);
      const kind = taskKinds.get(providerTaskId);
      if (!apiKey || !options.transport) {
        throw new ViduLiveProviderBlockedError("vidu_live_not_ready", "Live Vidu smoke is not ready.");
      }
      if (!kind) {
        throw new ViduLiveProviderBlockedError(
          "vidu_live_missing_task_kind",
          "Live Vidu poll requires task kind from the same controlled smoke process."
        );
      }

      const data = await options.transport({
        apiBaseUrl: apiBaseUrl(options),
        apiKey,
        method: "GET",
        path: taskPath(providerTaskId)
      });
      return mapViduTaskResult({
        providerTaskId,
        kind,
        task: normalizeTaskResponse(providerTaskId, data)
      });
    }
  };
}
