import type {
  GenerationKind,
  GenerationModeKey,
  GenerationParamValue,
  GenerationSlotInput
} from "@/features/generation/types";
import type {
  MediaGenerationCreateResult,
  MediaGenerationInput,
  MediaGenerationOutput,
  MediaGenerationProvider,
  MediaGenerationProviderStatus,
  MediaGenerationValidationResult
} from "./generation-provider";

export type ViduCreatePath =
  | "/text2video"
  | "/img2video"
  | "/start-end2video"
  | "/reference2video"
  | "/reference2image";

export type ViduDryRunCreateRequest = {
  path: ViduCreatePath;
  model: string;
  body: Record<string, unknown>;
};

export type ViduCreationLike = {
  id?: string;
  url?: string;
  coverUrl?: string;
  cover_url?: string;
  watermarkedUrl?: string;
  watermarked_url?: string;
};

export type ViduTaskLike = {
  id?: string;
  state?: string;
  errCode?: string;
  err_code?: string;
  credits?: number;
  progress?: number;
  creations?: ViduCreationLike[];
};

export type ViduProviderError = {
  errorCode: string;
  errorMessage: string;
  providerCode?: string;
};

export type ViduDryRunMediaGenerationProvider = MediaGenerationProvider & {
  readonly createTaskCallCount: number;
  readonly getTaskCallCount: number;
};

const videoModelIds = new Set([
  "viduq3-turbo",
  "viduq3-pro",
  "viduq3-pro-fast",
  "viduq3",
  "viduq3-mix",
  "viduq2",
  "viduq2-pro",
  "viduq2-pro-fast",
  "viduq2-turbo",
  "viduq1",
  "vidu2.0"
]);

const imageModelIds = new Set(["viduq2", "viduq1"]);
const videoModeKeys = new Set<GenerationModeKey>(["text-to-video", "image-to-video", "first-last-frame", "reference"]);
const imageModeKeys = new Set<GenerationModeKey>(["text-to-image", "image-reference"]);
const textVideoRatios = new Set(["16:9", "9:16", "3:4", "4:3", "1:1"]);
const referenceVideoRatios = new Set(["16:9", "9:16", "1:1"]);
const imageRatios = new Set(["16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2", "auto"]);
const imageResolutions = new Set(["1080p", "2K", "4K"]);
const videoResolutions = new Set(["540p", "720p", "1080p"]);
const slotKeysByPriority: GenerationSlotInput["slotKey"][] = [
  "start_frame",
  "product_image",
  "reference_image",
  "person_image",
  "style_reference"
];

class ViduDryRunValidationError extends Error {
  errorCode: string;

  constructor(errorCode: string, errorMessage: string) {
    super(errorMessage);
    this.name = "ViduDryRunValidationError";
    this.errorCode = errorCode;
  }
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function paramString(params: Record<string, GenerationParamValue>, key: string) {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function paramNumber(params: Record<string, GenerationParamValue>, key: string) {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function seedParam(params: Record<string, GenerationParamValue>) {
  const seed = paramNumber(params, "seed");
  if (seed === undefined || seed < 0) return undefined;
  return Math.round(seed);
}

function imageResolutionParam(params: Record<string, GenerationParamValue>) {
  const resolution = paramString(params, "resolution");
  return resolution && imageResolutions.has(resolution) ? resolution : "1080p";
}

function videoResolutionParam(params: Record<string, GenerationParamValue>) {
  const resolution = paramString(params, "quality") ?? paramString(params, "resolution");
  return resolution && videoResolutions.has(resolution) ? resolution : "720p";
}

function durationSeconds(params: Record<string, GenerationParamValue>) {
  const raw = params.duration;
  if (raw === undefined) return undefined;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/s$/i, "")) : NaN;
  return Number.isFinite(value) ? Math.round(value) : NaN;
}

function isImageDataUrl(value: string | undefined): value is string {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value ?? "");
}

function imageInputs(slots: readonly GenerationSlotInput[]) {
  return slots.flatMap((slot) => (slot.kind === "image" && isImageDataUrl(slot.previewUrl) ? [slot.previewUrl] : [])).slice(0, 7);
}

function orderedStartEndImages(slots: readonly GenerationSlotInput[]) {
  const startFrame = slots.find((slot) => slot.slotKey === "start_frame" && slot.kind === "image" && isImageDataUrl(slot.previewUrl));
  const endFrame = slots.find((slot) => slot.slotKey === "end_frame" && slot.kind === "image" && isImageDataUrl(slot.previewUrl));
  const ordered = [startFrame?.previewUrl, endFrame?.previewUrl].filter(Boolean) as string[];
  return ordered.length === 2 ? ordered : imageInputs(slots).slice(0, 2);
}

function firstImageInput(slots: readonly GenerationSlotInput[]) {
  for (const slotKey of slotKeysByPriority) {
    const slot = slots.find((item) => item.slotKey === slotKey && item.kind === "image" && isImageDataUrl(item.previewUrl));
    if (slot?.previewUrl) return slot.previewUrl;
  }
  return imageInputs(slots)[0];
}

function createPayload(input: MediaGenerationInput) {
  return JSON.stringify({
    source: "ad-studio-agent",
    kind: input.kind,
    mode: input.modeKey,
    projectId: input.projectId,
    approvalRequestId: input.approvalRequestId,
    idempotencyKey: input.idempotencyKey
  });
}

function compactBody(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function createProviderTaskId(input: MediaGenerationInput) {
  return `vidu-dry-run-${hashString(`${input.projectId}:${input.idempotencyKey}:${input.modelId}:${input.prompt}`)}`;
}

function isGenerationModeKey(value: string): value is GenerationModeKey {
  return videoModeKeys.has(value as GenerationModeKey) || imageModeKeys.has(value as GenerationModeKey);
}

function modeKey(input: MediaGenerationInput): GenerationModeKey | undefined {
  return isGenerationModeKey(input.modeKey) ? input.modeKey : undefined;
}

function invalid(errorCode: string, errorMessage: string): MediaGenerationValidationResult {
  return { ok: false, errorCode, errorMessage };
}

function throwValidation(validation: MediaGenerationValidationResult): asserts validation is { ok: true } {
  if (!validation.ok) throw new ViduDryRunValidationError(validation.errorCode, validation.errorMessage);
}

function validateMode(input: MediaGenerationInput, mode: GenerationModeKey) {
  if (input.kind === "video" && !videoModeKeys.has(mode)) {
    return invalid("vidu_invalid_mode", `Vidu video generation does not support mode: ${input.modeKey}.`);
  }
  if (input.kind === "image" && !imageModeKeys.has(mode)) {
    return invalid("vidu_invalid_mode", `Vidu image generation does not support mode: ${input.modeKey}.`);
  }
  return { ok: true } as const;
}

function validateModel(input: MediaGenerationInput) {
  const supported = input.kind === "image" ? imageModelIds : videoModelIds;
  if (!supported.has(input.modelId)) {
    return invalid("vidu_unsupported_model", `Vidu ${input.kind} generation does not support model: ${input.modelId}.`);
  }
  return { ok: true } as const;
}

function ratioSupport(input: MediaGenerationInput, mode: GenerationModeKey) {
  if (input.kind === "image") return imageRatios;
  if (mode === "text-to-video") return textVideoRatios;
  if (mode === "reference") return referenceVideoRatios;
  return undefined;
}

function validateRatio(input: MediaGenerationInput, mode: GenerationModeKey) {
  const ratio = paramString(input.params, "ratio");
  const supported = ratioSupport(input, mode);
  if (ratio && supported && !supported.has(ratio)) {
    return invalid("vidu_unsupported_ratio", `Vidu ${mode} does not support ratio: ${ratio}.`);
  }
  return { ok: true } as const;
}

function validateDuration(input: MediaGenerationInput, mode: GenerationModeKey) {
  const duration = durationSeconds(input.params);
  if (input.kind === "image") {
    if (duration !== undefined) {
      return invalid("vidu_duration_not_supported", "Vidu image generation does not support duration.");
    }
    return { ok: true } as const;
  }
  if (Number.isNaN(duration)) return invalid("vidu_invalid_duration", "Vidu duration must be a number of seconds.");
  const min = mode === "reference" ? 3 : 1;
  const max = 16;
  if (duration !== undefined && (duration < min || duration > max)) {
    return invalid("vidu_unsupported_duration", `Vidu ${mode} duration must be between ${min}s and ${max}s.`);
  }
  return { ok: true } as const;
}

function validateSlots(input: MediaGenerationInput, mode: GenerationModeKey) {
  const images = imageInputs(input.slots);
  const hasVideoSlot = input.slots.some((slot) => slot.kind === "video");
  if (mode === "first-last-frame" && images.length < 2) {
    return invalid("vidu_missing_image", "Vidu first-last-frame generation requires two image inputs.");
  }
  if (mode === "image-to-video" && images.length < 1) {
    return invalid("vidu_missing_image", "Vidu image-to-video generation requires one image input.");
  }
  if (mode === "reference" && images.length < 1) {
    return invalid(
      "vidu_missing_image",
      hasVideoSlot
        ? "Vidu dry-run reference video generation currently requires image inputs; video reference slots are not supported."
        : "Vidu reference video generation requires at least one image input."
    );
  }
  if (mode === "image-reference" && images.length < 1) {
    return invalid("vidu_missing_image", "Vidu image-reference generation requires at least one image input.");
  }
  return { ok: true } as const;
}

export function validateViduGenerationInput(input: MediaGenerationInput): MediaGenerationValidationResult {
  if (input.kind !== "image" && input.kind !== "video") {
    return invalid("vidu_invalid_kind", "Vidu generation only supports image or video.");
  }
  if (!input.prompt.trim()) {
    return invalid("vidu_empty_prompt", "Prompt is required for Vidu generation.");
  }

  const mode = modeKey(input);
  if (!mode) return invalid("vidu_invalid_mode", `Vidu does not support mode: ${input.modeKey}.`);

  const validators = [
    validateMode(input, mode),
    validateModel(input),
    validateRatio(input, mode),
    validateDuration(input, mode),
    validateSlots(input, mode)
  ];
  return validators.find((result) => !result.ok) ?? { ok: true };
}

export function buildViduGenerationPayload(input: MediaGenerationInput): ViduDryRunCreateRequest {
  throwValidation(validateViduGenerationInput(input));
  const mode = modeKey(input);
  if (!mode) throw new ViduDryRunValidationError("vidu_invalid_mode", `Vidu does not support mode: ${input.modeKey}.`);
  const prompt = input.prompt.trim();

  if (input.kind === "image") {
    const images = imageInputs(input.slots);
    const model = input.modelId;
    return {
      path: "/reference2image",
      model,
      body: compactBody({
        model,
        images: images.length ? images : undefined,
        prompt,
        seed: seedParam(input.params),
        aspect_ratio: paramString(input.params, "ratio") ?? "16:9",
        resolution: model === "viduq1" ? "1080p" : imageResolutionParam(input.params),
        payload: createPayload(input)
      })
    };
  }

  const model = input.modelId;
  const baseBody = {
    model,
    prompt,
    seed: seedParam(input.params),
    resolution: videoResolutionParam(input.params),
    audio: false,
    off_peak: false,
    watermark: false,
    payload: createPayload(input)
  };
  const duration = durationSeconds(input.params) ?? 5;

  if (mode === "first-last-frame") {
    return {
      path: "/start-end2video",
      model,
      body: compactBody({
        ...baseBody,
        images: orderedStartEndImages(input.slots),
        duration
      })
    };
  }

  if (mode === "image-to-video") {
    return {
      path: "/img2video",
      model,
      body: compactBody({
        ...baseBody,
        images: [firstImageInput(input.slots)],
        duration
      })
    };
  }

  if (mode === "reference") {
    return {
      path: "/reference2video",
      model,
      body: compactBody({
        ...baseBody,
        images: imageInputs(input.slots),
        duration,
        aspect_ratio: paramString(input.params, "ratio") ?? "16:9"
      })
    };
  }

  return {
    path: "/text2video",
    model,
    body: compactBody({
      ...baseBody,
      duration,
      aspect_ratio: paramString(input.params, "ratio") ?? "16:9"
    })
  };
}

export function mapViduProviderStatus(state: string | undefined): MediaGenerationProviderStatus {
  if (state === "success") return "succeeded";
  if (state === "failed") return "failed";
  if (state === "cancelled" || state === "canceled") return "cancelled";
  if (state === "created" || state === "queueing") return "queued";
  return "running";
}

export function normalizeViduProviderError(error: unknown): ViduProviderError {
  const record = isRecord(error) ? error : {};
  const providerCode = getString(record, "errCode") ?? getString(record, "err_code") ?? getString(record, "code");
  const providerMessage =
    getString(record, "message") ?? getString(record, "error") ?? getString(record, "err_msg") ?? (typeof error === "string" ? error : undefined);
  const status = getNumber(record, "status") ?? getNumber(record, "statusCode");
  const haystack = `${providerCode ?? ""} ${providerMessage ?? ""}`.toLowerCase();

  if (status === 429 || /rate|too many/.test(haystack)) {
    return {
      errorCode: "vidu_rate_limited",
      errorMessage: "Vidu rate limit reached. Retry later.",
      providerCode
    };
  }
  if (status === 408 || /timeout|timed out/.test(haystack)) {
    return {
      errorCode: "vidu_timeout",
      errorMessage: "Vidu request timed out. Retry status check before creating a new task.",
      providerCode
    };
  }
  if (status === 401 || status === 403 || /auth|token|permission/.test(haystack)) {
    return {
      errorCode: "vidu_auth_error",
      errorMessage: "Vidu authentication failed.",
      providerCode
    };
  }
  if (status === 402 || /credit|balance|quota|insufficient/.test(haystack)) {
    return {
      errorCode: "vidu_insufficient_credits",
      errorMessage: "Vidu account does not have enough credits.",
      providerCode
    };
  }
  if (/safety|sensitive|policy|content/.test(haystack)) {
    return {
      errorCode: "vidu_content_policy",
      errorMessage: "Vidu rejected the request for content policy reasons.",
      providerCode
    };
  }
  if (status && status >= 400 && status < 500) {
    return {
      errorCode: "vidu_invalid_request",
      errorMessage: providerMessage ?? "Vidu rejected the request parameters.",
      providerCode
    };
  }

  return {
    errorCode: "vidu_provider_error",
    errorMessage: providerMessage ?? "Vidu provider error.",
    providerCode
  };
}

function creationValue(creation: ViduCreationLike, camelKey: "coverUrl" | "watermarkedUrl", snakeKey: "cover_url" | "watermarked_url") {
  return creation[camelKey] ?? creation[snakeKey];
}

export function mapViduTaskOutput(kind: GenerationKind, task: ViduTaskLike): MediaGenerationOutput | undefined {
  const creation = task.creations?.[0];
  if (!creation) return undefined;
  const watermarkedUrl = creationValue(creation, "watermarkedUrl", "watermarked_url");

  if (kind === "video") {
    const coverUrl = creationValue(creation, "coverUrl", "cover_url");
    const videoUrl = creation.url ?? watermarkedUrl;
    if (!coverUrl && !videoUrl) return undefined;
    return {
      kind: "video",
      title: "Vidu video output",
      assetUrl: coverUrl ?? videoUrl,
      downloadUrl: videoUrl,
      mimeType: "video/mp4"
    };
  }

  const imageUrl = creation.url ?? watermarkedUrl;
  if (!imageUrl) return undefined;
  return {
    kind: "image",
    title: "Vidu image output",
    assetUrl: imageUrl,
    downloadUrl: imageUrl,
    mimeType: "image/png"
  };
}

export function mapViduTaskResult(input: {
  providerTaskId: string;
  kind: GenerationKind;
  task: ViduTaskLike;
}): MediaGenerationCreateResult {
  const status = mapViduProviderStatus(input.task.state);
  const normalizedError = status === "failed" ? normalizeViduProviderError(input.task) : undefined;
  return {
    providerTaskId: input.providerTaskId,
    status,
    progress: input.task.progress ?? (status === "succeeded" || status === "failed" || status === "cancelled" ? 100 : status === "queued" ? 12 : 50),
    credits: input.task.credits,
    output: status === "succeeded" ? mapViduTaskOutput(input.kind, input.task) : undefined,
    errorCode: normalizedError?.errorCode,
    errorMessage: normalizedError?.errorMessage,
    raw: input.task
  };
}

export function createViduDryRunMediaGenerationProvider(): ViduDryRunMediaGenerationProvider {
  let createTaskCallCount = 0;
  let getTaskCallCount = 0;
  const tasks = new Map<string, MediaGenerationCreateResult>();

  return {
    key: "vidu",
    displayName: "Vidu Dry-run Media Generation Provider",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-image", "image-reference", "text-to-video", "image-to-video", "first-last-frame", "reference"],
      ratios: Array.from(new Set([...textVideoRatios, ...referenceVideoRatios, ...imageRatios])),
      durations: Array.from({ length: 16 }, (_, index) => `${index + 1}s`),
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
    validate: validateViduGenerationInput,
    estimateCost() {
      return { credits: 0 };
    },
    async createTask(input) {
      createTaskCallCount += 1;
      const providerTaskId = createProviderTaskId(input);
      const validation = validateViduGenerationInput(input);
      if (!validation.ok) {
        const failed: MediaGenerationCreateResult = {
          providerTaskId,
          status: "failed",
          progress: 100,
          credits: 0,
          errorCode: validation.errorCode,
          errorMessage: validation.errorMessage,
          raw: { dryRun: true }
        };
        tasks.set(providerTaskId, failed);
        return failed;
      }

      const request = buildViduGenerationPayload(input);
      const result: MediaGenerationCreateResult = {
        providerTaskId,
        status: "queued",
        progress: 0,
        credits: 0,
        raw: {
          dryRun: true,
          request
        }
      };
      tasks.set(providerTaskId, result);
      return result;
    },
    async getTask(providerTaskId) {
      getTaskCallCount += 1;
      return tasks.get(providerTaskId) ?? {
        providerTaskId,
        status: "failed",
        progress: 100,
        credits: 0,
        errorCode: "vidu_dry_run_task_not_found",
        errorMessage: `Vidu dry-run task not found: ${providerTaskId}`,
        raw: { dryRun: true }
      };
    }
  };
}

export const viduDryRunMediaGenerationProvider = createViduDryRunMediaGenerationProvider();
