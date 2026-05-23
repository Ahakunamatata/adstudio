import type { GenerationParamValue, GenerationSlotInput } from "@/features/generation/types";

export type MediaGenerationProviderKey = "mock" | "vidu";
export type MediaGenerationProviderStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type MediaGenerationInput = {
  projectId: string;
  sessionId?: string;
  approvalRequestId: string;
  idempotencyKey: string;
  kind: "image" | "video";
  surface: "standalone" | "canvas" | "agent";
  modelId: string;
  modelName: string;
  modeKey: string;
  prompt: string;
  params: Record<string, GenerationParamValue>;
  slots: GenerationSlotInput[];
};

export type MediaGenerationOutput = {
  kind: "image" | "video";
  title: string;
  assetUrl?: string;
  downloadUrl?: string;
  ratio?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type MediaGenerationCreateResult = {
  providerTaskId: string;
  status: MediaGenerationProviderStatus;
  progress?: number;
  credits?: number;
  costUsd?: number;
  output?: MediaGenerationOutput;
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
};

export type MediaGenerationValidationResult =
  | { ok: true }
  | { ok: false; errorCode: string; errorMessage: string };

export type MediaGenerationProvider = {
  key: MediaGenerationProviderKey;
  displayName: string;
  capabilities: {
    kinds: Array<"image" | "video">;
    modes: string[];
    ratios: string[];
    durations?: string[];
    supportsPolling: boolean;
    supportsCallback: boolean;
    supportsProviderIdempotency: boolean;
    acceptsDataUrl: boolean;
    acceptsPublicUrl: boolean;
    dryRun?: boolean;
    liveSmoke?: boolean;
  };
  validate(input: MediaGenerationInput): MediaGenerationValidationResult;
  estimateCost(input: MediaGenerationInput): { credits: number; costUsd?: number };
  createTask(input: MediaGenerationInput): Promise<MediaGenerationCreateResult>;
  getTask(providerTaskId: string): Promise<MediaGenerationCreateResult>;
};
