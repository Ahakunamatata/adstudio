import { z } from "zod";

export const artifactSourceSchema = z.enum(["fact", "model_suggestion", "user_confirmation", "mixed"]);
export const artifactStatusSchema = z.enum([
  "draft",
  "pending_user",
  "confirmed",
  "rejected",
  "stale",
  "needs_repair"
]);

export const artifactConfirmationStateSchema = z.enum([
  "not_required",
  "needs_confirmation",
  "confirmed",
  "rejected"
]);

export const artifactEvidenceRefSchema = z.object({
  kind: z.enum(["asset", "canvas_node", "message", "artifact", "external"]),
  refId: z.string(),
  note: z.string().optional()
});

export const artifactUserConfirmationSchema = z.object({
  state: artifactConfirmationStateSchema,
  confirmedBy: z.enum(["user", "agent", "system"]).optional(),
  confirmedAt: z.string().optional(),
  requiredFields: z.array(z.string()).optional(),
  notes: z.string().optional()
});

const baseArtifactSchema = z.object({
  id: z.string(),
  source: artifactSourceSchema,
  status: artifactStatusSchema,
  evidenceRefs: z.array(artifactEvidenceRefSchema).optional(),
  userConfirmation: artifactUserConfirmationSchema.optional()
});

export const referenceAnalysisSchema = baseArtifactSchema.extend({
  summary: z.string(),
  mediaType: z.enum(["image", "video", "mixed", "unknown"]),
  adCategory: z.string().optional(),
  hook: z.string().optional(),
  narrativeStructure: z.array(z.string()).optional(),
  sceneRhythm: z.string().optional(),
  sellingPoints: z.array(z.string()).optional(),
  visualStyle: z.string().optional(),
  targetAudience: z.string().optional(),
  cta: z.string().optional(),
  sourceAssetIds: z.array(z.string()),
  shotIds: z.array(z.string()).optional(),
  anchorCandidates: z.array(z.string()).optional(),
  generationRisks: z.array(z.string()).optional(),
  followUpQuestions: z.array(z.string()).optional(),
  modelSuggestions: z.array(z.string()).optional()
});

export const creativePlanSchema = baseArtifactSchema.extend({
  title: z.string(),
  objective: z.string(),
  referenceMode: z.string().optional(),
  subjectFocus: z.string().optional(),
  channel: z.string().optional(),
  language: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.string().optional(),
  keyMessage: z.string().optional(),
  doList: z.array(z.string()).optional(),
  dontList: z.array(z.string()).optional(),
  requiredAnchors: z.array(z.string()).optional(),
  sourceArtifactIds: z.array(z.string()).optional()
});

export const anchorSchema = baseArtifactSchema.extend({
  kind: z.enum(["brand_asset", "product_ui", "character", "scene", "prop", "voice", "subtitle", "style"]),
  label: z.string(),
  description: z.string(),
  priority: z.enum(["blocking", "important", "optional"]),
  assetRefs: z.array(z.string()).optional(),
  canvasNodeIds: z.array(z.string()).optional(),
  appliesTo: z.array(z.string()).optional(),
  consistencyRules: z.array(z.string()).optional(),
  riskNotes: z.array(z.string()).optional()
});

export const anchorRegistrySchema = baseArtifactSchema.extend({
  anchors: z.array(anchorSchema)
});

export const scriptSceneSchema = baseArtifactSchema.extend({
  index: z.number().int().positive(),
  timeRange: z.string(),
  purpose: z.string(),
  visual: z.string(),
  narration: z.string().optional(),
  onScreenText: z.string().optional(),
  productMoment: z.string().optional(),
  anchors: z.array(z.string()).optional(),
  riskNotes: z.array(z.string()).optional()
});

export const scriptDocSchema = baseArtifactSchema.extend({
  title: z.string(),
  language: z.string(),
  duration: z.string(),
  scenes: z.array(scriptSceneSchema),
  sourceArtifactIds: z.array(z.string()).optional()
});

export const clipRowSchema = baseArtifactSchema.extend({
  shotId: z.string(),
  index: z.number().int().positive(),
  timeRange: z.string(),
  framePromptId: z.string().optional(),
  videoPromptId: z.string().optional(),
  requiredAnchorIds: z.array(z.string()).optional(),
  canvasNodeIds: z.array(z.string()).optional(),
  acceptanceChecks: z.array(z.string()).optional()
});

export const clipTableSchema = baseArtifactSchema.extend({
  clips: z.array(clipRowSchema)
});

export const promptArtifactSchema = baseArtifactSchema.extend({
  target: z.enum(["storyboard_image", "shot_video", "final_assembly", "repair", "subtitle"]),
  shotId: z.string().optional(),
  modelFamily: z.enum(["text", "image", "video", "assembly"]),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  requiredAnchorIds: z.array(z.string()).optional(),
  selfContained: z.boolean(),
  variables: z.record(z.string(), z.string()).optional()
});

export const promptPackSchema = baseArtifactSchema.extend({
  prompts: z.array(promptArtifactSchema)
});

export const workflowStepSchema = baseArtifactSchema.extend({
  label: z.string(),
  intent: z.string(),
  dependsOn: z.array(z.string()),
  requiredConfirmation: z.boolean(),
  targetArtifactIds: z.array(z.string()).optional(),
  targetCanvasNodeIds: z.array(z.string()).optional()
});

export const workflowPlanSchema = baseArtifactSchema.extend({
  title: z.string(),
  steps: z.array(workflowStepSchema),
  nextConfirmation: z.string().optional()
});

export const repairPlanSchema = baseArtifactSchema.extend({
  issue: z.string(),
  suspectedCause: z.string(),
  scope: z.enum(["single_node", "partial", "full_chain"]),
  affectedArtifactIds: z.array(z.string()).optional(),
  affectedCanvasNodeIds: z.array(z.string()).optional(),
  proposedActions: z.array(z.string()),
  requiredConfirmation: z.boolean()
});

export const agentArtifactsSchema = z.object({
  schemaVersion: z.literal(1),
  referenceAnalysis: referenceAnalysisSchema.optional(),
  creativePlan: creativePlanSchema.optional(),
  anchorRegistry: anchorRegistrySchema.optional(),
  scriptDoc: scriptDocSchema.optional(),
  clipTable: clipTableSchema.optional(),
  promptPack: promptPackSchema.optional(),
  workflowPlan: workflowPlanSchema.optional(),
  repairPlan: repairPlanSchema.optional(),
  updatedAt: z.string().optional()
});

export const artifactSummarySchema = z.object({
  kind: z.enum([
    "referenceAnalysis",
    "creativePlan",
    "anchorRegistry",
    "scriptDoc",
    "clipTable",
    "promptPack",
    "workflowPlan",
    "repairPlan"
  ]),
  id: z.string(),
  source: artifactSourceSchema,
  status: artifactStatusSchema,
  title: z.string().optional(),
  summary: z.string(),
  factRefs: z.array(z.string()),
  modelSuggestionRefs: z.array(z.string()),
  needsUserConfirmation: z.boolean(),
  userConfirmationFields: z.array(z.string()).optional()
});

export const agentArtifactSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  available: z.boolean(),
  updatedAt: z.string().optional(),
  summaries: z.array(artifactSummarySchema),
  pendingConfirmationArtifactIds: z.array(z.string()),
  confirmedFactArtifactIds: z.array(z.string()),
  modelSuggestionArtifactIds: z.array(z.string())
});

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;
export type ArtifactUserConfirmation = z.infer<typeof artifactUserConfirmationSchema>;
export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>;
export type CreativePlan = z.infer<typeof creativePlanSchema>;
export type Anchor = z.infer<typeof anchorSchema>;
export type AnchorRegistry = z.infer<typeof anchorRegistrySchema>;
export type ScriptDoc = z.infer<typeof scriptDocSchema>;
export type ClipTable = z.infer<typeof clipTableSchema>;
export type PromptPack = z.infer<typeof promptPackSchema>;
export type WorkflowPlan = z.infer<typeof workflowPlanSchema>;
export type RepairPlan = z.infer<typeof repairPlanSchema>;
export type AgentArtifacts = z.infer<typeof agentArtifactsSchema>;
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;
export type AgentArtifactSnapshot = z.infer<typeof agentArtifactSnapshotSchema>;

function compactText(value: string | undefined, fallback = "未提供摘要") {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function isPendingConfirmation(artifact: { status: ArtifactStatus; userConfirmation?: ArtifactUserConfirmation }) {
  return artifact.status === "pending_user" || artifact.userConfirmation?.state === "needs_confirmation";
}

function collectSummaryRefs(artifact: {
  id: string;
  source: ArtifactSource;
  evidenceRefs?: Array<{ refId: string }>;
}) {
  const explicitRefs = artifact.evidenceRefs?.map((ref) => ref.refId) ?? [];
  const ownRef = artifact.id;

  return {
    factRefs: artifact.source === "fact" || artifact.source === "mixed" ? [ownRef, ...explicitRefs] : explicitRefs,
    modelSuggestionRefs: artifact.source === "model_suggestion" || artifact.source === "mixed" ? [ownRef] : []
  };
}

function createArtifactSummary(input: {
  kind: ArtifactSummary["kind"];
  artifact: {
    id: string;
    source: ArtifactSource;
    status: ArtifactStatus;
    userConfirmation?: ArtifactUserConfirmation;
    evidenceRefs?: Array<{ refId: string }>;
  };
  title?: string;
  summary: string | undefined;
}): ArtifactSummary {
  const refs = collectSummaryRefs(input.artifact);
  const userConfirmationFields = input.artifact.userConfirmation?.requiredFields;

  return {
    kind: input.kind,
    id: input.artifact.id,
    source: input.artifact.source,
    status: input.artifact.status,
    title: input.title,
    summary: compactText(input.summary),
    factRefs: refs.factRefs,
    modelSuggestionRefs: refs.modelSuggestionRefs,
    needsUserConfirmation: isPendingConfirmation(input.artifact),
    userConfirmationFields: userConfirmationFields?.length ? userConfirmationFields : undefined
  };
}

function summarizeReferenceAnalysis(artifact: ReferenceAnalysis) {
  return [
    artifact.summary,
    artifact.hook ? `Hook: ${artifact.hook}` : "",
    artifact.sellingPoints?.length ? `卖点: ${artifact.sellingPoints.slice(0, 4).join(" / ")}` : "",
    artifact.generationRisks?.length ? `风险: ${artifact.generationRisks.slice(0, 3).join(" / ")}` : ""
  ].filter(Boolean).join("；");
}

function summarizeCreativePlan(artifact: CreativePlan) {
  return [
    artifact.objective,
    artifact.referenceMode ? `参考程度: ${artifact.referenceMode}` : "",
    artifact.subjectFocus ? `主体: ${artifact.subjectFocus}` : "",
    artifact.requiredAnchors?.length ? `锚点: ${artifact.requiredAnchors.slice(0, 5).join(" / ")}` : ""
  ].filter(Boolean).join("；");
}

function summarizeAnchorRegistry(artifact: AnchorRegistry) {
  const blockingAnchors = artifact.anchors.filter((anchor) => anchor.priority === "blocking");
  const pendingAnchors = artifact.anchors.filter(isPendingConfirmation);

  return [
    `${artifact.anchors.length} 个锚点`,
    blockingAnchors.length ? `阻塞锚点: ${blockingAnchors.map((anchor) => anchor.label).slice(0, 4).join(" / ")}` : "",
    pendingAnchors.length ? `待确认: ${pendingAnchors.map((anchor) => anchor.label).slice(0, 4).join(" / ")}` : ""
  ].filter(Boolean).join("；");
}

function summarizeScriptDoc(artifact: ScriptDoc) {
  return [
    `${artifact.scenes.length} 个镜头 / ${artifact.duration} / ${artifact.language}`,
    artifact.scenes.length
      ? `镜头: ${artifact.scenes
          .slice(0, 4)
          .map((scene) => `${scene.timeRange} ${scene.purpose}`)
          .join(" / ")}`
      : ""
  ].filter(Boolean).join("；");
}

function summarizeClipTable(artifact: ClipTable) {
  return `${artifact.clips.length} 个 clips；节点引用: ${artifact.clips
    .flatMap((clip) => clip.canvasNodeIds ?? [])
    .slice(0, 6)
    .join(" / ") || "未绑定"}`;
}

function summarizePromptPack(artifact: PromptPack) {
  const nonSelfContained = artifact.prompts.filter((prompt) => !prompt.selfContained);
  return [
    `${artifact.prompts.length} 条 prompts`,
    nonSelfContained.length ? `${nonSelfContained.length} 条不是自包含` : "全部声明自包含",
    `targets: ${Array.from(new Set(artifact.prompts.map((prompt) => prompt.target))).join(" / ")}`
  ].join("；");
}

function summarizeWorkflowPlan(artifact: WorkflowPlan) {
  const pendingSteps = artifact.steps.filter((step) => step.requiredConfirmation || isPendingConfirmation(step));
  return [
    `${artifact.steps.length} 个步骤`,
    pendingSteps.length ? `待确认步骤: ${pendingSteps.map((step) => step.label).slice(0, 4).join(" / ")}` : "",
    artifact.nextConfirmation ? `下一确认: ${artifact.nextConfirmation}` : ""
  ].filter(Boolean).join("；");
}

function summarizeRepairPlan(artifact: RepairPlan) {
  return [
    artifact.issue,
    `归因: ${artifact.suspectedCause}`,
    `范围: ${artifact.scope}`,
    artifact.affectedCanvasNodeIds?.length ? `影响节点: ${artifact.affectedCanvasNodeIds.slice(0, 6).join(" / ")}` : ""
  ].filter(Boolean).join("；");
}

export function createEmptyAgentArtifacts(): AgentArtifacts {
  return {
    schemaVersion: 1
  };
}

export function parseAgentArtifacts(value: unknown): AgentArtifacts {
  return agentArtifactsSchema.parse(value);
}

export function createAgentArtifactSnapshot(artifacts: AgentArtifacts | null | undefined): AgentArtifactSnapshot {
  const parsedArtifacts = agentArtifactsSchema.safeParse(artifacts ?? createEmptyAgentArtifacts());
  const source = parsedArtifacts.success ? parsedArtifacts.data : createEmptyAgentArtifacts();
  const summaries: ArtifactSummary[] = [];

  if (source.referenceAnalysis) {
    summaries.push(createArtifactSummary({
      kind: "referenceAnalysis",
      artifact: source.referenceAnalysis,
      title: "竞品/参考素材解析",
      summary: summarizeReferenceAnalysis(source.referenceAnalysis)
    }));
  }

  if (source.creativePlan) {
    summaries.push(createArtifactSummary({
      kind: "creativePlan",
      artifact: source.creativePlan,
      title: source.creativePlan.title,
      summary: summarizeCreativePlan(source.creativePlan)
    }));
  }

  if (source.anchorRegistry) {
    summaries.push(createArtifactSummary({
      kind: "anchorRegistry",
      artifact: source.anchorRegistry,
      title: "锚点注册表",
      summary: summarizeAnchorRegistry(source.anchorRegistry)
    }));
  }

  if (source.scriptDoc) {
    summaries.push(createArtifactSummary({
      kind: "scriptDoc",
      artifact: source.scriptDoc,
      title: source.scriptDoc.title,
      summary: summarizeScriptDoc(source.scriptDoc)
    }));
  }

  if (source.clipTable) {
    summaries.push(createArtifactSummary({
      kind: "clipTable",
      artifact: source.clipTable,
      title: "分镜 Clip Table",
      summary: summarizeClipTable(source.clipTable)
    }));
  }

  if (source.promptPack) {
    summaries.push(createArtifactSummary({
      kind: "promptPack",
      artifact: source.promptPack,
      title: "Prompt Pack",
      summary: summarizePromptPack(source.promptPack)
    }));
  }

  if (source.workflowPlan) {
    summaries.push(createArtifactSummary({
      kind: "workflowPlan",
      artifact: source.workflowPlan,
      title: source.workflowPlan.title,
      summary: summarizeWorkflowPlan(source.workflowPlan)
    }));
  }

  if (source.repairPlan) {
    summaries.push(createArtifactSummary({
      kind: "repairPlan",
      artifact: source.repairPlan,
      title: "Repair Plan",
      summary: summarizeRepairPlan(source.repairPlan)
    }));
  }

  return {
    schemaVersion: 1,
    available: summaries.length > 0,
    updatedAt: source.updatedAt,
    summaries,
    pendingConfirmationArtifactIds: summaries.filter((summary) => summary.needsUserConfirmation).map((summary) => summary.id),
    confirmedFactArtifactIds: summaries.flatMap((summary) => summary.factRefs).filter((id, index, ids) => ids.indexOf(id) === index),
    modelSuggestionArtifactIds: summaries.flatMap((summary) => summary.modelSuggestionRefs).filter((id, index, ids) => ids.indexOf(id) === index)
  };
}
