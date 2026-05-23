import type { AgentSession, AgentUploadedAsset } from "@/lib/domain/schemas";
import type { AgentEvent } from "@/features/agent-runtime/agent-events";
import { createEmptyAgentArtifacts } from "@/features/agent-runtime/artifacts";
import type { AgentArtifacts } from "@/features/agent-runtime/artifacts";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type {
  AgentCard,
  AgentMessage,
  AgentNodeRefs,
  AgentProductionBrief,
  AgentQuickAction,
  AgentRuntimeState,
  AgentTransition,
  PendingAgentConfirmation
} from "./agent-types";

const nodeRefs: AgentNodeRefs = {
  productPack: "product-pack",
  competitorAsset: "competitor-video",
  analysis: "analysis",
  cloneStrategy: "clone-plan",
  script: "agent-script-15s",
  appUi: "app-ui",
  character: "character",
  scene: "scene",
  shotPromptC1: "shot-prompt",
  storyboardC1: "storyboard",
  finalVideo: "final-video"
};

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowLabel() {
  return "刚刚";
}

function eventsFromCard(body: string, card?: AgentCard): AgentEvent[] {
  const events: AgentEvent[] = body ? [{ kind: "text", text: body }] : [];
  if (!card) return events;

  if (card.kind === "question") {
    events.push({
      kind: "question",
      form: {
        id: `question-${card.title}`,
        title: card.title,
        description: card.body,
        submitLabel: "确认",
        fields: [
          {
            id: "choice",
            label: "选择",
            type: "radio",
            required: true,
            options: card.options
          }
        ]
      }
    });
    return events;
  }

  if (card.kind === "confirmation") {
    events.push({
      kind: "confirmation",
      confirmation: {
        id: card.confirmationId,
        title: card.title,
        summary: card.summary,
        bullets: card.bullets,
        confirmLabel: card.confirmLabel,
        secondaryLabel: card.secondaryLabel
      }
    });
    return events;
  }

  events.push({ kind: "status", label: card.status === "done" ? "done" : "executing", detail: card.title });
  card.items.forEach((item) => events.push({ kind: "node_result", nodeId: card.title, summary: item }));
  return events;
}

function createMessage(
  role: AgentMessage["role"],
  body: string,
  card?: AgentCard,
  events?: AgentEvent[],
  metadata?: AgentMessage["metadata"]
): AgentMessage {
  return {
    id: createId(role),
    role,
    body,
    card,
    events: events ?? eventsFromCard(body, card),
    createdAt: nowLabel(),
    metadata
  };
}

function getUploadedCompetitor(session: AgentSession) {
  return session.uploadedAssets.find((asset) => asset.role === "competitor_asset")?.name ?? session.competitor;
}

function getUploadedCompetitorAnalysis(session: AgentSession) {
  return session.uploadedAssets.find((asset) => asset.role === "competitor_asset")?.analysis ?? null;
}

function summarizeUploadedCompetitorAnalysis(session: AgentSession) {
  const analysis = getUploadedCompetitorAnalysis(session);
  if (!analysis) return "";

  const parts = [
    analysis.summary,
    analysis.hook ? `Hook：${analysis.hook}` : "",
    analysis.shots.length ? `镜头：${analysis.shots.length} 个` : "",
    analysis.anchorAssetsToLock.length ? `需先锁定锚点：${analysis.anchorAssetsToLock.slice(0, 4).join("、")}` : ""
  ].filter(Boolean);

  return parts.join("；");
}

function getAssetRoleLabel(role: AgentUploadedAsset["role"]) {
  if (role === "product_pack") return "产品包";
  if (role === "competitor_asset") return "竞品素材";
  return "参考素材";
}

function summarizeUploadedAssetStatus(asset: AgentUploadedAsset) {
  const label = getAssetRoleLabel(asset.role);
  const prefix = `${label}「${asset.name}」`;

  if (asset.analysisStatus === "running") return `${prefix}正在解析`;
  if (asset.analysisStatus === "failed") return `${prefix}解析失败：${asset.analysisError ?? "未知错误"}`;

  if (!asset.analysis) {
    if (asset.role === "product_pack") return `${prefix}已带入`;
    if (asset.uploadStatus === "uploaded") return `${prefix}已上传，等待解析结果`;
    return "";
  }

  const analysis = asset.analysis;
  const parts = [
    analysis.summary,
    analysis.hook ? `Hook：${analysis.hook}` : "",
    analysis.shots.length ? `${analysis.shots.length} 个镜头` : "",
    analysis.anchorAssetsToLock.length ? `建议锁定：${analysis.anchorAssetsToLock.slice(0, 3).join("、")}` : "",
    analysis.followUpQuestions.length ? `待追问：${analysis.followUpQuestions.slice(0, 2).join("、")}` : ""
  ].filter(Boolean);

  return `${prefix}解析完成：${parts.join("；")}`;
}

function summarizeUploadedAssetStatuses(session: AgentSession) {
  return session.uploadedAssets
    .map(summarizeUploadedAssetStatus)
    .filter(Boolean)
    .slice(0, 4);
}

function inferReferenceMode(prompt: string) {
  if (/只参考|节奏|结构|不照搬|不要严格/.test(prompt)) return "只参考节奏和叙事结构";
  if (/严格|复刻|还原|照着/.test(prompt)) return "严格复刻剧情结构";
  return "";
}

function inferSubjectFocus(prompt: string) {
  if (/App|UI|演示|操作/.test(prompt) && !/生活|真人|场景/.test(prompt)) return "App 演示为主，生活场景辅助";
  if (/生活|真人|母亲|孩子|场景|UGC/.test(prompt)) return "生活场景为主，App 作为解决方案出现";
  return "";
}

function inferAudioSubtitle(prompt: string) {
  if (/字幕|配音|旁白|口播|泰语/.test(prompt)) return "泰语配音 + 泰语硬字幕";
  return "";
}

function buildBrief(session: AgentSession): AgentProductionBrief {
  const prompt = session.originalPrompt.trim();
  return {
    product: session.product,
    competitorAsset: getUploadedCompetitor(session),
    referenceMode: inferReferenceMode(prompt),
    subjectFocus: inferSubjectFocus(prompt),
    audioSubtitle: inferAudioSubtitle(prompt),
    language: session.specs.language,
    channel: session.specs.channel,
    ratio: session.specs.ratio,
    duration: session.specs.duration,
    originalPrompt: prompt
  };
}

function hasCoreBoundaries(brief: AgentProductionBrief) {
  return Boolean(brief.referenceMode && brief.subjectFocus && brief.audioSubtitle);
}

function boundaryQuestionCard(brief: AgentProductionBrief): AgentCard {
  const missing = [
    brief.referenceMode ? "" : "参考程度",
    brief.subjectFocus ? "" : "主体表达",
    brief.audioSubtitle ? "" : "字幕/配音"
  ].filter(Boolean);

  return {
    kind: "question",
    title: missing.length ? `还需要确认：${missing.join("、")}` : "边界已基本齐",
    body: "我先补齐会影响后续脚本和画布节点的关键边界。你可以点一个快捷选项，也可以直接在下面输入自己的约束。",
    options: [
      {
        id: "apply_default_boundaries",
        label: "用推荐边界继续",
        description: "严格复刻剧情结构，生活场景为主，泰语配音和硬字幕。"
      },
      {
        id: "strict_plot",
        label: "严格复刻剧情",
        description: "保留竞品故事线和情绪转折，只替换产品与本地化表达。"
      },
      {
        id: "structure_only",
        label: "只参考节奏结构",
        description: "不照搬剧情，只迁移 Hook、节奏和卖点植入逻辑。"
      }
    ]
  };
}

function confirmationCard(pending: PendingAgentConfirmation): AgentCard {
  return {
    kind: "confirmation",
    confirmationId: pending.id,
    title: pending.title,
    summary: pending.summary,
    bullets: pending.bullets,
    confirmLabel: pending.confirmLabel,
    secondaryLabel: pending.secondaryLabel
  };
}

function describeCanvasAction(action: CanvasRuntimeAction) {
  if (action.type === "createNode") return `创建节点：${action.input.title ?? action.input.businessType ?? action.input.kind}`;
  if (action.type === "deleteNodes") return `删除节点：${action.nodeIds.join("、")}`;
  if (action.type === "renameNode") return `重命名节点：${action.nodeId} -> ${action.title}`;
  if (action.type === "updateNodeSettings") return `更新节点：${action.title}`;
  if (action.type === "updateNodeContent") return `写入内容：${action.nodeId}`;
  if (action.type === "connectNodes") return `连接节点：${action.source} -> ${action.target}`;
  if (action.type === "disconnectNodes") return `断开连接：${action.edgeId}`;
  if (action.type === "runNodeGeneration") return `运行生成：${action.nodeId}`;
  if (action.type === "appendNodeVersion") return `追加版本：${action.nodeId}`;
  if (action.type === "failNodeGeneration") return `生成失败：${action.nodeId}`;
  if (action.type === "setPrimaryVersion") return `设置主版本：${action.nodeId}`;
  if (action.type === "lockNode") return `锁定节点：${action.nodeId}`;
  if (action.type === "markNodeStale") return `标记返工：${action.nodeId}`;
  return `打开节点详情：${action.nodeId}`;
}

function buildActionTrace(pending: PendingAgentConfirmation): AgentCard {
  return {
    kind: "actionTrace",
    title: pending.title,
    status: "done",
    items: pending.actions.map(describeCanvasAction).slice(0, 8)
  };
}

function buildStrategyActions(brief: AgentProductionBrief): CanvasRuntimeAction[] {
  const competitorName = brief.competitorAsset || "待补充真实竞品素材";

  return [
    {
      type: "createNode",
      input: {
        id: nodeRefs.productPack,
        kind: "text",
        businessType: "product_pack",
        title: `产品资料包 · ${brief.product}`,
        model: "Product Parser",
        position: { x: 0, y: 40 },
        input: `${brief.product} 产品包或产品链接。`,
        output: "等待产品理解。",
        status: "draft",
        previewClass: "product-pack"
      }
    },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.productPack,
      title: `产品资料包 · ${brief.product}`,
      model: "Product Parser",
      output: [
        `${brief.product} 产品包已作为创作边界：家庭安全定位、到家提醒、低打扰确认安全感。`,
        "后续脚本不得虚构医疗、执法、监听等未声明能力。"
      ].join("\n"),
      settings: { prompt: brief.originalPrompt }
    },
    { type: "lockNode", nodeId: nodeRefs.productPack, locked: true },
    {
      type: "createNode",
      input: {
        id: nodeRefs.competitorAsset,
        kind: "upload",
        businessType: "competitor_asset",
        title: "竞品素材 / 参考素材",
        model: "User Asset",
        position: { x: 320, y: 40 },
        input: "用户上传或选择的竞品素材。",
        output: "等待进入解析链路。",
        status: "uploaded",
        previewClass: "competitor-video",
        settings: { uploadedFileName: competitorName }
      }
    },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.competitorAsset,
      title: "竞品素材 / 参考素材",
      model: "User Asset",
      output: `${competitorName} 已进入解析链路，用于拆解 Hook、镜头节奏、卖点植入和 CTA。`,
      settings: { uploadedFileName: competitorName }
    },
    {
      type: "createNode",
      input: {
        id: nodeRefs.analysis,
        kind: "script",
        businessType: "competitor_analysis",
        title: "客观拆解",
        model: "Gemini Multimodal",
        position: { x: 650, y: 40 },
        input: "竞品素材 + 解析重点。",
        output: "等待多模态拆解。",
        status: "draft",
        previewClass: "analysis"
      }
    },
    { type: "connectNodes", source: nodeRefs.competitorAsset, target: nodeRefs.analysis },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.analysis,
      title: "客观拆解",
      model: "Gemini Multimodal",
      output: [
        "竞品拆解：前 3 秒用家庭安全焦虑做 Hook，中段快速展示寻找与确认过程，结尾用 App 解决焦虑并 CTA。",
        "二次检查：需要明确参考程度，避免后续脚本被模型自作主张改成泛泛亲情广告。",
        `本次参考模式：${brief.referenceMode}。`
      ].join("\n"),
      settings: { prompt: "基于真实上传素材或用户补充信息进行客观拆解。" }
    },
    {
      type: "createNode",
      input: {
        id: nodeRefs.cloneStrategy,
        kind: "plan",
        businessType: "clone_strategy",
        title: "复刻方案 · Anchor First",
        model: "Ad Strategy Agent",
        position: { x: 980, y: 40 },
        input: "产品资料包 + 竞品客观拆解 + 参考程度。",
        output: "等待确认复刻方案。",
        status: "waiting_user",
        previewClass: "clone-plan"
      }
    },
    { type: "connectNodes", source: nodeRefs.productPack, target: nodeRefs.cloneStrategy },
    { type: "connectNodes", source: nodeRefs.analysis, target: nodeRefs.cloneStrategy },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.cloneStrategy,
      title: "复刻方案 · Anchor First",
      model: "Ad Strategy Agent",
      output: [
        `方案：${brief.referenceMode}，主体表达采用「${brief.subjectFocus}」。`,
        `规格：${brief.language} / ${brief.channel} / ${brief.ratio} / ${brief.duration}。`,
        `声音与字幕：${brief.audioSubtitle}。`,
        "执行原则：先锁定 App UI/icon、母亲角色和曼谷街景，再进入分镜图和分镜视频。"
      ].join("\n"),
      settings: { prompt: "确认复刻方案后再写脚本，避免跨模型上下文断层。" }
    },
    { type: "openNodeDetail", nodeId: nodeRefs.cloneStrategy }
  ];
}

function buildScriptAssetActions(brief: AgentProductionBrief): CanvasRuntimeAction[] {
  return [
    {
      type: "createNode",
      input: {
        id: nodeRefs.script,
        kind: "script",
        businessType: "ad_script",
        title: "15s 泰语广告脚本",
        model: "Script Agent",
        position: { x: 1300, y: 40 },
        input: "产品资料包 + 竞品客观拆解 + 复刻方案。",
        output: [
          "C1 0-3s：泰国母亲在夜晚街边发现孩子没按时到家，手机弹出 Family Locator 提醒。",
          "C2 3-7s：她打开 App 查看孩子位置，画面快速切换到地图定位和到达路径。",
          "C3 7-12s：确认孩子已接近家附近，母亲松一口气，焦虑转为安全感。",
          `C4 12-15s：官方 App icon、${brief.product} 产品名和 CTA 出现：保护家人，从现在开始。`
        ].join("\n"),
        status: "waiting_user",
        previewClass: "analysis"
      }
    },
    { type: "connectNodes", source: nodeRefs.productPack, target: nodeRefs.script },
    { type: "connectNodes", source: nodeRefs.analysis, target: nodeRefs.script },
    { type: "connectNodes", source: nodeRefs.cloneStrategy, target: nodeRefs.script },
    { type: "lockNode", nodeId: nodeRefs.script, locked: true },
    {
      type: "createNode",
      input: {
        id: nodeRefs.appUi,
        kind: "image",
        businessType: "product_asset",
        title: "App UI / Icon 锚点",
        model: "Product Asset Guard",
        position: { x: 0, y: 310 },
        input: "产品资料包中的产品名、App icon、UI 截图或产品页面。",
        output: "等待锁定品牌锚点。",
        status: "draft",
        previewClass: "app-ui",
        settings: { ratio: brief.ratio, resolution: "1k" }
      }
    },
    { type: "connectNodes", source: nodeRefs.productPack, target: nodeRefs.appUi },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.appUi,
      title: "App UI / Icon 锚点",
      model: "Product Asset Guard",
      output: `锁定 ${brief.product} 产品名、App icon、通知卡片和 CTA 画面。若用户上传官方 icon，以官方图为最高优先级。`,
      settings: { prompt: `Brand anchor: ${brief.product} icon and UI must stay consistent in C1/C4.` }
    },
    { type: "lockNode", nodeId: nodeRefs.appUi, locked: true },
    {
      type: "createNode",
      input: {
        id: nodeRefs.character,
        kind: "image",
        businessType: "character_reference",
        title: "泰国母亲人物定妆图",
        model: "GPT Image",
        position: { x: 650, y: 310 },
        input: "复刻方案中的角色设定。",
        output: "等待生成人物定妆图。",
        status: "draft",
        previewClass: "character",
        settings: { ratio: "3:4", resolution: "1k" }
      }
    },
    { type: "connectNodes", source: nodeRefs.cloneStrategy, target: nodeRefs.character },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.character,
      title: "泰国母亲人物定妆图",
      model: "GPT Image",
      output: "40 岁左右泰国母亲，担忧但克制。该图作为所有有人物分镜的固定参考，避免分镜角色漂移。",
      settings: { prompt: "Thai mother, consistent face, realistic UGC ad still, evening street lighting." }
    },
    { type: "lockNode", nodeId: nodeRefs.character, locked: true },
    {
      type: "createNode",
      input: {
        id: nodeRefs.scene,
        kind: "image",
        businessType: "scene_reference",
        title: "曼谷夜晚街景锚点",
        model: "GPT Image",
        position: { x: 980, y: 310 },
        input: "目标国家、渠道和复刻方案。",
        output: "等待生成场景锚点。",
        status: "draft",
        previewClass: "scene",
        settings: { ratio: brief.ratio, resolution: "1k" }
      }
    },
    { type: "connectNodes", source: nodeRefs.cloneStrategy, target: nodeRefs.scene },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.scene,
      title: "曼谷夜晚街景锚点",
      model: "GPT Image",
      output: "曼谷夜晚街道、通勤人群、路灯和轻微车流。用于 C1-C3 背景一致性。",
      settings: { prompt: "Bangkok evening street, realistic mobile ad, vertical composition." }
    },
    { type: "openNodeDetail", nodeId: nodeRefs.script }
  ];
}

function buildStoryboardVideoActions(brief: AgentProductionBrief): CanvasRuntimeAction[] {
  const shotPromptIds = ["shot-prompt", "shot-prompt-c2", "shot-prompt-c3", "shot-prompt-c4"];
  const storyboardIds = ["storyboard", "storyboard-c2", "storyboard-c3", "storyboard-c4"];
  const shotVideoIds = ["shot-video-c1", "shot-video-c2", "shot-video-c3", "shot-video-c4"];
  const shotTitles = [
    "C1 Hook：孩子在哪里",
    "C2 App 定位路径",
    "C3 确认安全",
    "C4 Icon + CTA"
  ];

  const actions: CanvasRuntimeAction[] = [
    {
      type: "createNode",
      input: {
        id: nodeRefs.shotPromptC1,
        kind: "prompt",
        businessType: "shot_prompt",
        title: "C1 分镜 Prompt",
        model: "Prompt Guard",
        position: { x: 1310, y: 230 },
        input: "锁定脚本 + 人物定妆 + 场景锚点 + App UI。",
        output: "等待生成 C1 分镜 prompt。",
        status: "draft",
        previewClass: "shot-prompt"
      }
    },
    { type: "connectNodes", source: nodeRefs.script, target: nodeRefs.shotPromptC1 },
    { type: "connectNodes", source: nodeRefs.character, target: nodeRefs.shotPromptC1 },
    { type: "connectNodes", source: nodeRefs.scene, target: nodeRefs.shotPromptC1 },
    { type: "connectNodes", source: nodeRefs.appUi, target: nodeRefs.shotPromptC1 },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.shotPromptC1,
      title: "C1 分镜 Prompt",
      model: "Prompt Guard",
      output: "Thai mother on Bangkok evening street, anxious, phone alert from Family Locator visible, 9:16 realistic TikTok ad.",
      settings: { prompt: "Each shot prompt must be self-contained. No previous/next shot references." }
    }
  ];

  shotTitles.slice(1).forEach((title, index) => {
    const promptId = shotPromptIds[index + 1];
    actions.push(
      {
        type: "createNode",
        input: {
          id: promptId,
          kind: "prompt",
          businessType: "shot_prompt",
          title: `${title} Prompt`,
          model: "Prompt Guard",
          position: { x: 1310, y: 430 + index * 150 },
          input: "锁定脚本 + 人物定妆 + 场景锚点 + App UI。",
          output: `${title}: self-contained Thai vertical ad prompt using ${brief.product}, official UI/icon anchor, Bangkok local context.`,
          status: "succeeded",
          previewClass: "shot-prompt"
        }
      },
      { type: "connectNodes", source: nodeRefs.script, target: promptId },
      { type: "connectNodes", source: nodeRefs.character, target: promptId },
      { type: "connectNodes", source: nodeRefs.scene, target: promptId },
      { type: "connectNodes", source: nodeRefs.appUi, target: promptId }
    );
  });

  shotTitles.forEach((title, index) => {
    const promptId = shotPromptIds[index];
    const storyboardId = storyboardIds[index];
    const videoId = shotVideoIds[index];
    actions.push(
      {
        type: "createNode",
        input: {
          id: storyboardId,
          kind: "image",
          businessType: "storyboard_frame",
          title: `${title} 分镜图`,
          model: "GPT Image",
          position: { x: 1640, y: 230 + index * 150 },
          input: "分镜 prompt + 锚点资产。",
          output: "等待生成分镜图。",
          status: "draft",
          previewClass: "storyboard",
          settings: { ratio: brief.ratio, resolution: "1k" }
        }
      },
      { type: "connectNodes", source: promptId, target: storyboardId },
      { type: "connectNodes", source: nodeRefs.character, target: storyboardId },
      { type: "connectNodes", source: nodeRefs.scene, target: storyboardId },
      {
        type: "createNode",
        input: {
          id: videoId,
          kind: "video",
          businessType: "shot_video",
          title: `${title} 分镜视频`,
          model: "Seedance 2.0",
          position: { x: 1980, y: 420 + index * 150 },
          input: "分镜图 + 独立视频 prompt + 产品锚点。",
          output: "等待图生视频。",
          status: "draft",
          previewClass: "final-video",
          settings: { ratio: brief.ratio, duration: index === 0 ? "3s" : index === 3 ? "3s" : "4s", mode: "图生视频" }
        }
      },
      { type: "connectNodes", source: storyboardId, target: videoId },
      { type: "connectNodes", source: promptId, target: videoId },
      { type: "connectNodes", source: nodeRefs.appUi, target: videoId }
    );
  });

  actions.push(
    {
      type: "createNode",
      input: {
        id: nodeRefs.finalVideo,
        kind: "video",
        businessType: "final_video",
        title: "最终广告视频 · 15s 泰语版",
        model: "Video Assembly Agent",
        position: { x: 2320, y: 230 },
        input: "C1-C4 分镜视频 + 字幕 + App UI 锚点。",
        output: "等待分镜视频汇总。",
        status: "draft",
        previewClass: "final-video",
        settings: { ratio: brief.ratio, duration: brief.duration, mode: "分镜视频合成" }
      }
    },
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.finalVideo,
      title: "最终广告视频 · 15s 泰语版",
      model: "Video Assembly Agent",
      output: "等待 C1-C4 分镜视频汇总。下一步可检查字幕、App icon、人物一致性和 CTA。",
      settings: { ratio: brief.ratio, duration: brief.duration, mode: "分镜视频合成" }
    },
    { type: "connectNodes", source: "shot-video-c1", target: nodeRefs.finalVideo },
    { type: "connectNodes", source: "shot-video-c2", target: nodeRefs.finalVideo },
    { type: "connectNodes", source: "shot-video-c3", target: nodeRefs.finalVideo },
    { type: "connectNodes", source: "shot-video-c4", target: nodeRefs.finalVideo },
    { type: "openNodeDetail", nodeId: nodeRefs.finalVideo }
  );

  return actions;
}

function buildIconReworkActions(): CanvasRuntimeAction[] {
  return [
    {
      type: "createNode",
      input: {
        id: "official-icon-anchor",
        kind: "upload",
        businessType: "product_asset",
        title: "官方 App Icon 锚点",
        model: "User Asset",
        position: { x: 300, y: 540 },
        input: "用户上传或指定的官方 icon 截图。",
        output: "作为 C4 CTA、App UI 和最终视频的最高优先级品牌锚点。",
        status: "uploaded",
        previewClass: "app-ui",
        settings: { uploadedFileName: "official_family_locator_icon.png" }
      }
    },
    { type: "connectNodes", source: "official-icon-anchor", target: nodeRefs.appUi },
    { type: "connectNodes", source: "official-icon-anchor", target: "shot-video-c4" },
    { type: "markNodeStale", nodeId: nodeRefs.appUi, reason: "官方 icon 锚点已补充，需要刷新品牌资产" },
    { type: "markNodeStale", nodeId: "shot-video-c4", reason: "C4 需要使用官方 icon 重做" },
    { type: "markNodeStale", nodeId: nodeRefs.finalVideo, reason: "C4 CTA 画面已返工" },
    { type: "openNodeDetail", nodeId: "official-icon-anchor" }
  ];
}

function buildSubtitleActions(brief: AgentProductionBrief): CanvasRuntimeAction[] {
  return [
    {
      type: "updateNodeSettings",
      nodeId: nodeRefs.finalVideo,
      title: "最终广告视频 · 泰语硬字幕版",
      model: "Video Assembly Agent",
      output: "已加入底部居中泰语硬字幕策略，字幕不遮挡 App UI 和 CTA。C1-C4 可按同一字幕规范局部重跑。",
      settings: {
        prompt: "Add Thai hard subtitles, bottom center, high contrast, do not cover product UI.",
        mode: "字幕合成",
        duration: brief.duration,
        ratio: brief.ratio
      }
    },
    { type: "markNodeStale", nodeId: "shot-video-c1", reason: "需要补充泰语硬字幕" },
    { type: "markNodeStale", nodeId: "shot-video-c2", reason: "需要补充泰语硬字幕" },
    { type: "markNodeStale", nodeId: "shot-video-c3", reason: "需要补充泰语硬字幕" },
    { type: "markNodeStale", nodeId: "shot-video-c4", reason: "需要补充泰语硬字幕" },
    { type: "openNodeDetail", nodeId: nodeRefs.finalVideo }
  ];
}

function buildStrategyConfirmation(brief: AgentProductionBrief): PendingAgentConfirmation {
  return {
    id: createId("confirm-strategy"),
    kind: "strategy",
    title: "确认复刻方案并搭建解析链路",
    summary: `我会按「${brief.referenceMode}」处理，不擅自大改剧情。`,
    bullets: [
      "更新产品包和竞品素材节点。",
      "运行竞品客观拆解，并做二次检查。",
      "生成 Anchor First 复刻方案，等你确认后再写脚本。"
    ],
    confirmLabel: "确认执行",
    secondaryLabel: "调整边界",
    actions: buildStrategyActions(brief),
    completionMessage: "解析链路和复刻方案已落到画布。下一步我建议先确认 15s 脚本，再锁定人物、场景和 App UI/icon 锚点。",
    nextStage: "script_review",
    nextConfirmation: buildScriptAssetConfirmation(brief)
  };
}

function buildScriptAssetConfirmation(brief: AgentProductionBrief): PendingAgentConfirmation {
  return {
    id: createId("confirm-script"),
    kind: "script_assets",
    title: "确认脚本，并先锁定锚点资产",
    summary: "我会先把 15s 脚本、人物、场景、App UI/icon 作为稳定输入源，后面分镜都引用这些节点。",
    bullets: [
      "创建 15s 泰语脚本节点并连接产品、解析和复刻方案。",
      "锁定 App UI/icon、泰国母亲人物定妆图、曼谷街景。",
      "脚本确认后再进入逐镜 prompt、分镜图和分镜视频。"
    ],
    confirmLabel: "确认脚本与锚点",
    secondaryLabel: "先改脚本",
    actions: buildScriptAssetActions(brief),
    completionMessage: "脚本和核心锚点已锁定。现在可以进入逐镜生产：每个分镜会有独立 prompt，视频不会依赖“上一镜头/下一镜头”这种模型看不到的上下文。",
    nextStage: "asset_review",
    nextConfirmation: buildStoryboardVideoConfirmation(brief)
  };
}

function buildStoryboardVideoConfirmation(brief: AgentProductionBrief): PendingAgentConfirmation {
  return {
    id: createId("confirm-storyboard"),
    kind: "storyboard_video",
    title: "生成分镜图与分镜视频",
    summary: "我会按 C1-C4 分镜拆开生成，先图后视频，视频 prompt 每条都自包含。",
    bullets: [
      "生成 C1-C4 分镜 prompt 和分镜图。",
      "每个视频节点引用对应分镜图、prompt 和 App UI/icon 锚点。",
      "最终视频节点只做汇总，方便局部返工。"
    ],
    confirmLabel: "生成分镜和视频",
    secondaryLabel: "先检查锚点",
    actions: buildStoryboardVideoActions(brief),
    completionMessage: "C1-C4 的分镜图和分镜视频节点已搭好，等待在真实生成面板中提交任务。现在可以检查 App icon、人物一致性、字幕位置和 CTA；如果某一段不准，我会只返工受影响节点。",
    nextStage: "storyboard_review"
  };
}

function buildIconReworkConfirmation(): PendingAgentConfirmation {
  return {
    id: createId("confirm-icon-rework"),
    kind: "rework_icon",
    title: "用官方 icon 锚点局部返工",
    summary: "问题更像是品牌锚点不稳定，不应该重写整条脚本。",
    bullets: [
      "创建官方 App Icon 上传锚点。",
      "把官方 icon 连接到 App UI 和 C4 视频。",
      "只标记 C4 与最终视频 stale，避免整条链路重做。"
    ],
    confirmLabel: "确认局部返工",
    secondaryLabel: "稍后上传",
    actions: buildIconReworkActions(),
    completionMessage: "官方 icon 锚点已接入画布，C4 和最终视频已标记为需要局部重跑。请在官方 icon 节点里替换真实图后再执行 C4 生成。",
    nextStage: "rework"
  };
}

function buildSubtitleConfirmation(brief: AgentProductionBrief): PendingAgentConfirmation {
  return {
    id: createId("confirm-subtitles"),
    kind: "subtitles",
    title: "为结果加入泰语硬字幕",
    summary: "我会保留现有分镜和锚点，只在视频合成层补字幕规范。",
    bullets: [
      "字幕底部居中，高对比，不遮挡 App UI。",
      "C1-C4 都标记为需要字幕版局部重跑。",
      "最终视频节点更新为泰语硬字幕版。"
    ],
    confirmLabel: "确认加字幕",
    secondaryLabel: "先不加",
    actions: buildSubtitleActions(brief),
    completionMessage: "字幕版合成策略已写入最终视频节点，C1-C4 已标记为需要字幕版局部重跑。",
    nextStage: "rework"
  };
}

function askForBoundaries(state: AgentRuntimeState): AgentRuntimeState {
  return {
    ...state,
    stage: "collecting",
    messages: [
      ...state.messages,
      createMessage(
        "assistant",
        "我先不直接生成。这个场景里最容易出错的是参考程度、主体表达和字幕/配音没有锁定，后续模型会自己补剧情。",
        boundaryQuestionCard(state.brief)
      )
    ]
  };
}

function proposeStrategy(state: AgentRuntimeState): AgentRuntimeState {
  const pending = buildStrategyConfirmation(state.brief);
  return {
    ...state,
    stage: "awaiting_confirmation",
    pendingConfirmation: pending,
    messages: [
      ...state.messages,
      createMessage(
        "assistant",
        "边界已经足够启动第一批画布动作。我会先做解析和复刻方案，不会直接跳到视频生成。",
        confirmationCard(pending),
        [
          {
            kind: "text",
            text: "边界已经足够启动第一批画布动作。我会先做解析和复刻方案，不会直接跳到视频生成。"
          },
          { kind: "confirmation", confirmation: pending }
        ]
      )
    ]
  };
}

function patchBriefFromText(brief: AgentProductionBrief, text: string): AgentProductionBrief {
  const next = { ...brief };
  const referenceMode = inferReferenceMode(text);
  const subjectFocus = inferSubjectFocus(text);
  const audioSubtitle = inferAudioSubtitle(text);

  if (referenceMode) next.referenceMode = referenceMode;
  if (subjectFocus) next.subjectFocus = subjectFocus;
  if (audioSubtitle) next.audioSubtitle = audioSubtitle;

  if (/默认|推荐|继续/.test(text)) {
    next.referenceMode ||= "严格复刻剧情结构";
    next.subjectFocus ||= "生活场景为主，App 作为解决方案出现";
    next.audioSubtitle ||= "泰语配音 + 泰语硬字幕";
  }

  if (/不要配音|无配音|只字幕/.test(text)) {
    next.audioSubtitle = "只加泰语硬字幕，不生成配音";
  }

  return next;
}

function applyDefaultBoundaries(state: AgentRuntimeState, referenceMode?: string): AgentRuntimeState {
  const brief = {
    ...state.brief,
    referenceMode: referenceMode ?? (state.brief.referenceMode || "严格复刻剧情结构"),
    subjectFocus: state.brief.subjectFocus || "生活场景为主，App 作为解决方案出现",
    audioSubtitle: state.brief.audioSubtitle || "泰语配音 + 泰语硬字幕"
  };
  return proposeStrategy({
    ...state,
    brief,
    messages: [
      ...state.messages,
      createMessage(
        "user",
        `边界确认：${brief.referenceMode}；${brief.subjectFocus}；${brief.audioSubtitle}。`
      )
    ]
  });
}

export function createInitialAgentRuntime(session: AgentSession): AgentRuntimeState {
  const brief = buildBrief(session);
  const messages: AgentMessage[] = [];

  if (brief.originalPrompt) {
    messages.push(createMessage("user", brief.originalPrompt));
  }

  messages.push(
    createMessage(
      "assistant",
      [
        `我已理解第一版需求：${brief.product}，${session.mode === "clone" ? "竞品复刻" : "新广告创作"}，${brief.language}，${brief.channel}，${brief.ratio}，${brief.duration}。`,
        brief.competitorAsset ? `我也看到你带入了素材：${brief.competitorAsset}。` : "竞品素材还没有明确上传，我会先追问或等待你补充真实素材。",
        summarizeUploadedCompetitorAnalysis(session)
          ? `Gemini 3.1 Pro 已完成素材解析：${summarizeUploadedCompetitorAnalysis(session)}。`
          : "",
        "接下来我会边追问边搭画布，不会一次性让你填完整表。"
      ].filter(Boolean).join("\n")
    )
  );

  const initialState: AgentRuntimeState = {
    stage: "collecting",
    brief,
    messages,
    pendingConfirmation: null,
    nodeRefs,
    artifacts: createEmptyAgentArtifacts(),
    actionHistory: []
  };

  return hasCoreBoundaries(brief) ? proposeStrategy(initialState) : askForBoundaries(initialState);
}

export function createInitialLlmAgentRuntime(session: AgentSession): AgentRuntimeState {
  const brief = buildBrief(session);
  const messages: AgentMessage[] = [];
  const assetStatuses = summarizeUploadedAssetStatuses(session);

  if (brief.originalPrompt) {
    messages.push(createMessage("user", brief.originalPrompt));
  }

  if (assetStatuses.length) {
    const body = `素材状态：${assetStatuses.join("；")}`;
    messages.push(
      createMessage("system", body, undefined, [
        { kind: "status", label: "done", detail: "素材解析状态" },
        { kind: "text", text: body }
      ])
    );
  }

  return {
    stage: "collecting",
    brief,
    messages,
    pendingConfirmation: null,
    nodeRefs,
    artifacts: createEmptyAgentArtifacts(),
    actionHistory: []
  };
}

export function createM32InteractionIntakeRuntime(
  session: AgentSession,
  artifacts: AgentArtifacts = createEmptyAgentArtifacts(),
  options: {
    fallbackReason?: string;
    baseState?: AgentRuntimeState;
  } = {}
): AgentRuntimeState {
  const initialState = options.baseState ?? createInitialLlmAgentRuntime(session);
  const fallbackReason = options.fallbackReason ?? "agent_decide_unavailable";
  const body = [
    "暂时连接不上 Agent。你可以先保存最小信息，稍后重试让 Agent 继续判断。",
    "这不会开始生成，也不会改动画布。"
  ].join("\n");

  return {
    ...initialState,
    artifacts,
    fallback: {
      fallbackUsed: true,
      fallbackReason
    },
    stage: "collecting",
    messages: [
      ...initialState.messages,
      createMessage("assistant", body, undefined, [
        {
          kind: "status",
          label: "error",
          detail: "连接失败，可重试"
        },
        {
          kind: "text",
          text: body
        }
      ], {
        fallbackUsed: true,
        fallbackReason
      })
    ]
  };
}

export function handleAgentQuickAction(state: AgentRuntimeState, action: AgentQuickAction): AgentTransition {
  if (action === "apply_default_boundaries") {
    return { state: applyDefaultBoundaries(state) };
  }

  if (action === "strict_plot") {
    return { state: applyDefaultBoundaries(state, "严格复刻剧情结构") };
  }

  if (action === "structure_only") {
    return { state: applyDefaultBoundaries(state, "只参考节奏和叙事结构") };
  }

  if (action === "confirm_pending" || action === "generate_storyboard_video") {
    return executePendingConfirmation(state);
  }

  if (action === "request_adjustment") {
    return {
      state: {
        ...state,
        stage: "collecting",
        pendingConfirmation: null,
        messages: [
          ...state.messages,
          createMessage("user", "我想先调整一下。"),
          createMessage("assistant", "可以。请直接告诉我你要改参考程度、脚本方向、锚点资产，还是输出规格。")
        ]
      }
    };
  }

  if (action === "rework_icon") {
    const pending = buildIconReworkConfirmation();
    return {
      state: {
        ...state,
        stage: "awaiting_confirmation",
        pendingConfirmation: pending,
        messages: [
          ...state.messages,
          createMessage("user", "App icon 不准确，需要修正。"),
          createMessage("assistant", "我判断这是品牌锚点问题，不应该整条重做。先接入官方 icon 锚点，再局部返工 C4。", confirmationCard(pending))
        ]
      }
    };
  }

  const pending = buildSubtitleConfirmation(state.brief);
  return {
    state: {
      ...state,
      stage: "awaiting_confirmation",
      pendingConfirmation: pending,
      messages: [
        ...state.messages,
        createMessage("user", "给结果加字幕。"),
        createMessage("assistant", "可以。我会保留现有画面和锚点，只补泰语硬字幕版本。", confirmationCard(pending))
      ]
    }
  };
}

export function submitAgentText(state: AgentRuntimeState, text: string): AgentTransition {
  const normalized = text.trim();
  if (!normalized) return { state };

  if (/icon|logo|图标|品牌名|名字不对/.test(normalized)) {
    return handleAgentQuickAction(state, "rework_icon");
  }

  if (/字幕|subtitle/.test(normalized)) {
    return handleAgentQuickAction(state, "add_subtitles");
  }

  if (/确认|执行|继续|开始|生成/.test(normalized) && state.pendingConfirmation) {
    return {
      ...executePendingConfirmation({
        ...state,
        messages: [...state.messages, createMessage("user", normalized)]
      })
    };
  }

  const brief = patchBriefFromText(state.brief, normalized);
  const nextState = {
    ...state,
    brief,
    messages: [...state.messages, createMessage("user", normalized)]
  };

  if (hasCoreBoundaries(brief)) {
    return { state: proposeStrategy(nextState) };
  }

  return { state: askForBoundaries(nextState) };
}

export function executePendingConfirmation(state: AgentRuntimeState): AgentTransition {
  const pending = state.pendingConfirmation;
  if (!pending) return { state };

  const nextMessages = [
    ...state.messages,
    createMessage("assistant", "我开始执行这批画布动作。", buildActionTrace(pending)),
    createMessage("assistant", pending.completionMessage, pending.nextConfirmation ? confirmationCard(pending.nextConfirmation) : undefined)
  ];

  return {
    state: {
      ...state,
      stage: pending.nextStage,
      pendingConfirmation: pending.nextConfirmation ?? null,
      messages: nextMessages,
      actionHistory: [
        ...state.actionHistory,
        {
          id: pending.id,
          title: pending.title,
          actionCount: pending.actions.length,
          createdAt: nowLabel()
        }
      ]
    },
    canvasActions: pending.actions
  };
}
