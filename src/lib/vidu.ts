import type {
  GenerationAssetKind,
  GenerationKind,
  GenerationModeKey,
  GenerationParamValue,
  GenerationSlotKey
} from "@/features/generation/types";

const DEFAULT_VIDU_API_BASE_URL = "https://api.vidu.cn/ent/v2";
const Q3_FAST_VIDEO_MODEL = "viduq3-turbo";
const Q2_IMAGE_MODEL = "viduq2";

const supportedTextVideoRatios = new Set(["16:9", "9:16", "3:4", "4:3", "1:1"]);
const supportedReferenceVideoRatios = new Set(["16:9", "9:16", "1:1"]);
const supportedImageRatios = new Set(["16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2", "auto"]);
const supportedVideoResolutions = new Set(["540p", "720p", "1080p"]);
const supportedImageResolutions = new Set(["1080p", "2K", "4K"]);

const viduImageModels = new Set(["viduq2", "viduq1"]);
const viduVideoModels = new Set([
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
const generationModeKeys = new Set<GenerationModeKey>([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference",
  "text-to-image",
  "image-reference"
]);
const generationSlotKeys = new Set<GenerationSlotKey>([
  "reference_image",
  "reference_video",
  "start_frame",
  "end_frame",
  "product_image",
  "person_image",
  "style_reference"
]);

export type ViduSlotPayload = {
  slotKey: GenerationSlotKey;
  kind: GenerationAssetKind;
  dataUrl?: string;
};

export type ViduCreateInput = {
  kind: GenerationKind;
  modeKey: GenerationModeKey;
  modelId: string;
  prompt: string;
  params: Record<string, GenerationParamValue>;
  slots: ViduSlotPayload[];
};

export type ViduCreateResult = {
  taskId: string;
  state: string;
  model: string;
  credits?: number;
  createdAt?: string;
};

export type ViduCreation = {
  id?: string;
  url?: string;
  coverUrl?: string;
  watermarkedUrl?: string;
};

export type ViduTaskResult = {
  id: string;
  state: string;
  errCode?: string;
  credits?: number;
  payload?: string;
  creations: ViduCreation[];
};

type ViduCreateRequest = {
  path: string;
  model: string;
  body: Record<string, unknown>;
};

export class ViduApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "ViduApiError";
    this.status = status;
    this.details = details;
  }
}

function getViduApiKey() {
  const apiKey = process.env.VIDU_API_KEY?.trim();
  if (!apiKey) {
    throw new ViduApiError("缺少 VIDU_API_KEY，请先在 .env.local 中配置 Vidu API key。", 500);
  }
  return apiKey;
}

function getViduApiBaseUrl() {
  return (process.env.VIDU_API_BASE_URL?.trim() || DEFAULT_VIDU_API_BASE_URL).replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isParamValue(value: unknown): value is GenerationParamValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function readViduMessage(data: unknown, fallback: string) {
  const record = asRecord(data);
  return getString(record, "message") ?? getString(record, "error") ?? getString(record, "err_msg") ?? fallback;
}

async function viduFetch(path: string, init: RequestInit) {
  const response = await fetch(`${getViduApiBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Token ${getViduApiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new ViduApiError(readViduMessage(data, `Vidu API 请求失败：${response.status}`), response.status, data);
  }

  return data;
}

function paramString(params: Record<string, GenerationParamValue>, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function durationParam(params: Record<string, GenerationParamValue>, min: number, max: number) {
  const raw = params.duration;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/s$/i, "")) : undefined;
  return clamp(Number.isFinite(parsed) ? Number(parsed) : 5, min, max);
}

function seedParam(params: Record<string, GenerationParamValue>) {
  const seed = paramNumber(params, "seed");
  if (!seed || seed < 0) return undefined;
  return Math.round(seed);
}

function normalizeRatio(value: string | undefined, supported: Set<string>, fallback: string) {
  if (value && supported.has(value)) return value;
  if (value === "4:5" && supported.has("3:4")) return "3:4";
  return fallback;
}

function normalizeVideoResolution(params: Record<string, GenerationParamValue>) {
  const value = paramString(params, "quality") ?? paramString(params, "resolution");
  return value && supportedVideoResolutions.has(value) ? value : "720p";
}

function normalizeImageResolution(params: Record<string, GenerationParamValue>) {
  const value = paramString(params, "resolution");
  return value && supportedImageResolutions.has(value) ? value : "1080p";
}

function isImageDataUrl(value: string | undefined): value is string {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value ?? "");
}

function imageInputs(slots: ViduSlotPayload[]) {
  return slots.flatMap((slot) => (isImageDataUrl(slot.dataUrl) ? [slot.dataUrl] : [])).slice(0, 7);
}

function orderedStartEndImages(slots: ViduSlotPayload[]) {
  const startFrame = slots.find((slot) => slot.slotKey === "start_frame" && isImageDataUrl(slot.dataUrl));
  const endFrame = slots.find((slot) => slot.slotKey === "end_frame" && isImageDataUrl(slot.dataUrl));
  const ordered = [startFrame?.dataUrl, endFrame?.dataUrl].filter(Boolean) as string[];
  if (ordered.length === 2) return ordered;
  return imageInputs(slots).slice(0, 2);
}

function firstImageInput(slots: ViduSlotPayload[]) {
  const preferred = ["start_frame", "product_image", "reference_image", "person_image", "style_reference"];
  for (const slotKey of preferred) {
    const slot = slots.find((item) => item.slotKey === slotKey && isImageDataUrl(item.dataUrl));
    if (slot?.dataUrl) return slot.dataUrl;
  }
  return imageInputs(slots)[0];
}

function normalizeViduVideoModel(modelId: string) {
  return viduVideoModels.has(modelId) ? modelId : Q3_FAST_VIDEO_MODEL;
}

function normalizeViduImageModel(modelId: string) {
  return viduImageModels.has(modelId) ? modelId : Q2_IMAGE_MODEL;
}

function createPayload(kind: GenerationKind, modeKey: GenerationModeKey) {
  return JSON.stringify({
    source: "ad-studio",
    kind,
    mode: modeKey
  });
}

function normalizeCreateInput(input: unknown): ViduCreateInput {
  const record = asRecord(input);
  const kindValue = record.kind;
  if (kindValue !== "video" && kindValue !== "image") {
    throw new ViduApiError("生成类型无效。", 400);
  }

  const rawModeKey = getString(record, "modeKey");
  const fallbackModeKey: GenerationModeKey = kindValue === "image" ? "text-to-image" : "text-to-video";
  const modeKey = rawModeKey && generationModeKeys.has(rawModeKey as GenerationModeKey) ? (rawModeKey as GenerationModeKey) : fallbackModeKey;
  const paramsRecord = asRecord(record.params);
  const params: Record<string, GenerationParamValue> = {};

  for (const [key, value] of Object.entries(paramsRecord)) {
    if (isParamValue(value)) {
      params[key] = value;
    }
  }

  const slots = Array.isArray(record.slots)
    ? record.slots.flatMap((item) => {
        const slot = asRecord(item);
        const slotKey = getString(slot, "slotKey");
        if (!slotKey || !generationSlotKeys.has(slotKey as GenerationSlotKey)) return [];
        const assetKind: GenerationAssetKind = slot.kind === "video" ? "video" : "image";

        return [
          {
            slotKey: slotKey as GenerationSlotKey,
            kind: assetKind,
            dataUrl: getString(slot, "dataUrl")
          }
        ];
      })
    : [];

  return {
    kind: kindValue,
    modeKey,
    modelId: getString(record, "modelId") ?? (kindValue === "image" ? Q2_IMAGE_MODEL : Q3_FAST_VIDEO_MODEL),
    prompt: getString(record, "prompt") ?? "",
    params,
    slots
  };
}

function buildVideoRequest(input: ViduCreateInput): ViduCreateRequest {
  const model = normalizeViduVideoModel(input.modelId);
  const resolution = normalizeVideoResolution(input.params);
  const seed = seedParam(input.params);
  const baseBody = {
    model,
    prompt: input.prompt,
    seed,
    resolution,
    audio: false,
    off_peak: false,
    watermark: false,
    payload: createPayload(input.kind, input.modeKey)
  };

  if (input.modeKey === "first-last-frame") {
    const images = orderedStartEndImages(input.slots);
    if (images.length < 2) {
      throw new ViduApiError("首尾帧生视频至少需要 2 张可用图片。", 400);
    }
    return {
      path: "/start-end2video",
      model,
      body: {
        ...baseBody,
        images,
        duration: durationParam(input.params, 1, 16)
      }
    };
  }

  if (input.modeKey === "image-to-video") {
    const image = firstImageInput(input.slots);
    if (!image) {
      throw new ViduApiError("图生视频至少需要 1 张可用图片。", 400);
    }
    return {
      path: "/img2video",
      model,
      body: {
        ...baseBody,
        images: [image],
        duration: durationParam(input.params, 1, 16)
      }
    };
  }

  const images = imageInputs(input.slots);
  if (input.modeKey === "reference" || images.length > 0) {
    if (!images.length) {
      throw new ViduApiError("参考生视频至少需要 1 张可用图片；当前 Q3 快速模型暂不接视频参考。", 400);
    }
    return {
      path: "/reference2video",
      model,
      body: {
        ...baseBody,
        images,
        duration: durationParam(input.params, 3, 16),
        aspect_ratio: normalizeRatio(paramString(input.params, "ratio"), supportedReferenceVideoRatios, "16:9")
      }
    };
  }

  return {
    path: "/text2video",
    model,
    body: {
      ...baseBody,
      duration: durationParam(input.params, 1, 16),
      aspect_ratio: normalizeRatio(paramString(input.params, "ratio"), supportedTextVideoRatios, "16:9")
    }
  };
}

function buildImageRequest(input: ViduCreateInput): ViduCreateRequest {
  const model = normalizeViduImageModel(input.modelId);
  const images = imageInputs(input.slots);

  return {
    path: "/reference2image",
    model,
    body: {
      model,
      images: images.length ? images : undefined,
      prompt: input.prompt,
      seed: seedParam(input.params),
      aspect_ratio: normalizeRatio(paramString(input.params, "ratio"), supportedImageRatios, "16:9"),
      resolution: model === "viduq1" ? "1080p" : normalizeImageResolution(input.params),
      payload: createPayload(input.kind, input.modeKey)
    }
  };
}

function buildCreateRequest(input: ViduCreateInput) {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new ViduApiError("Prompt 不能为空。", 400);
  }

  const normalizedInput = {
    ...input,
    prompt
  };

  return input.kind === "image" ? buildImageRequest(normalizedInput) : buildVideoRequest(normalizedInput);
}

export async function createViduGeneration(input: unknown): Promise<ViduCreateResult> {
  const request = buildCreateRequest(normalizeCreateInput(input));
  const data = await viduFetch(request.path, {
    method: "POST",
    body: JSON.stringify(request.body)
  });
  const record = asRecord(data);
  const taskId = getString(record, "task_id");

  if (!taskId) {
    throw new ViduApiError("Vidu 创建任务成功但未返回 task_id。", 502, data);
  }

  return {
    taskId,
    state: getString(record, "state") ?? "created",
    model: getString(record, "model") ?? request.model,
    credits: getNumber(record, "credits"),
    createdAt: getString(record, "created_at")
  };
}

function normalizeCreations(value: unknown): ViduCreation[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: getString(record, "id"),
      url: getString(record, "url"),
      coverUrl: getString(record, "cover_url"),
      watermarkedUrl: getString(record, "watermarked_url")
    };
  });
}

export async function getViduTask(taskId: string): Promise<ViduTaskResult> {
  const id = taskId.trim();
  if (!id) {
    throw new ViduApiError("缺少 Vidu task id。", 400);
  }

  const data = await viduFetch(`/tasks/${encodeURIComponent(id)}/creations`, {
    method: "GET"
  });
  const record = asRecord(data);

  return {
    id: getString(record, "id") ?? id,
    state: getString(record, "state") ?? "created",
    errCode: getString(record, "err_code"),
    credits: getNumber(record, "credits"),
    payload: getString(record, "payload"),
    creations: normalizeCreations(record.creations)
  };
}
