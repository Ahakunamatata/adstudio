import {
  buildViduGenerationPayload,
  createViduDryRunMediaGenerationProvider,
  mapViduProviderStatus,
  mapViduTaskOutput,
  mapViduTaskResult,
  normalizeViduProviderError,
  validateViduGenerationInput
} from "./vidu-generation-provider";
import type { MediaGenerationInput } from "./generation-provider";

const sampleImageDataUrl = "data:image/png;base64,aW1hZ2U=";
const sampleProjectId = "project-m51-vidu-dry-run";
const sampleApprovalRequestId = "approval-m51-vidu";
const sampleIdempotencyKey = "m51:project-m51-vidu-dry-run:vidu";

const baseVideoInput: MediaGenerationInput = {
  projectId: sampleProjectId,
  sessionId: "session-m51-vidu",
  approvalRequestId: sampleApprovalRequestId,
  idempotencyKey: sampleIdempotencyKey,
  kind: "video",
  surface: "agent",
  modelId: "viduq3-turbo",
  modelName: "Vidu Q3 Turbo",
  modeKey: "text-to-video",
  prompt: "Create a short mobile-first app ad with a clear hook.",
  params: {
    ratio: "9:16",
    duration: "5s"
  },
  slots: []
};

const referenceImageSlot = {
  id: "slot-reference-image",
  slotKey: "reference_image",
  kind: "image",
  label: "Reference image",
  fileName: "reference.png",
  previewUrl: sampleImageDataUrl,
  status: "uploaded"
} as const;

const startFrameSlot = {
  ...referenceImageSlot,
  id: "slot-start-frame",
  slotKey: "start_frame",
  label: "Start frame",
  fileName: "start.png"
} as const;

const endFrameSlot = {
  ...referenceImageSlot,
  id: "slot-end-frame",
  slotKey: "end_frame",
  label: "End frame",
  fileName: "end.png",
  previewUrl: "data:image/png;base64,ZW5k"
} as const;

function assertTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function bodyArray(value: unknown): unknown[] {
  assertTrue(Array.isArray(value), "expected array body field");
  return value;
}

export async function typecheckM51ViduDryRunProvider() {
  const noPrompt = validateViduGenerationInput({
    ...baseVideoInput,
    prompt: "   "
  });
  assertTrue(!noPrompt.ok && noPrompt.errorCode === "vidu_empty_prompt", "missing prompt must be rejected");

  const missingImage = validateViduGenerationInput({
    ...baseVideoInput,
    modeKey: "image-to-video"
  });
  assertTrue(!missingImage.ok && missingImage.errorCode === "vidu_missing_image", "image-to-video must require an image");

  const oneFrameOnly = validateViduGenerationInput({
    ...baseVideoInput,
    modeKey: "first-last-frame",
    slots: [startFrameSlot]
  });
  assertTrue(!oneFrameOnly.ok && oneFrameOnly.errorCode === "vidu_missing_image", "first-last-frame must require two images");

  const unsupportedRatio = validateViduGenerationInput({
    ...baseVideoInput,
    params: {
      ratio: "4:5",
      duration: "5s"
    }
  });
  assertTrue(!unsupportedRatio.ok && unsupportedRatio.errorCode === "vidu_unsupported_ratio", "unsupported video ratio must be rejected");

  const unsupportedDuration = validateViduGenerationInput({
    ...baseVideoInput,
    modeKey: "reference",
    slots: [referenceImageSlot],
    params: {
      ratio: "9:16",
      duration: "2s"
    }
  });
  assertTrue(!unsupportedDuration.ok && unsupportedDuration.errorCode === "vidu_unsupported_duration", "reference video duration must honor lower bound");

  const unsupportedModel = validateViduGenerationInput({
    ...baseVideoInput,
    modelId: "vidu-unknown"
  });
  assertTrue(!unsupportedModel.ok && unsupportedModel.errorCode === "vidu_unsupported_model", "unsupported Vidu model must be rejected");

  const imageDuration = validateViduGenerationInput({
    ...baseVideoInput,
    kind: "image",
    modelId: "viduq2",
    modelName: "Vidu Q2 Image",
    modeKey: "text-to-image",
    params: {
      ratio: "1:1",
      duration: "5s"
    }
  });
  assertTrue(!imageDuration.ok && imageDuration.errorCode === "vidu_duration_not_supported", "image generation must reject duration");

  const textPayload = buildViduGenerationPayload(baseVideoInput);
  assertTrue(textPayload.path === "/text2video", "text-to-video payload must use text2video path");
  assertTrue(textPayload.model === "viduq3-turbo", "text-to-video payload must keep selected model");
  assertTrue(textPayload.body.aspect_ratio === "9:16", "text-to-video payload must map ratio");
  assertTrue(textPayload.body.duration === 5, "text-to-video payload must map duration");

  const firstLastPayload = buildViduGenerationPayload({
    ...baseVideoInput,
    modeKey: "first-last-frame",
    slots: [endFrameSlot, startFrameSlot]
  });
  const firstLastImages = bodyArray(firstLastPayload.body.images);
  assertTrue(firstLastPayload.path === "/start-end2video", "first-last-frame payload must use start-end2video path");
  assertTrue(firstLastImages[0] === startFrameSlot.previewUrl, "start frame must be first image");
  assertTrue(firstLastImages[1] === endFrameSlot.previewUrl, "end frame must be second image");

  const imagePayload = buildViduGenerationPayload({
    ...baseVideoInput,
    kind: "image",
    modelId: "viduq2",
    modelName: "Vidu Q2 Image",
    modeKey: "image-reference",
    params: {
      ratio: "1:1",
      resolution: "2K"
    },
    slots: [referenceImageSlot]
  });
  assertTrue(imagePayload.path === "/reference2image", "image payload must use reference2image path");
  assertTrue(imagePayload.body.aspect_ratio === "1:1", "image payload must map ratio");
  assertTrue(imagePayload.body.resolution === "2K", "image payload must map resolution");

  assertTrue(mapViduProviderStatus("created") === "queued", "created state must map to queued");
  assertTrue(mapViduProviderStatus("queueing") === "queued", "queueing state must map to queued");
  assertTrue(mapViduProviderStatus("processing") === "running", "processing state must map to running");
  assertTrue(mapViduProviderStatus("success") === "succeeded", "success state must map to succeeded");
  assertTrue(mapViduProviderStatus("failed") === "failed", "failed state must map to failed");

  assertTrue(normalizeViduProviderError({ status: 429, message: "too many requests" }).errorCode === "vidu_rate_limited", "rate limit error must map");
  assertTrue(normalizeViduProviderError({ status: 402, message: "insufficient credits" }).errorCode === "vidu_insufficient_credits", "credit error must map");
  assertTrue(normalizeViduProviderError({ err_code: "content_policy", message: "sensitive content" }).errorCode === "vidu_content_policy", "content error must map");
  assertTrue(normalizeViduProviderError({ status: 408, message: "timeout" }).errorCode === "vidu_timeout", "timeout error must map");

  const videoOutput = mapViduTaskOutput("video", {
    id: "vidu-task-video",
    state: "success",
    creations: [
      {
        url: "https://cdn.example.com/video.mp4",
        coverUrl: "https://cdn.example.com/cover.png",
        watermarkedUrl: "https://cdn.example.com/watermarked.mp4"
      }
    ]
  });
  assertTrue(videoOutput?.assetUrl === "https://cdn.example.com/cover.png", "video assetUrl must prefer cover URL");
  assertTrue(videoOutput?.downloadUrl === "https://cdn.example.com/video.mp4", "video downloadUrl must map provider URL");

  const imageOutput = mapViduTaskOutput("image", {
    id: "vidu-task-image",
    state: "success",
    creations: [
      {
        url: "https://cdn.example.com/image.png",
        watermarkedUrl: "https://cdn.example.com/watermarked.png"
      }
    ]
  });
  assertTrue(imageOutput?.assetUrl === "https://cdn.example.com/image.png", "image assetUrl must map provider URL");

  const succeededTask = mapViduTaskResult({
    providerTaskId: "vidu-provider-task",
    kind: "video",
    task: {
      id: "vidu-provider-task",
      state: "success",
      credits: 12,
      creations: [
        {
          url: "https://cdn.example.com/video.mp4",
          cover_url: "https://cdn.example.com/cover.png"
        }
      ]
    }
  });
  assertTrue(succeededTask.status === "succeeded", "task result must map success status");
  assertTrue(succeededTask.output?.downloadUrl === "https://cdn.example.com/video.mp4", "task result must map output URL");

  const failedTask = mapViduTaskResult({
    providerTaskId: "vidu-provider-task-failed",
    kind: "video",
    task: {
      id: "vidu-provider-task-failed",
      state: "failed",
      errCode: "balance_not_enough",
      creations: []
    }
  });
  assertTrue(failedTask.status === "failed", "task result must map failed status");
  assertTrue(failedTask.errorCode === "vidu_insufficient_credits", "task result must map failed error");

  const provider = createViduDryRunMediaGenerationProvider();
  const dryRunCreated = await provider.createTask(baseVideoInput);
  const dryRunCached = await provider.getTask(dryRunCreated.providerTaskId);
  assertTrue(dryRunCreated.status === "queued", "dry-run create must return queued");
  assertTrue(dryRunCached.providerTaskId === dryRunCreated.providerTaskId, "dry-run getTask must return cached task");
  assertTrue(provider.createTaskCallCount === 1, "dry-run provider createTask count must stay local");
  assertTrue(provider.getTaskCallCount === 1, "dry-run provider getTask count must stay local");

  return {
    noPromptBlocked: !noPrompt.ok,
    missingImageBlocked: !missingImage.ok,
    unsupportedRatioBlocked: !unsupportedRatio.ok,
    unsupportedDurationBlocked: !unsupportedDuration.ok,
    unsupportedModelBlocked: !unsupportedModel.ok,
    textPayloadPath: textPayload.path,
    firstLastPayloadPath: firstLastPayload.path,
    imagePayloadPath: imagePayload.path,
    succeededStatus: succeededTask.status,
    failedErrorCode: failedTask.errorCode,
    dryRunStatus: dryRunCreated.status,
    dryRunProviderCalls: provider.createTaskCallCount + provider.getTaskCallCount,
    realProviderCalls: 0,
    viduGenerateCalls: 0
  };
}
