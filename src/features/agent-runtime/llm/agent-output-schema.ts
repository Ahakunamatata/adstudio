import { z } from "zod";
import {
  businessNodeTypeSchema,
  canvasNodeKindSchema,
  canvasNodeSettingsSchema,
  nodeStatusSchema
} from "@/lib/domain/schemas";

function createStableId(prefix: string, value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized) return `${prefix}_${normalized}`;

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function emptyToUndefined(value: unknown) {
  return value === null ? undefined : value;
}

function arrayOrUndefined(value: unknown) {
  if (value === null || typeof value === "undefined") return undefined;
  return Array.isArray(value) ? value : [value];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    return toText(value.id) ?? toText(value.nodeId) ?? toText(value.key) ?? toText(value.name) ?? toText(value.title);
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeSettings(value: unknown) {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && typeof item !== "undefined")
      .map(([key, item]) => [key, typeof item === "string" ? item : String(item)])
  );
}

const businessTypeAliases: Record<string, z.infer<typeof businessNodeTypeSchema>> = {
  product: "product_pack",
  product_pack: "product_pack",
  product_asset: "product_asset",
  competitor: "competitor_asset",
  competitor_asset: "competitor_asset",
  competitor_analysis: "competitor_analysis",
  analysis: "competitor_analysis",
  strategy: "clone_strategy",
  clone_strategy: "clone_strategy",
  creative: "creative_concept",
  creative_concept: "creative_concept",
  script: "ad_script",
  ad_script: "ad_script",
  prompt: "shot_prompt",
  shot_prompt: "shot_prompt",
  character: "character_reference",
  character_reference: "character_reference",
  scene: "scene_reference",
  scene_reference: "scene_reference",
  storyboard: "storyboard_frame",
  storyboard_frame: "storyboard_frame",
  shot_video: "shot_video",
  final_video: "final_video",
  avatar_video: "avatar_video"
};

const kindByBusinessType: Record<z.infer<typeof businessNodeTypeSchema>, z.infer<typeof canvasNodeKindSchema>> = {
  product_pack: "text",
  product_asset: "image",
  competitor_asset: "upload",
  competitor_analysis: "script",
  clone_strategy: "plan",
  creative_concept: "plan",
  ad_script: "script",
  shot_prompt: "prompt",
  character_reference: "image",
  scene_reference: "image",
  storyboard_frame: "image",
  shot_video: "video",
  final_video: "video",
  avatar_video: "video"
};

const businessTypeByKind: Record<z.infer<typeof canvasNodeKindSchema>, z.infer<typeof businessNodeTypeSchema>> = {
  text: "creative_concept",
  image: "product_asset",
  video: "shot_video",
  upload: "product_asset",
  script: "ad_script",
  prompt: "shot_prompt",
  plan: "clone_strategy"
};

function normalizeBusinessType(value: unknown, fallbackKind: z.infer<typeof canvasNodeKindSchema>) {
  const raw = toText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (raw && raw in businessTypeAliases) return businessTypeAliases[raw];
  return businessTypeByKind[fallbackKind];
}

function normalizeNodeStatus(value: unknown) {
  const raw = toText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return raw && nodeStatusSchema.safeParse(raw).success ? raw : undefined;
}

function normalizeNodeKind(
  value: unknown,
  businessTypeValue: unknown,
  titleValue: unknown,
  modelValue: unknown
): z.infer<typeof canvasNodeKindSchema> {
  const raw = toText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (raw) {
    if (canvasNodeKindSchema.safeParse(raw).success) return raw as z.infer<typeof canvasNodeKindSchema>;
    if (raw in businessTypeAliases) return kindByBusinessType[businessTypeAliases[raw]];
    if (raw.includes("video")) return "video";
    if (raw.includes("image") || raw.includes("storyboard") || raw.includes("asset") || raw.includes("icon")) return "image";
    if (raw.includes("script")) return "script";
    if (raw.includes("prompt")) return "prompt";
    if (raw.includes("plan") || raw.includes("strategy")) return "plan";
    if (raw.includes("upload") || raw.includes("file")) return "upload";
  }

  const businessRaw = toText(businessTypeValue)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (businessRaw && businessRaw in businessTypeAliases) return kindByBusinessType[businessTypeAliases[businessRaw]];

  const hint = [toText(titleValue), toText(modelValue)].filter(Boolean).join(" ").toLowerCase();
  if (/video|视频|vidu|seedance/.test(hint)) return "video";
  if (/image|storyboard|icon|ui|asset|图片|分镜图|锚点/.test(hint)) return "image";
  if (/script|脚本/.test(hint)) return "script";
  if (/prompt/.test(hint)) return "prompt";
  if (/plan|strategy|方案/.test(hint)) return "plan";
  return "text";
}

function normalizePosition(value: unknown) {
  if (!isRecord(value)) return undefined;
  const x = toNumber(value.x);
  const y = toNumber(value.y);
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

function normalizeActionType(value: unknown) {
  const raw = toText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    create_node: "createNode",
    add_node: "createNode",
    update_node_content: "updateNodeContent",
    set_node_content: "updateNodeContent",
    update_node_settings: "updateNodeSettings",
    update_node: "updateNodeSettings",
    connect_nodes: "connectNodes",
    add_edge: "connectNodes",
    disconnect_nodes: "disconnectNodes",
    remove_edge: "disconnectNodes",
    run_node_generation: "runNodeGeneration",
    generate_node: "runNodeGeneration",
    append_node_version: "appendNodeVersion",
    add_node_version: "appendNodeVersion",
    fail_node_generation: "failNodeGeneration",
    set_primary_version: "setPrimaryVersion",
    lock_node: "lockNode",
    mark_node_stale: "markNodeStale",
    open_node_detail: "openNodeDetail"
  };
  return raw ? aliases[raw] ?? value : value;
}

function normalizeCreateNodeInput(action: UnknownRecord) {
  const rawInput = isRecord(action.input)
    ? action.input
    : isRecord(action.node)
      ? action.node
      : isRecord(action.payload)
        ? action.payload
        : {};
  const kind = normalizeNodeKind(rawInput.kind ?? action.kind ?? rawInput.type, rawInput.businessType ?? action.businessType, rawInput.title ?? action.title, rawInput.model ?? action.model);
  const businessType = normalizeBusinessType(rawInput.businessType ?? action.businessType, kind);
  const title =
    toText(rawInput.title) ??
    toText(action.title) ??
    toText(rawInput.name) ??
    `${businessType} 节点`;
  const output = toText(rawInput.output) ?? toText(rawInput.content) ?? toText(rawInput.summary) ?? toText(action.output) ?? toText(action.content);
  const input = toText(rawInput.input) ?? toText(rawInput.prompt) ?? toText(action.inputText) ?? toText(action.prompt);

  return {
    id: toText(rawInput.id) ?? toText(action.id) ?? toText(action.nodeId),
    kind,
    businessType,
    sourceNodeId: toText(rawInput.sourceNodeId) ?? toText(rawInput.source),
    position: normalizePosition(rawInput.position),
    title,
    input,
    output,
    model: toText(rawInput.model) ?? toText(action.model),
    status: normalizeNodeStatus(rawInput.status),
    locked: typeof rawInput.locked === "boolean" ? rawInput.locked : undefined,
    previewClass: toText(rawInput.previewClass),
    settings: normalizeSettings(rawInput.settings ?? action.settings)
  };
}

function normalizeCanvasAction(value: unknown) {
  if (!isRecord(value)) return value;
  const type = normalizeActionType(value.type ?? value.action);
  const nodeId = toText(value.nodeId) ?? toText(value.id) ?? toText(value.node);

  if (type === "createNode") {
    return { type, input: normalizeCreateNodeInput(value) };
  }

  if (type === "updateNodeContent") {
    return {
      type,
      nodeId,
      output: toText(value.output) ?? toText(value.content) ?? toText(value.text) ?? ""
    };
  }

  if (type === "updateNodeSettings") {
    return {
      type,
      nodeId,
      title: toText(value.title) ?? nodeId ?? "节点",
      output: toText(value.output) ?? toText(value.content) ?? toText(value.summary) ?? "",
      model: toText(value.model) ?? "Ad Studio Agent",
      settings: normalizeSettings(value.settings)
    };
  }

  if (type === "connectNodes") {
    return {
      type,
      source: toText(value.source) ?? toText(value.sourceNodeId) ?? "",
      target: toText(value.target) ?? toText(value.targetNodeId) ?? ""
    };
  }

  if (type === "disconnectNodes") return { type, edgeId: toText(value.edgeId) ?? toText(value.id) ?? "" };
  if (type === "runNodeGeneration") return { type, nodeId, content: toText(value.content), delayMs: toNumber(value.delayMs) };
  if (type === "appendNodeVersion") return { type, nodeId, content: toText(value.content), result: value.result };
  if (type === "failNodeGeneration") return { type, nodeId, errorMessage: toText(value.errorMessage) ?? toText(value.error) ?? "生成失败" };
  if (type === "setPrimaryVersion") return { type, nodeId, versionId: toText(value.versionId) ?? toText(value.primaryVersionId) ?? "" };
  if (type === "lockNode") return { type, nodeId, locked: typeof value.locked === "boolean" ? value.locked : undefined };
  if (type === "markNodeStale") return { type, nodeId, reason: toText(value.reason) };
  if (type === "openNodeDetail") return { type, nodeId };

  return value;
}

function normalizeCanvasActions(value: unknown) {
  if (value === null || typeof value === "undefined") return undefined;
  return (Array.isArray(value) ? value : [value]).map(normalizeCanvasAction);
}

export const agentQuestionOptionSchema = z
  .preprocess(
    (value) => {
      if (typeof value === "string") return { label: value };
      return value;
    },
    z.object({
      id: z.string().optional(),
      label: z.string(),
      description: z.string().optional()
    })
  )
  .transform((option) => ({
    id: option.id?.trim() || createStableId("option", option.label),
    label: option.label,
    description: option.description
  }));

const agentQuestionFieldTypeSchema = z.preprocess((value) => {
  if (value === "select" || value === "single_select" || value === "choice") return "radio";
  if (value === "segmented" || value === "segmented_choice") return "radio";
  if (value === "multi_select" || value === "multiselect") return "checkbox";
  if (value === "long_text") return "textarea";
  if (value === "file" || value === "asset" || value === "media" || value === "media_upload") return "upload";
  if (value === "product" || value === "product_pack") return "product_asset";
  return value;
}, z.enum(["radio", "checkbox", "text", "textarea", "upload", "product_asset", "confirmation"]));

export const agentQuestionFieldSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    type: agentQuestionFieldTypeSchema.optional().default("text"),
    display: z.enum(["segmented"]).optional(),
    required: z.boolean().optional(),
    help: z.string().optional(),
    placeholder: z.string().optional(),
    options: z.preprocess(emptyToUndefined, z.array(agentQuestionOptionSchema).optional()),
    maxSelections: z.number().int().positive().optional(),
    accept: z.string().optional(),
    multiple: z.boolean().optional(),
    uploadRole: z.enum(["product_pack", "competitor_asset", "reference_asset"]).optional(),
    requiredGroup: z.string().optional(),
    requiredGroupLabel: z.string().optional()
  })
  .passthrough()
  .transform((field) => {
    const label = field.label || field.id || "补充信息";
    return {
      id: field.id?.trim() || createStableId("field", label),
      label,
      type: field.type,
      display: field.display,
      required: field.required,
      help: field.help,
      placeholder: field.placeholder,
      options: field.options,
      maxSelections: field.maxSelections,
      accept: field.accept,
      multiple: field.multiple,
      uploadRole: field.uploadRole,
      requiredGroup: field.requiredGroup,
      requiredGroupLabel: field.requiredGroupLabel
    };
  });

export const agentQuestionFormSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    question: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    fields: z.preprocess(emptyToUndefined, z.array(agentQuestionFieldSchema).optional()),
    submitLabel: z.string().optional()
  })
  .passthrough()
  .transform((form) => {
    const title = form.title || form.question || form.label || "需要补充的信息";
    return {
      id: form.id?.trim() || createStableId("question", title),
      title,
      description: form.description,
      fields:
        form.fields?.length
          ? form.fields
          : [
              {
                id: createStableId("field", title),
                label: title,
                type: "text" as const,
                required: true
              }
            ],
      submitLabel: form.submitLabel
    };
  });

export const agentConfirmationDraftSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    bullets: z.preprocess(arrayOrUndefined, z.array(z.string()).optional()),
    confirmLabel: z.string().optional(),
    secondaryLabel: z.string().optional()
  })
  .passthrough()
  .transform((confirmation) => {
    const title = confirmation.title || "执行方案确认";
    return {
      id: confirmation.id?.trim() || createStableId("confirm", title),
      title,
      summary: confirmation.summary || "请确认是否按当前方案继续执行。",
      bullets: confirmation.bullets ?? [],
      confirmLabel: confirmation.confirmLabel || "确认执行",
      secondaryLabel: confirmation.secondaryLabel
    };
  });

const canvasCreateNodeInputSchema = z.object({
  id: z.string().optional(),
  kind: canvasNodeKindSchema,
  businessType: businessNodeTypeSchema.optional(),
  sourceNodeId: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  title: z.string().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
  model: z.string().optional(),
  status: z.preprocess(emptyToUndefined, nodeStatusSchema.optional()),
  locked: z.boolean().optional(),
  previewClass: z.string().optional(),
  settings: z.preprocess(emptyToUndefined, canvasNodeSettingsSchema.optional())
});

const generationSlotKeySchema = z.enum([
  "reference_image",
  "reference_video",
  "start_frame",
  "end_frame",
  "product_image",
  "person_image",
  "style_reference"
]);

const canvasGenerationSlotInputSchema = z.object({
  id: z.string(),
  slotKey: generationSlotKeySchema,
  kind: z.enum(["image", "video"]),
  label: z.string(),
  fileName: z.string(),
  previewUrl: z.string().optional(),
  status: z.enum(["uploaded", "referenced"])
});

const canvasGenerationResultSchema = z.object({
  content: z.string(),
  assetUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
  providerTaskId: z.string().optional(),
  model: z.string().optional(),
  time: z.string().optional(),
  cost: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  slots: z.array(canvasGenerationSlotInputSchema).optional()
});

const agentGenerationRequestSchema = z
  .object({
    nodeId: z.string().optional(),
    nodeVersionId: z.string().optional(),
    artifactId: z.string().optional(),
    kind: z.enum(["image", "video"]).optional().default("video"),
    modelId: z.string().optional(),
    modelName: z.string().optional(),
    modeKey: z.string().optional(),
    prompt: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    slots: z.array(canvasGenerationSlotInputSchema).optional()
  })
  .passthrough()
  .transform((generation) => {
    const kind = generation.kind;
    const baseParams: Record<string, string> = kind === "video"
      ? { ratio: "9:16", duration: "5s", resolution: "720p" }
      : { ratio: "1:1" };
    return {
      nodeId: generation.nodeId,
      nodeVersionId: generation.nodeVersionId,
      artifactId: generation.artifactId,
      kind,
      surface: "agent" as const,
      modelId: generation.modelId?.trim() || (kind === "video" ? "viduq3-turbo" : "viduq2"),
      modelName: generation.modelName?.trim() || (kind === "video" ? "Vidu Q3 Turbo" : "Vidu Q2 Image"),
      modeKey: generation.modeKey?.trim() || (kind === "video" ? "text-to-video" : "text-to-image"),
      prompt: generation.prompt.trim(),
      params: {
        ...baseParams,
        ...(generation.params ?? {})
      },
      slots: generation.slots ?? []
    };
  });

export const canvasRuntimeActionDraftSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createNode"), input: canvasCreateNodeInputSchema }),
  z.object({ type: z.literal("updateNodeContent"), nodeId: z.string(), output: z.string() }),
  z.object({
    type: z.literal("updateNodeSettings"),
    nodeId: z.string(),
    title: z.string(),
    output: z.string(),
    model: z.string(),
    settings: z.preprocess(emptyToUndefined, canvasNodeSettingsSchema.optional())
  }),
  z.object({ type: z.literal("connectNodes"), source: z.string(), target: z.string() }),
  z.object({ type: z.literal("disconnectNodes"), edgeId: z.string() }),
  z.object({
    type: z.literal("runNodeGeneration"),
    nodeId: z.string(),
    content: z.string().optional(),
    delayMs: z.number().optional()
  }),
  z.object({
    type: z.literal("appendNodeVersion"),
    nodeId: z.string(),
    content: z.string().optional(),
    result: canvasGenerationResultSchema.optional()
  }),
  z.object({ type: z.literal("failNodeGeneration"), nodeId: z.string(), errorMessage: z.string() }),
  z.object({ type: z.literal("setPrimaryVersion"), nodeId: z.string(), versionId: z.string() }),
  z.object({ type: z.literal("lockNode"), nodeId: z.string(), locked: z.boolean().optional() }),
  z.object({ type: z.literal("markNodeStale"), nodeId: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("openNodeDetail"), nodeId: z.string() })
]);

export const llmAgentOutputSchema = z.object({
  message: z.preprocess(
    (value) => (typeof value === "string" ? value : "我已理解当前需求，正在整理下一步。"),
    z.string()
  ),
  questions: z.preprocess(arrayOrUndefined, z.array(agentQuestionFormSchema).optional()),
  confirmation: z.preprocess(emptyToUndefined, agentConfirmationDraftSchema.optional()),
  generation: z.preprocess(emptyToUndefined, agentGenerationRequestSchema.optional()),
  canvasActions: z.preprocess(normalizeCanvasActions, z.array(canvasRuntimeActionDraftSchema).optional()),
  briefPatch: z
    .preprocess(emptyToUndefined, z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional())
    .transform((patch) => {
      if (!patch) return undefined;
      return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, String(value)]));
    })
    .optional(),
  safetyNotes: z
    .preprocess((value) => {
      if (value === null || typeof value === "undefined") return undefined;
      return typeof value === "string" ? [value] : value;
    }, z.array(z.string()).optional())
    .optional()
});

export type LlmAgentOutput = z.infer<typeof llmAgentOutputSchema>;
