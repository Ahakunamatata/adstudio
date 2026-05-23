import type { GenerationAssetKind, GenerationKind, GenerationSlotInput, GenerationTaskStatus } from "./types";

export type ViduSlotPayload = {
  slotKey: GenerationSlotInput["slotKey"];
  kind: GenerationAssetKind;
  dataUrl?: string;
};

export type ViduGenerateResponse = {
  taskId: string;
  state: string;
  model: string;
  credits?: number;
  createdAt?: string;
};

export type ViduTaskResponse = {
  id: string;
  state: string;
  errCode?: string;
  credits?: number;
  creations: Array<{
    id?: string;
    url?: string;
    coverUrl?: string;
    watermarkedUrl?: string;
  }>;
};

export function isImageOrVideoDataUrl(value: string | undefined) {
  return /^data:(image|video)\//i.test(value ?? "");
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取素材失败")));
    reader.readAsDataURL(blob);
  });
}

function getFetchableAssetUrl(value: string) {
  if (/^(data:|blob:|https?:)/i.test(value)) return value;
  if (typeof window !== "undefined") return new URL(value, window.location.origin).toString();
  return value;
}

function parseAmzDate(value: string | null) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function getSignedUrlExpiry(value: string) {
  try {
    const url = new URL(value);
    const signedAt = parseAmzDate(url.searchParams.get("X-Amz-Date"));
    const expiresInSeconds = Number(url.searchParams.get("X-Amz-Expires"));
    if (!signedAt || !Number.isFinite(expiresInSeconds)) return null;
    return new Date(signedAt + expiresInSeconds * 1000);
  } catch {
    return null;
  }
}

function getAssetReadError(slot: GenerationSlotInput, reason: "expired" | "failed", expiresAt?: Date) {
  const assetName = slot.fileName || slot.label;
  if (reason === "expired") {
    const expiryText = expiresAt
      ? `，有效期至 ${expiresAt.toLocaleString("zh-CN", { hour12: false })}`
      : "";
    return `素材链接已过期：${assetName}${expiryText}。请重新生成该上游节点或重新上传素材。`;
  }

  return `素材读取失败：${assetName}`;
}

export async function slotToViduPayload(slot: GenerationSlotInput): Promise<ViduSlotPayload> {
  if (!slot.previewUrl) {
    return {
      slotKey: slot.slotKey,
      kind: slot.kind
    };
  }

  if (isImageOrVideoDataUrl(slot.previewUrl)) {
    return {
      slotKey: slot.slotKey,
      kind: slot.previewUrl.startsWith("data:video/") ? "video" : "image",
      dataUrl: slot.previewUrl
    };
  }

  const expiresAt = getSignedUrlExpiry(slot.previewUrl);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new Error(getAssetReadError(slot, "expired", expiresAt));
  }

  let response: Response;
  try {
    response = await fetch(getFetchableAssetUrl(slot.previewUrl));
  } catch {
    throw new Error(getAssetReadError(slot, "failed"));
  }

  if (!response.ok) {
    throw new Error(getAssetReadError(slot, "failed"));
  }

  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  return {
    slotKey: slot.slotKey,
    kind: dataUrl.startsWith("data:video/") ? "video" : "image",
    dataUrl
  };
}

export async function buildViduSlotPayloads(slots: GenerationSlotInput[]) {
  return Promise.all(slots.map(slotToViduPayload));
}

export async function readApiError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || `请求失败：${response.status}`;
  } catch {
    return `请求失败：${response.status}`;
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "生成失败，请稍后重试。";
}

export function mapViduState(state: string | undefined): GenerationTaskStatus {
  if (state === "success") return "succeeded";
  if (state === "failed") return "failed";
  if (state === "queueing" || state === "created") return "queued";
  return "running";
}

export function getViduProgress(status: GenerationTaskStatus, startedAt: number) {
  if (status === "succeeded" || status === "failed") return 100;
  if (status === "queued") return 12;
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return Math.min(92, Math.max(18, Math.round(18 + elapsedSeconds * 4)));
}

export function getElapsedLabel(startedAt: number) {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  return `${elapsedSeconds}s`;
}

export function getViduOutput(kind: GenerationKind, task: ViduTaskResponse) {
  const creation = task.creations[0];
  if (!creation) return {};

  if (kind === "video") {
    return {
      assetUrl: creation.coverUrl,
      downloadUrl: creation.url ?? creation.watermarkedUrl
    };
  }

  return {
    assetUrl: creation.url,
    downloadUrl: creation.url ?? creation.watermarkedUrl
  };
}
