// Workbench 5-node clone canvas 的 LLM prompts + 结构化输出 schema.
//
// 每个 business_type 一份：
//   - systemPrompt: 给 Minimax M2.7 的系统指令
//   - schema: Zod 校验生成的 JSON 形状
//   - buildUserPrompt: 拼装 user message（带 sourceAd + parent outputs）
//
// 输出 token 预算给 4096（M2.7 是推理模型，要给 thinking 留 buffer）。
// 5 个节点串联，每一步都把上游已生成的 content 喂给下游做依据。

import { z } from "zod";

// ──────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────

export type CloneSourceContext = {
  topAdId: string;
  topAdTitle: string;
  topAdBrand: string;
  topAdRegion: string;
  topAdPlatform: string;
  topAdDurationSec: number;
  topAdInsights: Array<{ label: string; category: string }>;
  myProductName?: string;
};

export type ParentArtifact = {
  businessType: WorkbenchBusinessType;
  content: unknown;
};

export const workbenchBusinessTypeSchema = z.enum([
  "objective_breakdown",
  "clone_strategy",
  "ad_script",
  "storyboard_frame",
  "final_video"
]);
export type WorkbenchBusinessType = z.infer<typeof workbenchBusinessTypeSchema>;

// ──────────────────────────────────────────────────────────────
// 1. objective_breakdown — 拆这条爆款为什么爆
// ──────────────────────────────────────────────────────────────

export const objectiveBreakdownSchema = z.object({
  hookAnalysis: z.object({
    durationSec: z.number().describe("前 N 秒是 hook"),
    technique: z.string().describe("钩子的核心手法"),
    whyEffective: z.string()
  }),
  visualSignals: z.array(z.string()).min(2).max(6).describe("视觉上的独有印记，每条 ≤ 25 字"),
  pacing: z.string().describe("整体节奏 / 镜头切换密度的特征"),
  audience: z.object({
    targetSegment: z.string(),
    painPointTouched: z.string()
  }),
  whyItWorked: z.string().describe("1-3 句总结这条为什么能爆，结构化复盘")
});

const OBJECTIVE_BREAKDOWN_SYSTEM = `你是一个广告创意洞察分析师。拆解一条爆款广告"为什么爆"。

# 严格输出格式（必须 1:1 遵守字段名 + 类型，不允许加字段 / 改字段名 / 嵌套）

{
  "hookAnalysis": {
    "durationSec": <number, 例如 3>,
    "technique": "<string, 钩子的具体手法，如 '强声效 + 红屏闪烁制造紧迫感'>",
    "whyEffective": "<string, 为什么让人停留>"
  },
  "visualSignals": [
    "<string, 第 1 个视觉印记>",
    "<string, 第 2 个>"
  ],
  "pacing": "<string, 一段话描述整体节奏。不要写成对象>",
  "audience": {
    "targetSegment": "<string, 目标人群一句话>",
    "painPointTouched": "<string, 戳中了什么焦虑>"
  },
  "whyItWorked": "<string, 1-3 句结构化复盘 hook + visual + audience 怎么协同。不要写成对象>"
}

# 内容要求

- 不写"真实场景拍摄""节奏紧凑"这种适用于所有广告的描述
- visualSignals 每条 ≤ 25 字，2-6 条
- pacing 和 whyItWorked 必须是字符串（string），不要写成嵌套对象
- 不要加任何 system prompt 没列出的字段（如 type / mechanism / colors）

只输出 JSON。无 markdown 包裹。无解释文字。`;

// ──────────────────────────────────────────────────────────────
// 2. clone_strategy — 怎么把这套结构搬到我的产品
// ──────────────────────────────────────────────────────────────

export const cloneStrategySchema = z.object({
  preserveElements: z.array(z.string()).min(2).max(6).describe("从源广告保留什么（结构 / 节奏 / 钩子 / 视觉手法）"),
  replaceElements: z.array(z.string()).min(2).max(6).describe("从源广告替换什么（主体 / 卖点 / 文案 / 场景）"),
  adaptedHook: z.string().describe("适配到当前产品的新 hook，一句话"),
  productIntegration: z.string().describe("产品怎么自然出现在广告里，不要硬塞"),
  risks: z.array(z.string()).max(4).describe("复刻过程中可能翻车的地方")
});

const CLONE_STRATEGY_SYSTEM = `你是一个广告复刻策略师。基于上游 objective_breakdown，规划"怎么把这套被验证的结构搬到当前产品"。

# 严格输出格式（必须 1:1 遵守）

{
  "preserveElements": [
    "<string, 例如 '保留 1 秒强声效 hook'>",
    "<string>"
  ],
  "replaceElements": [
    "<string, 例如 '把欧美街道场景换成亚洲商场'>",
    "<string>"
  ],
  "adaptedHook": "<string, 适配到当前产品的新 hook，一句话>",
  "productIntegration": "<string, 产品怎么自然出现>",
  "risks": [
    "<string, 例如 '用户可能联想到原品牌'>"
  ]
}

# 要求

- preserveElements 至少 2 条，至多 6 条
- replaceElements 至少 2 条，至多 6 条
- risks 至多 4 条
- 不要加 system 没列的字段
- 所有 string 字段是纯字符串，不是嵌套对象

只输出 JSON。`;

// ──────────────────────────────────────────────────────────────
// 3. ad_script — 分场带时间轴的脚本
// ──────────────────────────────────────────────────────────────

export const adScriptSchema = z.object({
  totalDurationSec: z.number().min(5).max(60),
  scenes: z
    .array(
      z.object({
        sceneId: z.string().describe("S1 / S2 / S3..."),
        startSec: z.number(),
        endSec: z.number(),
        visual: z.string().describe("画面里发生什么，1-2 句"),
        narration: z.string().describe("旁白 / 台词，没有就空字符串"),
        onScreenText: z.string().describe("屏幕字幕，没有就空字符串"),
        productBeat: z.string().describe("产品在这一场以什么形式出现")
      })
    )
    .min(2)
    .max(6)
});

const AD_SCRIPT_SYSTEM = `你是一个广告脚本编剧。基于上游 clone_strategy，写带时间轴的可执行脚本。

# 严格输出格式（必须 1:1 遵守）

{
  "totalDurationSec": <number, 10-20>,
  "scenes": [
    {
      "sceneId": "S1",
      "startSec": 0,
      "endSec": 3,
      "visual": "<string, 画面里发生什么 1-2 句>",
      "narration": "<string, 旁白台词，没有就空字符串>",
      "onScreenText": "<string, 屏幕字幕，没有就空字符串>",
      "productBeat": "<string, 产品以什么形式出现，没有就空字符串>"
    }
  ]
}

# 要求

- scenes 至少 2 个，至多 6 个
- totalDurationSec = 所有 scenes 的 (endSec - startSec) 总和，必须严格相等
- 第一个 scene 实现 adaptedHook，时长 ≤ 4 秒
- 至少一个 scene 的 productBeat 非空
- 最后一个 scene 给行动指令（不是空喊口号）
- 不要加 system 没列的字段

只输出 JSON。`;

// ──────────────────────────────────────────────────────────────
// 4. storyboard_frame — 每个场景的视觉拆解（暂不接图像生成）
// ──────────────────────────────────────────────────────────────

export const storyboardFrameSchema = z.object({
  frames: z
    .array(
      z.object({
        sceneId: z.string(),
        composition: z.string().describe("镜头景别 + 构图"),
        cameraAngle: z.string().describe("机位 / 角度"),
        characterFocus: z.string().describe("主体是谁 + 在干嘛"),
        backgroundDetail: z.string().describe("背景关键元素"),
        palette: z.string().describe("色调 / 光线特征"),
        textOverlay: z.string().describe("画面上的字幕样式 / 位置")
      })
    )
    .min(2)
    .max(6)
});

const STORYBOARD_FRAME_SYSTEM = `你是一个视觉指导。基于上游 ad_script 的每个 scene，翻译成可被图像模型理解的视觉描述。

# 严格输出格式（必须 1:1 遵守）

{
  "frames": [
    {
      "sceneId": "S1",
      "composition": "<string, 景别 + 构图，如 '特写 + 三分法'>",
      "cameraAngle": "<string, 机位 + 角度，如 '平视手持微抖'>",
      "characterFocus": "<string, 主体是谁 + 在干嘛>",
      "backgroundDetail": "<string, 背景 2-3 个关键元素>",
      "palette": "<string, 主色调 + 光线特征>",
      "textOverlay": "<string, 字幕样式 / 位置，没有就空字符串>"
    }
  ]
}

# 要求

- frames 数量 = ad_script.scenes 数量，sceneId 一一对应
- 每个字段都是 string，不是嵌套对象
- composition 用专业术语：特写 / 近景 / 中景 / 远景 + 居中 / 三分法
- cameraAngle：平视 / 俯拍 / 仰拍 + 手持 / 稳定 + 运动方向
- 不要加 system 没列的字段

只输出 JSON。`;

// ──────────────────────────────────────────────────────────────
// 5. final_video — 给视频模型的执行 prompt 包
// ──────────────────────────────────────────────────────────────

export const finalVideoSchema = z.object({
  prompt: z.string().describe("给视频模型的主 prompt，英文，包含场景 + 动作 + 风格"),
  negativePrompt: z.string().describe("negative prompt，过滤常见错误"),
  paramsPlan: z.object({
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
    durationSec: z.number(),
    fps: z.number().default(30),
    motionIntensity: z.enum(["subtle", "moderate", "dynamic"])
  }),
  anchorRequirements: z
    .array(
      z.object({
        role: z.enum(["character", "scene", "product", "ui"]),
        description: z.string(),
        critical: z.boolean().describe("是否必须先生成锚点图再做视频")
      })
    )
    .min(1)
    .max(5)
});

const FINAL_VIDEO_SYSTEM = `你是一个视频生成工程师。基于上游 storyboard_frame，编译可直接喂给视频生成模型的 prompt 包。

# 严格输出格式（必须 1:1 遵守）

{
  "prompt": "<string, 英文，整合场景 + 主体 + 动作 + 风格，200 字内>",
  "negativePrompt": "<string, 英文 negative prompt>",
  "paramsPlan": {
    "aspectRatio": "9:16",
    "durationSec": <number>,
    "fps": 30,
    "motionIntensity": "moderate"
  },
  "anchorRequirements": [
    {
      "role": "character",
      "description": "<string, 需要的人物锚点描述>",
      "critical": true
    }
  ]
}

# 要求

- prompt 必须英文
- aspectRatio 必须是: "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
- motionIntensity 必须是: "subtle" | "moderate" | "dynamic"
- anchorRequirements.role 必须是: "character" | "scene" | "product" | "ui"
- anchorRequirements 至少 1 条，至多 5 条
- durationSec 跟 ad_script.totalDurationSec 一致
- 不要加 system 没列的字段

只输出 JSON。`;

// ──────────────────────────────────────────────────────────────
// Routing
// ──────────────────────────────────────────────────────────────

type NodeConfig = {
  systemPrompt: string;
  schema: z.ZodType;
};

const NODE_CONFIG: Record<WorkbenchBusinessType, NodeConfig> = {
  objective_breakdown: {
    systemPrompt: OBJECTIVE_BREAKDOWN_SYSTEM,
    schema: objectiveBreakdownSchema
  },
  clone_strategy: {
    systemPrompt: CLONE_STRATEGY_SYSTEM,
    schema: cloneStrategySchema
  },
  ad_script: { systemPrompt: AD_SCRIPT_SYSTEM, schema: adScriptSchema },
  storyboard_frame: {
    systemPrompt: STORYBOARD_FRAME_SYSTEM,
    schema: storyboardFrameSchema
  },
  final_video: { systemPrompt: FINAL_VIDEO_SYSTEM, schema: finalVideoSchema }
};

export function getNodeConfig(type: WorkbenchBusinessType): NodeConfig {
  return NODE_CONFIG[type];
}

// 父节点 → 子节点的依赖关系（前序条件）
export const PARENT_CHAIN: Record<WorkbenchBusinessType, WorkbenchBusinessType | null> = {
  objective_breakdown: null,
  clone_strategy: "objective_breakdown",
  ad_script: "clone_strategy",
  storyboard_frame: "ad_script",
  final_video: "storyboard_frame"
};

// ──────────────────────────────────────────────────────────────
// User prompt builder
// ──────────────────────────────────────────────────────────────

export function buildUserPrompt(
  businessType: WorkbenchBusinessType,
  source: CloneSourceContext,
  parents: ParentArtifact[]
): string {
  const lines: string[] = [];

  lines.push("=== 源爆款广告 ===");
  lines.push(`标题: ${source.topAdTitle}`);
  lines.push(`品牌: ${source.topAdBrand}`);
  lines.push(`地区: ${source.topAdRegion}`);
  lines.push(`平台: ${source.topAdPlatform}`);
  lines.push(`时长: ${source.topAdDurationSec}秒`);
  if (source.topAdInsights.length > 0) {
    lines.push("已预标的爆款逻辑标签:");
    for (const insight of source.topAdInsights) {
      lines.push(`  - [${insight.category}] ${insight.label}`);
    }
  }
  if (source.myProductName) {
    lines.push("");
    lines.push(`=== 你要复刻到的目标产品 ===`);
    lines.push(source.myProductName);
  }

  // 喂上游 artifacts
  for (const parent of parents) {
    lines.push("");
    lines.push(`=== 上游 ${parent.businessType} 已生成 ===`);
    lines.push(JSON.stringify(parent.content, null, 2));
  }

  lines.push("");
  lines.push(`=== 你的任务 ===`);
  lines.push(`生成 ${businessType} 的结构化 JSON，严格按 system prompt 的字段要求。`);

  return lines.join("\n");
}
