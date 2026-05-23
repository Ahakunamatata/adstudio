import type { MediaAssetRecord } from "@/lib/agent-project-store";

export type PersistMediaAssetInput = {
  projectId: string;
  taskId: string;
  assetId: string;
  kind: MediaAssetRecord["kind"];
  sourceUrl: string;
  mimeType?: string;
};

export type PersistMediaAssetResult =
  | {
      ok: true;
      storage: NonNullable<MediaAssetRecord["storage"]> & {
        provider: "supabase_storage" | "vercel_blob" | "local_json";
        key: string;
      };
      byteSize?: number;
      mimeType?: string;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

export type MediaStorageProvider = {
  key: NonNullable<MediaAssetRecord["storage"]>["provider"];
  persist(input: PersistMediaAssetInput): Promise<PersistMediaAssetResult>;
};

