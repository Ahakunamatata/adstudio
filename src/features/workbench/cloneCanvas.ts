import type {
  AgentCloneSource,
  CanvasEdge,
  CanvasNode,
  CanvasNodeVersion,
  TopAd,
  TopAdInsight
} from "@/lib/domain/schemas";

// ────────────────────────────────────────────────────────────────
// cloneCanvas
//
// 给定一条 TopAd（爆款广告）+ 当前要复刻进的产品名，确定性地生成 5 个
// 复刻流水线节点 + 4 条父子边，喂给 Workbench 画布初始状态。
//
// 节点拓扑（垂直从上到下）：
//   1. objective_breakdown   ← 拆解原广告爆款逻辑（hook/structure/emotion/visual）
//   2. clone_strategy        ← 把拆解结论迁移到当前产品的高层方案
//   3. ad_script             ← 分时间段的脚本（0-3s hook / 3-10s body / 10-15s CTA）
//   4. storyboard_frame      ← 每个脚本段对应的视觉分镜占位
//   5. final_video           ← 最终合成视频占位
//
// 所有节点都以 `draft` 状态开局，内容是 placeholder + 来源元数据；
// 未来接真 LLM 时，objective_breakdown / clone_strategy 这两个文本节点
// 是先要被 LLM 改写的。
// ────────────────────────────────────────────────────────────────

const CLONE_NODE_X = 240;
const CLONE_NODE_Y_START = 80;
const CLONE_NODE_Y_GAP = 320;

function summarizeInsights(insights: TopAdInsight[]) {
  if (!insights || insights.length === 0) {
    return "（暂无 AI 预标洞察）";
  }
  return insights
    .map((insight) => `- [${insight.category}] ${insight.label}`)
    .join("\n");
}

function buildSourceMeta(source: AgentCloneSource) {
  return [
    `来源爆款：${source.topAdTitle}`,
    `广告主：${source.topAdBrand} · 地区：${source.topAdRegionFlag} ${source.topAdRegion} · 平台：${source.topAdPlatform}`,
    `时长：${source.topAdDurationSec}s`
  ].join("\n");
}

function buildObjectiveBreakdownText(source: AgentCloneSource) {
  return [
    buildSourceMeta(source),
    "",
    "【为什么这条广告爆】（AI 轻量标，待 LLM 进一步拆解）",
    summarizeInsights(source.topAdInsights),
    "",
    "下一步：调用 LLM 把以上洞察展开为 hook / structure / emotion / visual 四维拆解。",
    "// TODO(next-iteration): 用 LLM 把这段占位文案替换为真实的多维拆解。"
  ].join("\n");
}

function buildCloneStrategyText(source: AgentCloneSource, productName: string) {
  return [
    `目标产品：${productName}`,
    `参考爆款：${source.topAdTitle}（${source.topAdBrand} · ${source.topAdRegion}）`,
    "",
    "【高层迁移方案】（占位，待 LLM 基于 objective_breakdown + 产品包生成）",
    "- 保留原广告的情绪曲线与节奏结构",
    "- 替换品牌锚点为当前产品的卖点 / UI / CTA",
    "- 本地化语言、字幕、场景到目标投放地区",
    "",
    "// TODO(next-iteration): 接入 LLM，把上一节点的 objective_breakdown 和产品包" +
      "拼起来生成 plan。"
  ].join("\n");
}

function buildAdScriptText(source: AgentCloneSource, productName: string) {
  return [
    `${productName} 复刻脚本（占位，长度对齐原广告 ${source.topAdDurationSec}s）`,
    "",
    "0-3s 钩子段",
    "- 痛点 / 反差 / 情绪开场（迁移自原广告 hook）",
    "",
    "3-10s 主体段",
    "- 产品演示 / UGC 镜头 / 情节铺垫",
    "",
    "10-15s CTA 段",
    "- 行动召唤 + App / 商品 / 落地页指引",
    "",
    "// TODO(next-iteration): 接入脚本 Agent，根据 clone_strategy 真正生成对应分段。"
  ].join("\n");
}

function buildStoryboardText(source: AgentCloneSource) {
  return [
    `${source.topAdPlatform} ${source.topAdDurationSec}s · 分镜占位`,
    "",
    "- 帧 1（0-3s）：钩子段视觉",
    "- 帧 2（3-10s）：主体段视觉",
    "- 帧 3（10-15s）：CTA 段视觉",
    "",
    "// TODO(next-iteration): 拆成 N 个 storyboard_frame 子节点，每段脚本对应一个，" +
      "并连到下游 shot_video / final_video。"
  ].join("\n");
}

function buildFinalVideoText(source: AgentCloneSource, productName: string) {
  return [
    `${productName} 复刻视频（占位，待生成）`,
    `规格参考：${source.topAdPlatform} 9:16 · ${source.topAdDurationSec}s`,
    "",
    "// TODO(next-iteration): 由 storyboard + ad_script 触发 final_video 合成。"
  ].join("\n");
}

function buildVersion(
  nodeId: string,
  content: string,
  model: string,
  previewClass: string
): CanvasNodeVersion {
  return {
    id: `${nodeId}-v1`,
    version: 1,
    label: "v1",
    content,
    createdAt: new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }),
    model,
    time: "待生成",
    cost: "0 credits",
    previewClass
  };
}

type CloneNodeSeed = {
  id: string;
  businessType: CanvasNode["businessType"];
  kind: CanvasNode["kind"];
  group: CanvasNode["group"];
  type: string;
  title: string;
  model: string;
  previewClass: string;
  input: string;
  output: string;
};

function nodeFromSeed(seed: CloneNodeSeed, yIndex: number, parentNodeIds: string[]): CanvasNode {
  const version = buildVersion(seed.id, seed.output, seed.model, seed.previewClass);
  return {
    id: seed.id,
    kind: seed.kind,
    businessType: seed.businessType,
    group: seed.group,
    type: seed.type,
    title: seed.title,
    status: "draft",
    model: seed.model,
    time: "待生成",
    cost: "0 credits",
    input: seed.input,
    output: seed.output,
    version: 1,
    locked: false,
    position: { x: CLONE_NODE_X, y: CLONE_NODE_Y_START + yIndex * CLONE_NODE_Y_GAP },
    parentNodeIds,
    versions: [version],
    primaryVersionId: version.id,
    previewClass: seed.previewClass,
    settings: {}
  };
}

export function buildCloneCanvas(
  source: AgentCloneSource,
  productName: string
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const sourceSuffix = source.topAdId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const ids = {
    breakdown: `clone-breakdown-${sourceSuffix}`,
    strategy: `clone-strategy-${sourceSuffix}`,
    script: `clone-script-${sourceSuffix}`,
    storyboard: `clone-storyboard-${sourceSuffix}`,
    final: `clone-final-${sourceSuffix}`
  };

  const breakdown = nodeFromSeed(
    {
      id: ids.breakdown,
      businessType: "objective_breakdown",
      kind: "script",
      group: "analysis",
      type: "Breakdown",
      title: "客观拆解：原广告为何爆",
      model: "Ad Strategy Agent",
      previewClass: "analysis",
      input: `来源爆款：${source.topAdTitle}（${source.topAdBrand} · ${source.topAdRegion}）。AI 预标洞察 ${source.topAdInsights.length} 条。`,
      output: buildObjectiveBreakdownText(source)
    },
    0,
    []
  );

  const strategy = nodeFromSeed(
    {
      id: ids.strategy,
      businessType: "clone_strategy",
      kind: "plan",
      group: "analysis",
      type: "Plan",
      title: "迁移复刻方案",
      model: "Ad Strategy Agent",
      previewClass: "clone-plan",
      input: `客观拆解 + 当前产品「${productName}」资料包。`,
      output: buildCloneStrategyText(source, productName)
    },
    1,
    [breakdown.id]
  );

  const script = nodeFromSeed(
    {
      id: ids.script,
      businessType: "ad_script",
      kind: "script",
      group: "script",
      type: "Script",
      title: "复刻脚本（占位）",
      model: "Script Agent",
      previewClass: "text",
      input: `复刻方案 + 输出规格（${source.topAdDurationSec}s 参考时长）。`,
      output: buildAdScriptText(source, productName)
    },
    2,
    [strategy.id]
  );

  const storyboard = nodeFromSeed(
    {
      id: ids.storyboard,
      businessType: "storyboard_frame",
      kind: "image",
      group: "assets",
      type: "Storyboard",
      title: "分镜占位（按脚本段拆分）",
      model: "GPT Image",
      previewClass: "storyboard",
      input: "复刻脚本的 hook / body / CTA 三段。",
      output: buildStoryboardText(source)
    },
    3,
    [script.id]
  );

  const final = nodeFromSeed(
    {
      id: ids.final,
      businessType: "final_video",
      kind: "video",
      group: "video",
      type: "Video",
      title: "最终复刻视频",
      model: "Seedance 2.0",
      previewClass: "final-video",
      input: "分镜 + 脚本 + 产品锚点。",
      output: buildFinalVideoText(source, productName)
    },
    4,
    [storyboard.id]
  );

  const nodes: CanvasNode[] = [breakdown, strategy, script, storyboard, final];

  const edges: CanvasEdge[] = [
    { id: `edge-${breakdown.id}-${strategy.id}`, source: breakdown.id, target: strategy.id, label: "breakdown" },
    { id: `edge-${strategy.id}-${script.id}`, source: strategy.id, target: script.id, label: "plan" },
    { id: `edge-${script.id}-${storyboard.id}`, source: script.id, target: storyboard.id, label: "script" },
    { id: `edge-${storyboard.id}-${final.id}`, source: storyboard.id, target: final.id, label: "visual" }
  ];

  return { nodes, edges };
}

export function toCloneSource(ad: TopAd, myProductId?: string): AgentCloneSource {
  return {
    topAdId: ad.id,
    topAdTitle: ad.title,
    topAdBrand: ad.brand,
    topAdRegion: ad.region,
    topAdRegionFlag: ad.regionFlag,
    topAdPlatform: ad.platform,
    topAdDurationSec: ad.durationSec,
    topAdInsights: ad.insights,
    myProductId
  };
}
