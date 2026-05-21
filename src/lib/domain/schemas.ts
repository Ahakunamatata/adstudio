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
  "objective_breakdown",
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

export const templateIndustrySchema = z.enum([
  "ecommerce", // 电商零售：服饰、美妆、家居、日用、3C、宠物
  "food-beverage", // 食品饮料：餐饮品牌、零食、保健品、酒水
  "health", // 健康医疗：健身、护肤、个护、医美、营养品
  "app", // App 工具：工具类、效率、安全（Family Locator 这种）
  "game", // 游戏：手游、休闲、试玩
  "finance", // 金融：银行、保险、投资、加密
  "education", // 教育：K12、语言、技能、在线课程
  "travel", // 旅行出行：酒店、机票、本地服务、出行
  "saas", // B2B / SaaS：企业软件、订阅服务、办公协作
  "real-estate-auto" // 房产汽车：房产、汽车、大宗消费
]);

export const templateFormatSchema = z.enum(["ugc", "avatar", "app-demo", "tvc", "clone"]);

export const templateSchemaIdSchema = z.enum([
  "ugc_demo",
  "app_demo_hook",
  "story_hook_cta",
  "cinematic_tvc",
  "replicate_ad"
]);

export const templateAssetKindSchema = z.enum(["image", "video", "logo", "app_ui"]);

export const templateTextTokenSchema = z.object({
  type: z.literal("text"),
  value: z.string()
});

export const templateSlotTokenSchema = z.object({
  type: z.literal("slot"),
  key: z.string(),
  label: z.string(),
  value: z.string(),
  editable: z.boolean(),
  required: z.boolean(),
  source: z.enum(["template", "product_pack", "user_input", "agent_rewrite"]).optional()
});

export const templateAssetTokenSchema = z.object({
  type: z.literal("asset"),
  key: z.string(),
  label: z.string(),
  accept: z.array(templateAssetKindSchema),
  required: z.boolean(),
  value: z.string().optional(),
  previewUrl: z.string().optional()
});

export const templateRichTextTokenSchema = z.discriminatedUnion("type", [
  templateTextTokenSchema,
  templateSlotTokenSchema,
  templateAssetTokenSchema
]);

export const templateTimedBlockSchema = z.object({
  label: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  content: z.array(templateRichTextTokenSchema)
});

export const templateReferenceAssetSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: templateAssetKindSchema,
  required: z.boolean(),
  previewUrl: z.string().optional()
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
  industry: templateIndustrySchema,
  format: templateFormatSchema,
  prompt: z.string(),
  recommendedModel: z.string(),
  defaultRatio: z.string(),
  defaultDuration: z.string().optional(),
  requiredSlots: z.array(z.string()),
  schema: templateSchemaIdSchema.optional(),
  summary: z.string().optional(),
  verificationStatus: z.string().optional(),
  verticals: z.array(z.string()).optional(),
  formats: z.array(z.string()).optional(),
  funnelStage: z.string().optional(),
  previewAsset: z.string().optional(),
  credits: z.string().optional(),
  scriptBlocks: z.array(templateTimedBlockSchema).optional(),
  slotTokens: z.array(templateRichTextTokenSchema).optional(),
  referenceAssets: z.array(templateReferenceAssetSchema).optional()
});

// ────────────────────────────────────────────────────────────────
// 爆款广告（TopAd）
// 数据源：一期 TikTok Creative Center，二期 Meta Ad Library + Google Ads
// 区别于 Template：
//  - 不存 prompt / scriptSchema（不给用户完整脚本）
//  - 存真实投放数据 + AI 轻量标的 3 个标签
//  - 行动入口固定指向 Agent 复刻流程，不指向 Ad Video/Image 表单
// ────────────────────────────────────────────────────────────────

export const topAdSourceSchema = z.enum([
  "tiktok-creative-center",
  "meta-ad-library",
  "google-ads"
]);

// AI 轻量标输出的高维度爆款逻辑标签。一期由 Gemini Flash 预跑。
// 质量要求：每条 8-15 字，必须是"这一条独有的爆款逻辑"，
// 拒绝"真实场景拍摄""节奏紧凑""有 CTA"这类通用描述。
export const topAdInsightSchema = z.object({
  label: z.string(),
  category: z.enum([
    "emotion",
    "hook",
    "visual",
    "localization",
    "structure"
  ])
});

export const topAdMetricsSchema = z.object({
  views: z.string(),
  revenue: z.string().optional(),
  roas: z.string().optional(),
  engagement: z.string().optional(),
  conversion: z.string().optional()
});

export const topAdSchema = z.object({
  id: z.string(),
  title: z.string(),
  industry: templateIndustrySchema,
  source: topAdSourceSchema,
  sourceUrl: z.string().optional(),
  brand: z.string(),
  region: z.string(),
  regionFlag: z.string(),
  platform: z.string(),
  publishedAt: z.string(),
  campaignDays: z.number(),
  durationSec: z.number(),
  previewVideo: z.string().optional(),
  thumbClass: z.string().optional(),
  metrics: topAdMetricsSchema,
  insights: z.array(topAdInsightSchema).max(3)
});

export const winningAdSchema = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string(),
  sourceLabel: z.string(),
  industry: z.string(),
  region: z.string(),
  timeWindow: z.string(),
  thumbClass: z.string(),
  label: z.string(),
  format: z.string(),
  hook: z.string(),
  metrics: z.object({
    views: z.string(),
    revenue: z.string(),
    roas: z.string(),
    engagementRate: z.string()
  }),
  breakdown: z.array(z.string()),
  replicatePrompt: z.string()
});

// ────────────────────────────────────────────────────────────────
// MyProduct：用户自助录入的产品 + 个性化爆款抓取流程
//
// 一期为本地 prototype，状态机走 mock pipeline：
//   idle → parsing → ready → scraping → done
// 错误路径单独走 error。
//
// 抓取结果暂用现有 topAds 池按品类筛选 + 模拟 relevance 分数。
// 接真后端时，scrapedAdIds 改为 server 返回的真实 TopAd ID 列表，
// MyProductTopAd 增加 relevanceScore / matchedKeywords / scrapedAt
// 等抓取阶段产物，平台进度由 SSE 推送替代 setTimeout。
// ────────────────────────────────────────────────────────────────

export const myProductTypeSchema = z.enum([
  "App",
  "Ecommerce",
  "Game",
  "SaaS",
  "Service",
  "Other"
]);

export const myProductScrapeStatusSchema = z.enum([
  "idle",
  "parsing",
  "ready",
  "scraping",
  "done",
  "error"
]);

export const myProductPlatformSchema = z.enum(["TikTok", "Meta", "Google"]);

export const myProductPlatformProgressSchema = z.object({
  platform: myProductPlatformSchema,
  status: z.enum(["pending", "fetching", "done"]),
  count: z.number()
});

// 把 DB ads 表里关键的展示字段冗余冗写在 scrapedAd 里，避免 UI 还要做一次
// adId → 详情查询。同时让产品的 scrapedAds 在 localStorage 里自包含。
export const dbAdInlineSchema = z.object({
  title: z.string(),
  advertiserName: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  regionFlag: z.string().optional(),
  // ads.source 原值，给前端画 source badge（"meta" / "tiktok" / "google"）
  source: z.enum(["meta", "tiktok", "google"]).optional(),
  // publisher_platforms[0] → display 名（"Facebook" / "Instagram" / "TikTok"）
  platformLabel: z.string().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  snapshotUrl: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  creativeBodies: z.array(z.string()).default([]),
  // Meta fetcher 入库就拿到了 landing / CTA / page likes，前端可直接展示
  landingPageUrl: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
  pageLikeCount: z.number().nullable().optional(),
  deliveryStartAt: z.string().nullable().optional(),
  deliveryStopAt: z.string().nullable().optional()
});

export const myProductScrapedAdSchema = z.object({
  adId: z.string(),
  platform: myProductPlatformSchema,
  relevanceScore: z.number(),
  matchedKeywords: z.array(z.string()),
  scrapedAt: z.string(),
  // DB 来源的广告会带这一坨；mock topAd 来源的留空走 topAdMap 老路径
  adData: dbAdInlineSchema.optional()
});

export const myProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: myProductTypeSchema,
  intro: z.string(),
  painPoints: z.string(),
  url: z.string(),
  images: z.array(z.string()),
  useForCloning: z.boolean(),
  status: myProductScrapeStatusSchema,
  progress: z.array(myProductPlatformProgressSchema),
  inferredIndustry: templateIndustrySchema.optional(),
  inferredKeywords: z.array(z.string()),
  scrapedAds: z.array(myProductScrapedAdSchema),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type MyProductType = z.infer<typeof myProductTypeSchema>;
export type MyProductScrapeStatus = z.infer<typeof myProductScrapeStatusSchema>;
export type MyProductPlatform = z.infer<typeof myProductPlatformSchema>;
export type MyProductPlatformProgress = z.infer<typeof myProductPlatformProgressSchema>;
export type MyProductScrapedAd = z.infer<typeof myProductScrapedAdSchema>;
export type DbAdInline = z.infer<typeof dbAdInlineSchema>;
export type MyProduct = z.infer<typeof myProductSchema>;

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
export type TemplateIndustry = z.infer<typeof templateIndustrySchema>;
export type TemplateFormat = z.infer<typeof templateFormatSchema>;
export type TemplateSchemaId = z.infer<typeof templateSchemaIdSchema>;
export type TemplateRichTextToken = z.infer<typeof templateRichTextTokenSchema>;
export type TemplateTimedBlock = z.infer<typeof templateTimedBlockSchema>;
export type TopAd = z.infer<typeof topAdSchema>;
export type TopAdSource = z.infer<typeof topAdSourceSchema>;
export type TopAdInsight = z.infer<typeof topAdInsightSchema>;
export type TopAdMetrics = z.infer<typeof topAdMetricsSchema>;
export type WinningAd = z.infer<typeof winningAdSchema>;
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

// 当 Agent 会话来自「在 Agent 中复刻」入口时，把来源爆款广告和（可选）
// 触发该复刻的「我的产品」ID 一起带进会话，让 Workbench 画布能据此
// 预创建 objective_breakdown → clone_strategy → ad_script → storyboard_frame
// → final_video 这 5 个节点。
export type AgentCloneSource = {
  topAdId: string;
  topAdTitle: string;
  topAdBrand: string;
  topAdRegion: string;
  topAdRegionFlag: string;
  topAdPlatform: string;
  topAdDurationSec: number;
  topAdInsights: TopAdInsight[];
  // 当从「我的产品爆款」面板进入时，记录是哪个产品要复刻这条广告；
  // 从普通爆款广告库进入时该字段为 undefined。
  myProductId?: string;
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
  cloneSource?: AgentCloneSource;
};

export type FlowNodeVisualState = "pending" | "current" | "done";
