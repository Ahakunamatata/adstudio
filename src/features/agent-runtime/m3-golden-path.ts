import type { AgentSession } from "@/lib/domain/schemas";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type {
  AgentMessage,
  AgentProductionBrief,
  AgentRuntimeState
} from "@/features/workbench/agent-types";
import type { AgentTransition } from "./agent-decision";
import type { AgentEvent } from "./agent-events";
import { createAgentArtifactSnapshot, type AgentArtifacts, type CreativePlan } from "./artifacts";
import type { CanvasSnapshot } from "./agent-snapshot";
import type { WorkspaceArtifactStore } from "./artifact-store";
import {
  executeInspectCanvasTool,
  executeProposeActionBatchTool,
  executeSaveArtifactTool
} from "./guarded-tools";

type RunM3GoldenPathDemoInput = {
  state: AgentRuntimeState;
  text: string;
  session: AgentSession;
  canvas: CanvasSnapshot;
  artifactStore: WorkspaceArtifactStore;
  showUserMessage?: boolean;
};

type M3GoldenPathBrief = {
  product: string;
  referenceMode: string;
  subjectFocus: string;
  audioSubtitle: string;
  language: string;
  channel: string;
  ratio: string;
  duration: string;
};

const m3GoldenPathTriggerPattern = /\b(m3|m3\.1)\b|golden path|guarded tools?|安全演示|本地演示/i;

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowLabel() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createMessage(role: AgentMessage["role"], body: string, events?: AgentEvent[]): AgentMessage {
  return {
    id: createId(role),
    role,
    body,
    events: events ?? [{ kind: "text", text: body }],
    createdAt: nowLabel()
  };
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function compact(value: string, fallback: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

function inferProduct(session: AgentSession, text: string) {
  if (session.product.trim()) return session.product.trim();
  const chineseMatch = text.match(/给\s*([^，。,.、\n]{2,40})\s*(做|制作|生成|产出|设计)/);
  if (chineseMatch?.[1]) return chineseMatch[1].trim();
  const englishMatch = text.match(/\bfor\s+([A-Z][\w\s-]{1,40}?)(?:\s+(ad|campaign|video|creative)\b|[,.，。]|$)/i);
  return englishMatch?.[1]?.trim() || "未指定产品";
}

function inferReferenceMode(text: string) {
  if (/只参考|不照搬|不要严格/.test(text)) return "只参考节奏和叙事结构";
  if (/严格|复刻|还原|照着/.test(text)) return "严格复刻剧情结构";
  if (/节奏|结构/.test(text)) return "只参考节奏和叙事结构";
  return "先按用户需求提炼结构，不照搬未确认事实";
}

function inferSubjectFocus(text: string) {
  if (/App|UI|演示|操作/.test(text) && !/生活|真人|场景/.test(text)) return "App 演示为主，生活场景辅助";
  if (/生活|真人|母亲|孩子|场景|UGC|家庭/.test(text)) return "生活场景为主，App 作为解决方案出现";
  return "产品价值和真实使用场景并重";
}

function inferAudioSubtitle(text: string) {
  if (/不要配音|无配音|只字幕/.test(text)) return "只加字幕，不生成配音";
  if (/字幕|配音|旁白|口播|泰语|thai/i.test(text)) return "泰语配音 + 泰语硬字幕";
  return "字幕/配音待用户确认";
}

function inferLanguage(session: AgentSession, text: string) {
  if (session.specs.language.trim()) return session.specs.language;
  if (/泰语|泰国|thai/i.test(text)) return "泰国 / 泰语";
  if (/英语|英文|english/i.test(text)) return "英语";
  return "语言待确认";
}

function inferChannel(session: AgentSession, text: string) {
  if (session.specs.channel.trim()) return session.specs.channel;
  if (/tiktok/i.test(text)) return "TikTok";
  if (/meta|facebook|instagram|reels/i.test(text)) return "Meta Reels";
  if (/youtube|shorts/i.test(text)) return "YouTube Shorts";
  return "投放渠道待确认";
}

function inferRatio(session: AgentSession, text: string) {
  if (session.specs.ratio.trim()) return session.specs.ratio;
  if (/9\s*:\s*16|竖屏|vertical/i.test(text)) return "9:16";
  if (/1\s*:\s*1|方形/i.test(text)) return "1:1";
  return "9:16";
}

function inferDuration(session: AgentSession, text: string) {
  if (session.specs.duration.trim()) return session.specs.duration;
  const match = text.match(/(\d{1,2})\s*(s|秒|秒钟)/i);
  return match?.[1] ? `${match[1]}s` : "15s";
}

function createM3GoldenPathBrief(session: AgentSession, text: string): M3GoldenPathBrief {
  return {
    product: inferProduct(session, text),
    referenceMode: inferReferenceMode(text),
    subjectFocus: inferSubjectFocus(text),
    audioSubtitle: inferAudioSubtitle(text),
    language: inferLanguage(session, text),
    channel: inferChannel(session, text),
    ratio: inferRatio(session, text),
    duration: inferDuration(session, text)
  };
}

function createCreativePlanArtifact(session: AgentSession, text: string, brief: M3GoldenPathBrief): CreativePlan {
  const requestHash = hashText(`${session.id}:${text}`);

  return {
    id: `m3-creative-plan-${requestHash}`,
    source: "model_suggestion",
    status: "pending_user",
    title: `M3 CreativePlan · ${brief.product}`,
    objective: compact(text, `为 ${brief.product} 生成安全可审核的广告 CreativePlan。`),
    referenceMode: brief.referenceMode,
    subjectFocus: brief.subjectFocus,
    channel: brief.channel,
    language: brief.language,
    ratio: brief.ratio,
    duration: brief.duration,
    keyMessage: `${brief.product} 的广告方案先保存为 artifact，再由用户确认 proposal。`,
    doList: [
      "先保存 CreativePlan artifact，再进入后续生产链路。",
      "只返回 non-executable proposal，不执行 canvas reducer。",
      "刷新后从 workspace-backed ArtifactStore 恢复 artifact summary。"
    ],
    dontList: [
      "不执行真实 canvas action。",
      "不触发媒体生成。",
      "不调用扣费型生成 API。"
    ],
    requiredAnchors: [
      `${brief.product} 产品名/品牌锚点`,
      brief.subjectFocus,
      brief.audioSubtitle
    ],
    evidenceRefs: [
      {
        kind: "message",
        refId: session.id,
        note: "PM 在 M3 golden path UI 中输入的广告需求。"
      }
    ],
    userConfirmation: {
      state: "needs_confirmation",
      requiredFields: ["referenceMode", "subjectFocus", "audioSubtitle"],
      notes: "M3.1 本地安全演示路径生成；不是最终 ToolLoopAgent。"
    }
  };
}

function createProposalActions(artifact: CreativePlan, brief: M3GoldenPathBrief): CanvasRuntimeAction[] {
  return [
    {
      type: "createNode",
      input: {
        id: `proposal-${artifact.id}`,
        kind: "plan",
        businessType: "clone_strategy",
        title: `Proposal Preview · ${brief.product}`,
        model: "M3 Guarded Tools Demo",
        position: { x: 120, y: 120 },
        input: `Artifact: ${artifact.id}`,
        output: [
          artifact.objective,
          `参考程度：${brief.referenceMode}`,
          `主体表达：${brief.subjectFocus}`,
          "该节点只是 proposal 内容预览；M3.1 不会真实创建。"
        ].join("\n"),
        status: "draft",
        previewClass: "clone-plan"
      }
    }
  ];
}

function patchBrief(current: AgentProductionBrief, brief: M3GoldenPathBrief, text: string): AgentProductionBrief {
  return {
    ...current,
    product: brief.product,
    referenceMode: brief.referenceMode,
    subjectFocus: brief.subjectFocus,
    audioSubtitle: brief.audioSubtitle,
    language: brief.language,
    channel: brief.channel,
    ratio: brief.ratio,
    duration: brief.duration,
    originalPrompt: current.originalPrompt.trim() || text
  };
}

function describeArtifactSummary(artifacts: AgentArtifacts) {
  const snapshot = createAgentArtifactSnapshot(artifacts);
  const creativePlan = snapshot.summaries.find((summary) => summary.kind === "creativePlan");
  if (!creativePlan) return "Artifact summary 尚未进入 runtime snapshot。";
  return `Artifact summary 已进入 runtime snapshot：${creativePlan.title ?? creativePlan.id}；${creativePlan.summary}`;
}

export function shouldUseM3GoldenPathDemo(text: string) {
  return m3GoldenPathTriggerPattern.test(text.trim());
}

export async function runM3GoldenPathDemo({
  state,
  text,
  session,
  canvas,
  artifactStore,
  showUserMessage = false
}: RunM3GoldenPathDemoInput): Promise<AgentTransition> {
  const brief = createM3GoldenPathBrief(session, text);
  const creativePlan = createCreativePlanArtifact(session, text, brief);
  const inspectResult = executeInspectCanvasTool({}, { canvas });
  const saveResult = await executeSaveArtifactTool(
    {
      sessionId: session.id,
      artifactKind: "creativePlan",
      artifact: creativePlan
    },
    { artifactStore }
  );
  const nextArtifacts = await artifactStore.load(session.id);
  const proposalResult = executeProposeActionBatchTool(
    {
      id: `m3-proposal-${hashText(creativePlan.id)}`,
      title: "M3 guarded tools proposal 预览",
      summary: "这是 non-executable proposal confirmation；executable: false，不会执行画布 reducer。",
      actions: createProposalActions(creativePlan, brief),
      confirmLabel: "仅确认预览",
      secondaryLabel: "调整需求"
    },
    { canvas }
  );
  const events: AgentEvent[] = [
    {
      kind: "status",
      label: "planning",
      detail: "M3.1 PM Golden Path 本地编排"
    },
    {
      kind: "warning",
      text: "本轮是 deterministic local orchestrated path，用于 PM 手点验收；不是最终 ToolLoopAgent。不会执行 canvas reducer，不会生成媒体，不会扣费。"
    },
    ...inspectResult.events,
    ...saveResult.events,
    {
      kind: "text",
      text: describeArtifactSummary(nextArtifacts)
    },
    ...proposalResult.events
  ];
  const messages = [
    ...state.messages,
    ...(showUserMessage ? [createMessage("user", text)] : []),
    createMessage(
      "assistant",
      "M3.1 guarded tools golden path 已走完安全预览。",
      events
    )
  ];

  return {
    state: {
      ...state,
      stage: "awaiting_confirmation",
      brief: patchBrief(state.brief, brief, text),
      messages,
      pendingConfirmation: null,
      artifacts: nextArtifacts
    }
  };
}
