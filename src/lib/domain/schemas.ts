import { z } from "zod";

export const appRouteSchema = z.enum([
  "home",
  "agent",
  "agent-setup",
  "workbench",
  "video",
  "image",
  "templates",
  "assets"
]);

export const agentModeSchema = z.enum(["clone", "create"]);
export const agentStepSchema = z.enum(["product", "competitor", "focus", "creative", "specs", "confirm"]);
export const generationKindSchema = z.enum(["video", "image"]);

export const canvasNodeKindSchema = z.enum([
  "text",
  "image",
  "video",
  "upload",
  "script",
  "prompt",
  "plan"
]);

export const businessNodeTypeSchema = z.enum([
  "product_pack",
  "product_asset",
  "competitor_asset",
  "competitor_analysis",
  "clone_strategy",
  "creative_concept",
  "ad_script",
  "shot_prompt",
  "character_reference",
  "scene_reference",
  "storyboard_frame",
  "shot_video",
  "final_video",
  "avatar_video"
]);

export const nodeStatusSchema = z.enum([
  "draft",
  "queued",
  "running",
  "succeeded",
  "failed",
  "stale",
  "locked",
  "uploaded",
  "waiting_user",
  "pending",
  "checked",
  "completed"
]);

export const canvasNodeVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  label: z.string(),
  content: z.string(),
  createdAt: z.string(),
  model: z.string(),
  time: z.string(),
  cost: z.string(),
  previewClass: z.string().optional()
});

export const canvasNodeSettingsSchema = z
  .object({
    prompt: z.string().optional(),
    ratio: z.string().optional(),
    resolution: z.string().optional(),
    duration: z.string().optional(),
    camera: z.string().optional(),
    mode: z.string().optional(),
    batch: z.string().optional(),
    uploadedFileName: z.string().optional()
  })
  .catchall(z.string());

export const canvasPositionSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const templateSchema = z.object({
  id: z.string(),
  title: z.string(),
  route: generationKindSchema,
  toast: z.string(),
  categoryIds: z.array(z.string()),
  meta: z.tuple([z.string(), z.string()]),
  thumbClass: z.string(),
  label: z.string().optional(),
  prompt: z.string(),
  recommendedModel: z.string(),
  defaultRatio: z.string(),
  defaultDuration: z.string().optional(),
  requiredSlots: z.array(z.string())
});

export const canvasNodeSchema = z.object({
  id: z.string(),
  kind: canvasNodeKindSchema,
  businessType: businessNodeTypeSchema,
  type: z.string(),
  title: z.string(),
  status: nodeStatusSchema,
  model: z.string(),
  time: z.string(),
  cost: z.string(),
  input: z.string(),
  output: z.string(),
  version: z.number(),
  locked: z.boolean(),
  group: z.enum(["product", "analysis", "script", "assets", "video"]),
  position: canvasPositionSchema,
  parentNodeIds: z.array(z.string()),
  versions: z.array(canvasNodeVersionSchema),
  primaryVersionId: z.string(),
  previewClass: z.string(),
  settings: canvasNodeSettingsSchema.optional(),
  staleReason: z.string().optional()
});

export const canvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional()
});

export type AppRoute = z.infer<typeof appRouteSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type GenerationKind = z.infer<typeof generationKindSchema>;
export type CanvasNodeKind = z.infer<typeof canvasNodeKindSchema>;
export type BusinessNodeType = z.infer<typeof businessNodeTypeSchema>;
export type NodeStatus = z.infer<typeof nodeStatusSchema>;
export type Template = z.infer<typeof templateSchema>;
export type CanvasNodeVersion = z.infer<typeof canvasNodeVersionSchema>;
export type CanvasNodeSettings = z.infer<typeof canvasNodeSettingsSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export type AgentSpecs = {
  language: string;
  channel: string;
  ratio: string;
  duration: string;
};

export type AgentSession = {
  mode: AgentMode;
  currentStepIndex: number;
  locked: boolean;
  product: string;
  competitor: string;
  focus: string[];
  creativeGoal: string;
  specs: AgentSpecs;
  originalPrompt: string;
};

export type FlowNodeVisualState = "pending" | "current" | "done";
