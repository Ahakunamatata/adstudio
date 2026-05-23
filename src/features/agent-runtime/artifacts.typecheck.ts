import {
  agentArtifactsSchema,
  createAgentArtifactSnapshot,
  createEmptyAgentArtifacts,
  type AgentArtifacts
} from "./artifacts";
import { createMemoryArtifactStore, mergeAgentArtifacts } from "./artifact-store";

export const sampleAgentArtifacts = {
  schemaVersion: 1,
  referenceAnalysis: {
    id: "reference-analysis-1",
    source: "fact",
    status: "confirmed",
    summary: "竞品视频前三秒以家庭安全焦虑作为 hook，中段用定位路径缓解焦虑。",
    mediaType: "video",
    adCategory: "Family safety app",
    hook: "孩子放学迟迟未到家，母亲开始担心。",
    narrativeStructure: ["焦虑触发", "打开 App", "确认位置", "CTA"],
    sceneRhythm: "0-3s hook, 3-12s problem-solution, 12-15s CTA",
    sellingPoints: ["实时位置", "到达提醒"],
    visualStyle: "真实 UGC 竖屏广告",
    targetAudience: "泰国父母",
    cta: "保护家人，从现在开始",
    sourceAssetIds: ["asset-competitor-1"],
    evidenceRefs: [
      {
        kind: "asset",
        refId: "asset-competitor-1",
        note: "来自用户上传竞品素材解析。"
      }
    ],
    modelSuggestions: ["保留焦虑到安心的情绪转折"],
    userConfirmation: {
      state: "confirmed",
      confirmedBy: "user",
      confirmedAt: "2026-05-20T12:00:00.000Z"
    }
  },
  creativePlan: {
    id: "creative-plan-1",
    source: "model_suggestion",
    status: "pending_user",
    title: "Anchor First 复刻方案",
    objective: "用 Family Locator 替换竞品里的解决方案，保持家庭安全场景。",
    referenceMode: "严格复刻剧情结构",
    subjectFocus: "生活场景为主，App 作为解决方案出现",
    channel: "TikTok",
    language: "泰国 / 泰语",
    ratio: "9:16",
    duration: "15s",
    keyMessage: "确认孩子安全，不靠猜测。",
    doList: ["锁定 App UI/icon", "逐镜 prompt 自包含"],
    dontList: ["不得虚构监听能力"],
    requiredAnchors: ["anchor-app-ui", "anchor-mother", "anchor-bangkok-night"],
    sourceArtifactIds: ["reference-analysis-1"],
    userConfirmation: {
      state: "needs_confirmation",
      requiredFields: ["referenceMode", "subjectFocus", "audioSubtitle"]
    }
  },
  anchorRegistry: {
    id: "anchor-registry-1",
    source: "mixed",
    status: "pending_user",
    anchors: [
      {
        id: "anchor-app-ui",
        source: "fact",
        status: "confirmed",
        kind: "brand_asset",
        label: "Family Locator App UI / Icon",
        description: "产品名、官方 icon、通知卡片和 CTA 画面。",
        priority: "blocking",
        assetRefs: ["asset-product-pack"],
        appliesTo: ["shot-1", "shot-4"],
        consistencyRules: ["品牌名必须与产品包一致"],
        userConfirmation: { state: "confirmed" }
      }
    ]
  },
  scriptDoc: {
    id: "script-doc-1",
    source: "model_suggestion",
    status: "pending_user",
    title: "15s 泰语广告脚本",
    language: "泰国 / 泰语",
    duration: "15s",
    scenes: [
      {
        id: "shot-1",
        source: "model_suggestion",
        status: "pending_user",
        index: 1,
        timeRange: "0-3s",
        purpose: "Hook",
        visual: "母亲在曼谷夜晚街边收到孩子未到家的提醒。",
        narration: "ลูกถึงบ้านหรือยัง?",
        onScreenText: "ลูกอยู่ที่ไหน?",
        productMoment: "Family Locator 通知卡片",
        anchors: ["anchor-app-ui", "anchor-mother", "anchor-bangkok-night"],
        riskNotes: ["通知 UI 需用户确认是否可用"]
      }
    ],
    sourceArtifactIds: ["creative-plan-1"],
    userConfirmation: { state: "needs_confirmation" }
  },
  clipTable: {
    id: "clip-table-1",
    source: "model_suggestion",
    status: "draft",
    clips: [
      {
        id: "clip-1",
        source: "model_suggestion",
        status: "draft",
        shotId: "shot-1",
        index: 1,
        timeRange: "0-3s",
        framePromptId: "prompt-shot-1-image",
        videoPromptId: "prompt-shot-1-video",
        requiredAnchorIds: ["anchor-app-ui", "anchor-mother"],
        canvasNodeIds: ["storyboard-c1", "shot-video-c1"],
        acceptanceChecks: ["App icon 可读", "人物与锚点一致"]
      }
    ]
  },
  promptPack: {
    id: "prompt-pack-1",
    source: "model_suggestion",
    status: "draft",
    prompts: [
      {
        id: "prompt-shot-1-image",
        source: "model_suggestion",
        status: "draft",
        target: "storyboard_image",
        shotId: "shot-1",
        modelFamily: "image",
        prompt: "Thai mother on Bangkok evening street, anxious, phone alert visible.",
        negativePrompt: "wrong app icon, unreadable UI",
        requiredAnchorIds: ["anchor-app-ui", "anchor-mother", "anchor-bangkok-night"],
        selfContained: true,
        variables: { productName: "Family Locator" }
      }
    ]
  },
  workflowPlan: {
    id: "workflow-plan-1",
    source: "model_suggestion",
    status: "pending_user",
    title: "脚本确认后再进分镜生产",
    steps: [
      {
        id: "step-lock-anchors",
        source: "model_suggestion",
        status: "pending_user",
        label: "锁定锚点",
        intent: "先确认品牌、人物和场景事实源。",
        dependsOn: [],
        requiredConfirmation: true,
        targetArtifactIds: ["anchor-registry-1"],
        targetCanvasNodeIds: ["app-ui", "character", "scene"]
      }
    ],
    nextConfirmation: "确认脚本与锚点"
  },
  repairPlan: {
    id: "repair-plan-1",
    source: "model_suggestion",
    status: "draft",
    issue: "C4 App icon 不准确。",
    suspectedCause: "锚点资产缺少官方 icon。",
    scope: "partial",
    affectedArtifactIds: ["anchor-registry-1", "prompt-pack-1"],
    affectedCanvasNodeIds: ["app-ui", "shot-video-c4", "final-video"],
    proposedActions: ["上传官方 icon", "只标记 C4 和最终视频 stale"],
    requiredConfirmation: true
  },
  updatedAt: "2026-05-20T12:00:00.000Z"
} satisfies AgentArtifacts;

export const parsedAgentArtifacts = agentArtifactsSchema.parse(sampleAgentArtifacts);
export const emptyAgentArtifacts = createEmptyAgentArtifacts();
export const sampleArtifactSnapshot = createAgentArtifactSnapshot(parsedAgentArtifacts);

export async function typecheckArtifactStoreRoundTrip() {
  const store = createMemoryArtifactStore();
  await store.save("session-typecheck", parsedAgentArtifacts);
  const restoredArtifacts = await store.patch("session-typecheck", {
    creativePlan: parsedAgentArtifacts.creativePlan
  });
  const mergedArtifacts = mergeAgentArtifacts(restoredArtifacts, {
    updatedAt: "2026-05-20T12:30:00.000Z"
  });
  return createAgentArtifactSnapshot(mergedArtifacts);
}
