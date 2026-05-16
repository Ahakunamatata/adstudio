import type { CanvasEdge, CanvasNode } from "@/lib/domain/schemas";

type CanvasNodeSeed = Omit<CanvasNode, "versions" | "primaryVersionId"> & {
  versionContent?: string;
};

function createVersion(node: CanvasNodeSeed) {
  return {
    id: `${node.id}-v${node.version}`,
    version: node.version,
    label: `v${node.version}`,
    content: node.versionContent ?? node.output,
    createdAt: "2026-05-16 10:28",
    model: node.model,
    time: node.time,
    cost: node.cost,
    previewClass: node.previewClass
  };
}

function defineNode(node: CanvasNodeSeed): CanvasNode {
  const version = createVersion(node);
  const canvasNode = { ...node };
  delete canvasNode.versionContent;
  return {
    ...canvasNode,
    versions: [version],
    primaryVersionId: version.id
  };
}

export const canvasNodes: CanvasNode[] = [
  defineNode({
    id: "product-pack",
    kind: "text",
    businessType: "product_pack",
    group: "product",
    type: "Product Pack",
    title: "产品资料包",
    status: "locked",
    model: "Product Parser",
    time: "12s",
    cost: "2 credits",
    input: "产品 URL：Family Locator App 页面。",
    output: "产品名、Logo/Icon、App UI、核心卖点、用户画像和痛点。禁止新增未声明功能承诺。",
    version: 1,
    locked: true,
    position: { x: 0, y: 40 },
    parentNodeIds: [],
    previewClass: "product-pack",
    versionContent: "Family Locator：家庭安全定位 App。核心卖点是家庭成员位置确认、到家提醒和低打扰式安全感。"
  }),
  defineNode({
    id: "app-ui",
    kind: "image",
    businessType: "product_asset",
    group: "product",
    type: "Image",
    title: "App UI / Icon",
    status: "locked",
    model: "GPT Image",
    time: "18s",
    cost: "8 credits",
    input: "产品资料包中的 App 名称、Logo、UI 描述和泰语本地化参数。",
    output: "后续 CTA 镜头和 App 演示镜头的品牌锚点。",
    version: 1,
    locked: true,
    position: { x: 0, y: 320 },
    parentNodeIds: ["product-pack"],
    previewClass: "app-ui"
  }),
  defineNode({
    id: "competitor-video",
    kind: "video",
    businessType: "competitor_asset",
    group: "analysis",
    type: "Video",
    title: "竞品视频",
    status: "uploaded",
    model: "User Asset",
    time: "0s",
    cost: "0 credits",
    input: "用户上传的 15s 竞品广告视频。",
    output: "用于多模态解析、节奏拆解和复刻方案映射。",
    version: 1,
    locked: false,
    position: { x: 310, y: 40 },
    parentNodeIds: [],
    previewClass: "competitor-video"
  }),
  defineNode({
    id: "analysis",
    kind: "script",
    businessType: "competitor_analysis",
    group: "analysis",
    type: "Analysis",
    title: "客观拆解",
    status: "succeeded",
    model: "Gemini Multimodal",
    time: "21s",
    cost: "6 credits",
    input: "竞品视频 + 用户关注重点：Hook、脚本逻辑、CTA。",
    output: "Hook：先抛出孩子未按时回家的焦虑；情绪曲线：紧张到释然；CTA：让父母立刻确认家人安全。",
    version: 1,
    locked: false,
    position: { x: 640, y: 40 },
    parentNodeIds: ["competitor-video"],
    previewClass: "analysis"
  }),
  defineNode({
    id: "clone-plan",
    kind: "plan",
    businessType: "clone_strategy",
    group: "analysis",
    type: "Plan",
    title: "迁移复刻方案",
    status: "waiting_user",
    model: "Ad Strategy Agent",
    time: "9s",
    cost: "3 credits",
    input: "产品包 + 竞品客观拆解 + 二次检查结果。",
    output: "保留紧张开场和反转释然结构，替换成 Family Locator 的家庭安全场景、泰国本地街景和 App UI 锚点。",
    version: 1,
    locked: false,
    position: { x: 970, y: 40 },
    parentNodeIds: ["product-pack", "analysis"],
    previewClass: "clone-plan"
  }),
  defineNode({
    id: "character",
    kind: "image",
    businessType: "character_reference",
    group: "assets",
    type: "Image",
    title: "泰国母亲人物参考",
    status: "locked",
    model: "GPT Image",
    time: "18s",
    cost: "8 credits",
    input: "复刻方案人物设定：40 岁左右泰国母亲，担忧但克制。",
    output: "所有有人物分镜图和图生视频的参考输入。",
    version: 1,
    locked: true,
    position: { x: 640, y: 320 },
    parentNodeIds: ["clone-plan"],
    previewClass: "character"
  }),
  defineNode({
    id: "scene",
    kind: "image",
    businessType: "scene_reference",
    group: "assets",
    type: "Image",
    title: "曼谷街景",
    status: "succeeded",
    model: "GPT Image",
    time: "16s",
    cost: "8 credits",
    input: "泰国市场、本地街景、夜晚通勤氛围。",
    output: "用于 C1/C2 场景镜头和背景一致性。",
    version: 1,
    locked: false,
    position: { x: 970, y: 320 },
    parentNodeIds: ["clone-plan"],
    previewClass: "scene"
  }),
  defineNode({
    id: "shot-prompt",
    kind: "prompt",
    businessType: "shot_prompt",
    group: "assets",
    type: "Prompt",
    title: "C1 分镜 Prompt",
    status: "succeeded",
    model: "Prompt Guard",
    time: "2s",
    cost: "1 credit",
    input: "复刻方案 + 锁定人物 + 曼谷街景 + App UI 锚点。",
    output: "Subject: Thai mother holding phone. Scene: Bangkok evening street. Action: checks Family Locator and exhales. Product/Brand: App UI visible.",
    version: 1,
    locked: false,
    position: { x: 1310, y: 230 },
    parentNodeIds: ["clone-plan", "character", "scene", "app-ui"],
    previewClass: "shot-prompt"
  }),
  defineNode({
    id: "storyboard",
    kind: "image",
    businessType: "storyboard_frame",
    group: "video",
    type: "Image",
    title: "C1 分镜图",
    status: "succeeded",
    model: "GPT Image",
    time: "12s",
    cost: "5 credits",
    input: "C1 prompt + 人物参考 + 曼谷街景参考。",
    output: "进入视频模型前的视觉确认图。",
    version: 1,
    locked: false,
    position: { x: 1640, y: 230 },
    parentNodeIds: ["shot-prompt", "character", "scene"],
    previewClass: "storyboard"
  }),
  defineNode({
    id: "final-video",
    kind: "video",
    businessType: "final_video",
    group: "video",
    type: "Video",
    title: "最终广告视频",
    status: "draft",
    model: "Seedance 2.0",
    time: "待生成",
    cost: "待估算",
    input: "分镜图、单镜头 prompt、字幕和 App UI 锚点。",
    output: "15s 9:16 可预览广告视频。",
    version: 1,
    locked: false,
    position: { x: 1980, y: 230 },
    parentNodeIds: ["storyboard", "shot-prompt", "app-ui"],
    previewClass: "final-video"
  })
];

export const canvasEdges: CanvasEdge[] = [
  { id: "edge-product-app-ui", source: "product-pack", target: "app-ui", label: "product asset" },
  { id: "edge-competitor-analysis", source: "competitor-video", target: "analysis", label: "analyze" },
  { id: "edge-product-clone-plan", source: "product-pack", target: "clone-plan", label: "constraints" },
  { id: "edge-analysis-clone-plan", source: "analysis", target: "clone-plan", label: "structure" },
  { id: "edge-clone-character", source: "clone-plan", target: "character", label: "role" },
  { id: "edge-clone-scene", source: "clone-plan", target: "scene", label: "scene" },
  { id: "edge-clone-shot-prompt", source: "clone-plan", target: "shot-prompt", label: "plan" },
  { id: "edge-character-shot-prompt", source: "character", target: "shot-prompt", label: "character ref" },
  { id: "edge-scene-shot-prompt", source: "scene", target: "shot-prompt", label: "scene ref" },
  { id: "edge-app-shot-prompt", source: "app-ui", target: "shot-prompt", label: "brand anchor" },
  { id: "edge-shot-prompt-storyboard", source: "shot-prompt", target: "storyboard", label: "prompt" },
  { id: "edge-character-storyboard", source: "character", target: "storyboard", label: "character ref" },
  { id: "edge-scene-storyboard", source: "scene", target: "storyboard", label: "scene ref" },
  { id: "edge-storyboard-final-video", source: "storyboard", target: "final-video", label: "visual input" },
  { id: "edge-shot-prompt-final-video", source: "shot-prompt", target: "final-video", label: "motion prompt" },
  { id: "edge-app-final-video", source: "app-ui", target: "final-video", label: "cta ui" }
];

export const nodeMap = Object.fromEntries(canvasNodes.map((node) => [node.id, node])) as Record<string, CanvasNode>;

export const canvasGroups = [
  { id: "product", title: "产品核心锚点", className: "group-product" },
  { id: "analysis", title: "竞品解析与复刻策略", className: "group-analysis" },
  { id: "assets", title: "一致性资产", className: "group-assets" },
  { id: "video", title: "视频生产", className: "group-video" }
] as const;
