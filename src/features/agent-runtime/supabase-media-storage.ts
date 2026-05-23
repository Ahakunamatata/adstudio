import type { MediaStorageProvider, PersistMediaAssetInput, PersistMediaAssetResult } from "./media-storage-provider";

const DEFAULT_BUCKET = "ad-studio-media";

type SupabaseMediaStorageEnv = Record<string, string | undefined> & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_MEDIA_BUCKET?: string;
};

type FetchLike = typeof fetch;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function encodeStoragePath(path: string) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function outputExtension(input: PersistMediaAssetInput) {
  if (input.kind === "video") return "mp4";
  if (input.kind === "image") return "png";
  return "bin";
}

function outputContentType(input: PersistMediaAssetInput, fallback?: string | null) {
  if (input.mimeType) return input.mimeType;
  if (fallback) return fallback;
  if (input.kind === "video") return "video/mp4";
  if (input.kind === "image") return "image/png";
  return "application/octet-stream";
}

function createOutputKey(input: PersistMediaAssetInput) {
  return `projects/${input.projectId}/generations/${input.taskId}/output.${outputExtension(input)}`;
}

async function responseMessage(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return `${response.status} ${response.statusText}`;
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object") {
      const message = (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    return text.trim();
  }
  return text.trim();
}

export function createSupabaseMediaStorageProvider(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket?: string;
  fetchImpl?: FetchLike;
}): MediaStorageProvider {
  const supabaseUrl = trimTrailingSlash(options.supabaseUrl);
  const serviceRoleKey = options.serviceRoleKey;
  const bucket = options.bucket?.trim() || DEFAULT_BUCKET;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    key: "supabase_storage",
    async persist(input): Promise<PersistMediaAssetResult> {
      const downloadResponse = await fetchImpl(input.sourceUrl, { cache: "no-store" });
      if (!downloadResponse.ok) {
        return {
          ok: false,
          errorCode: "media_download_failed",
          errorMessage: `Provider output download failed: ${await responseMessage(downloadResponse)}`
        };
      }

      const bytes = Buffer.from(await downloadResponse.arrayBuffer());
      const contentType = outputContentType(input, downloadResponse.headers.get("content-type"));
      const key = createOutputKey(input);
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(key)}`;
      const uploadResponse = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": contentType,
          "x-upsert": "true"
        },
        body: bytes
      });

      if (!uploadResponse.ok) {
        return {
          ok: false,
          errorCode: "supabase_storage_upload_failed",
          errorMessage: `Supabase Storage upload failed: ${await responseMessage(uploadResponse)}`
        };
      }

      return {
        ok: true,
        storage: {
          provider: "supabase_storage",
          key,
          publicUrl: `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(key)}`
        },
        byteSize: bytes.byteLength,
        mimeType: contentType
      };
    }
  };
}

export function createSupabaseMediaStorageProviderFromEnv(
  env: SupabaseMediaStorageEnv = process.env
): MediaStorageProvider | undefined {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) return undefined;
  return createSupabaseMediaStorageProvider({
    supabaseUrl,
    serviceRoleKey,
    bucket: env.SUPABASE_MEDIA_BUCKET
  });
}
