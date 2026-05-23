import type {
  MediaGenerationCreateResult,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaGenerationProviderStatus
} from "./generation-provider";

export type MockMediaGenerationProviderOptions = {
  outcome?: Extract<MediaGenerationProviderStatus, "succeeded" | "failed">;
  errorCode?: string;
  errorMessage?: string;
};

export type MockMediaGenerationProvider = MediaGenerationProvider & {
  readonly createTaskCallCount: number;
  readonly getTaskCallCount: number;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createProviderTaskId(input: MediaGenerationInput) {
  return `mock-provider-${hashString(`${input.projectId}:${input.idempotencyKey}:${input.prompt}`)}`;
}

function createMockResult(input: MediaGenerationInput, options: MockMediaGenerationProviderOptions): MediaGenerationCreateResult {
  const providerTaskId = createProviderTaskId(input);
  const outcome = options.outcome ?? "succeeded";
  if (outcome === "failed") {
    return {
      providerTaskId,
      status: "failed",
      progress: 100,
      credits: 0,
      errorCode: options.errorCode ?? "mock_generation_failed",
      errorMessage: options.errorMessage ?? "Mock provider intentionally failed."
    };
  }

  const extension = input.kind === "video" ? "mp4" : "png";
  const mimeType = input.kind === "video" ? "video/mp4" : "image/png";
  const ratio = typeof input.params.ratio === "string" ? input.params.ratio : undefined;

  return {
    providerTaskId,
    status: "succeeded",
    progress: 100,
    credits: 0,
    output: {
      kind: input.kind,
      title: input.kind === "video" ? "Mock video output" : "Mock image output",
      assetUrl: `https://mock.ad-studio.local/assets/${providerTaskId}.${extension}`,
      downloadUrl: `https://mock.ad-studio.local/download/${providerTaskId}.${extension}`,
      ratio,
      mimeType,
      width: input.kind === "video" ? 1080 : 1024,
      height: input.kind === "video" ? 1920 : 1024,
      durationMs: input.kind === "video" ? 5000 : undefined
    }
  };
}

export function createMockMediaGenerationProvider(
  options: MockMediaGenerationProviderOptions = {}
): MockMediaGenerationProvider {
  let createTaskCallCount = 0;
  let getTaskCallCount = 0;
  const tasks = new Map<string, MediaGenerationCreateResult>();

  return {
    key: "mock",
    displayName: "Mock Media Generation Provider",
    capabilities: {
      kinds: ["image", "video"],
      modes: ["text-to-image", "image-reference", "text-to-video", "image-to-video", "first-last-frame", "reference"],
      ratios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
      durations: ["5s", "6s", "10s", "15s"],
      supportsPolling: true,
      supportsCallback: false,
      supportsProviderIdempotency: true,
      acceptsDataUrl: true,
      acceptsPublicUrl: true
    },
    get createTaskCallCount() {
      return createTaskCallCount;
    },
    get getTaskCallCount() {
      return getTaskCallCount;
    },
    validate(input) {
      if (input.kind !== "image" && input.kind !== "video") {
        return {
          ok: false,
          errorCode: "mock_invalid_kind",
          errorMessage: "Mock provider only supports image or video generation."
        };
      }
      if (!input.prompt.trim()) {
        return {
          ok: false,
          errorCode: "mock_empty_prompt",
          errorMessage: "Prompt is required for mock generation."
        };
      }
      return { ok: true };
    },
    estimateCost() {
      return { credits: 0 };
    },
    async createTask(input) {
      createTaskCallCount += 1;
      const result = createMockResult(input, options);
      tasks.set(result.providerTaskId, result);
      return result;
    },
    async getTask(providerTaskId) {
      getTaskCallCount += 1;
      return tasks.get(providerTaskId) ?? {
        providerTaskId,
        status: "failed",
        progress: 100,
        credits: 0,
        errorCode: "mock_task_not_found",
        errorMessage: `Mock task not found: ${providerTaskId}`
      };
    }
  };
}

export const mockMediaGenerationProvider = createMockMediaGenerationProvider();
