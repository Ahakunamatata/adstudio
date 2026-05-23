import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentMediaAnalysis } from "@/lib/domain/schemas";

type OpenAiCompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
};

type MediaAnalysisInput = {
  mediaUrl: string;
  mimeType?: string;
  fileName?: string;
  role?: string;
  userContext?: string;
};

const mediaShotAnalysisSchema = z.object({
  id: z.string().optional(),
  timeRange: z.string().optional(),
  scene: z.string().optional(),
  camera: z.string().optional(),
  action: z.string().optional(),
  visual: z.string().optional(),
  onScreenText: z.string().optional(),
  narration: z.string().optional(),
  sellingPoint: z.string().optional(),
  referenceValue: z.string().optional()
});

const stringArraySchema = z.preprocess((value) => {
  if (value === null || typeof value === "undefined") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value ? [value] : [];
  return [];
}, z.array(z.string()));

const mediaAnalysisSchema = z
  .object({
    mediaType: z.enum(["image", "video", "unknown"]).optional(),
    summary: z.string().optional(),
    adCategory: z.string().optional(),
    hook: z.string().optional(),
    narrativeStructure: z.string().optional(),
    sceneRhythm: z.string().optional(),
    sellingPoints: stringArraySchema,
    visualStyle: z.string().optional(),
    characters: stringArraySchema,
    productAnchors: stringArraySchema,
    brandAssets: stringArraySchema,
    appUiMentions: stringArraySchema,
    textOverlays: stringArraySchema,
    audio: z.string().optional(),
    cta: z.string().optional(),
    shots: z.array(mediaShotAnalysisSchema).optional(),
    reusableStructure: stringArraySchema,
    anchorAssetsToLock: stringArraySchema,
    generationRisks: stringArraySchema,
    followUpQuestions: stringArraySchema
  })
  .passthrough()
  .transform((analysis): AgentMediaAnalysis => ({
    mediaType: analysis.mediaType ?? "unknown",
    summary: analysis.summary ?? "素材已解析，但模型没有返回摘要。",
    adCategory: analysis.adCategory ?? "unknown",
    hook: analysis.hook ?? "",
    narrativeStructure: analysis.narrativeStructure ?? "",
    sceneRhythm: analysis.sceneRhythm ?? "",
    sellingPoints: analysis.sellingPoints,
    visualStyle: analysis.visualStyle ?? "",
    characters: analysis.characters,
    productAnchors: analysis.productAnchors,
    brandAssets: analysis.brandAssets,
    appUiMentions: analysis.appUiMentions,
    textOverlays: analysis.textOverlays,
    audio: analysis.audio ?? "",
    cta: analysis.cta ?? "",
    shots: (analysis.shots ?? []).map((shot, index) => ({
      id: shot.id ?? `shot-${index + 1}`,
      timeRange: shot.timeRange ?? "",
      scene: shot.scene ?? "",
      camera: shot.camera ?? "",
      action: shot.action ?? "",
      visual: shot.visual ?? "",
      onScreenText: shot.onScreenText ?? "",
      narration: shot.narration ?? "",
      sellingPoint: shot.sellingPoint ?? "",
      referenceValue: shot.referenceValue ?? ""
    })),
    reusableStructure: analysis.reusableStructure,
    anchorAssetsToLock: analysis.anchorAssetsToLock,
    generationRisks: analysis.generationRisks,
    followUpQuestions: analysis.followUpQuestions
  }));

export class GeminiMediaAnalysisError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "GeminiMediaAnalysisError";
    this.status = status;
  }
}

function readLocalEnvValue(key: string) {
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return "";
    const contents = fs.readFileSync(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      const name = trimmed.slice(0, separatorIndex).trim();
      if (name !== key) continue;
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!rawValue) return "";
      if (
        (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        try {
          return JSON.parse(rawValue) as string;
        } catch {
          return rawValue.slice(1, -1);
        }
      }
      return rawValue;
    }
  } catch {
    return "";
  }
  return "";
}

function getEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key] || readLocalEnvValue(key);
    if (value) return value;
  }
  return "";
}

function getGeminiMediaConfig() {
  const apiKey = getEnvValue("GEMINI_MEDIA_ANALYSIS_API_KEY", "GEMINI_AGENT_API_KEY", "GEMINI_API_KEY");
  const model = getEnvValue("GEMINI_MEDIA_ANALYSIS_MODEL") || "gemini-3.1-pro";
  const apiUrl =
    getEnvValue("GEMINI_MEDIA_ANALYSIS_API_URL") ||
    "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions";

  return { apiKey, model, apiUrl };
}

function extractOpenAiCompatibleText(payload: OpenAiCompatibleChatResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("").trim();
  return "";
}

function parseJsonPayload(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new GeminiMediaAnalysisError("Gemini 3.1 Pro 返回内容不是可解析的 JSON。", 502);
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new GeminiMediaAnalysisError("Gemini 3.1 Pro 返回内容包含 JSON 片段，但解析失败。", 502);
    }
  }
}

function parseMediaAnalysis(text: string): AgentMediaAnalysis {
  const parsed = mediaAnalysisSchema.safeParse(parseJsonPayload(text));
  if (parsed.success) return parsed.data;

  const issueSummary = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");

  throw new GeminiMediaAnalysisError(`Gemini 3.1 Pro 素材解析 JSON 不符合 schema：${issueSummary}`, 502);
}

function createMediaAnalysisPrompt(input: MediaAnalysisInput) {
  return [
    "请分析这份广告图片或视频素材，输出广告生产可直接使用的结构化 JSON。",
    "必须只返回 JSON，不要 Markdown、解释或代码块。",
    "",
    "输出字段：",
    "- mediaType: image | video | unknown",
    "- summary: 一句话说明素材内容和广告目的",
    "- adCategory: 素材所属广告类型",
    "- hook: 前 1-3 秒或首屏钩子",
    "- narrativeStructure: 叙事结构和情绪转折",
    "- sceneRhythm: 镜头节奏、时长密度、视觉推进方式",
    "- sellingPoints: 卖点列表",
    "- visualStyle: 画面风格、构图、光线、色彩",
    "- characters: 人物/主体列表",
    "- productAnchors: 必须稳定的产品锚点，如 App UI、icon、品牌名、包装、核心界面",
    "- brandAssets: 识别到的品牌名、logo、icon、包装等",
    "- appUiMentions: App/UI/页面状态/关键按钮/通知卡片",
    "- textOverlays: 画面文字、字幕、贴纸、CTA 文案",
    "- audio: 旁白、配音、音乐、音效或静音判断",
    "- cta: 结尾行动号召",
    "- shots: 视频按镜头拆解；图片则给 1 个首屏镜头。每项含 id,timeRange,scene,camera,action,visual,onScreenText,narration,sellingPoint,referenceValue",
    "- reusableStructure: 适合复用到新广告的结构，不要照搬品牌名或专有素材",
    "- anchorAssetsToLock: 进入分镜前必须先稳定的锚点资产",
    "- generationRisks: 复刻或生成时容易出错的点",
    "- followUpQuestions: 为继续生产必须追问用户的问题",
    "",
    "分析原则：",
    "1. 区分严格复刻剧情、只参考节奏/叙事结构、只参考视觉风格三种用途。",
    "2. 不要虚构看不到的产品功能或品牌信息。",
    "3. 分镜视频 prompt 后续会逐镜独立生成，所以 referenceValue 要写成当前镜头可独立执行的信息。",
    "4. 如视频无法完整读取，要明确指出缺口并给 followUpQuestions。",
    "",
    `文件名：${input.fileName ?? "unknown"}`,
    `MIME：${input.mimeType ?? "unknown"}`,
    `素材角色：${input.role ?? "reference_asset"}`,
    `用户补充上下文：${input.userContext?.trim() || "无"}`
  ].join("\n");
}

export async function analyzeMediaWithGemini(input: MediaAnalysisInput): Promise<AgentMediaAnalysis> {
  const { apiKey, apiUrl } = getGeminiMediaConfig();
  if (!apiKey) {
    throw new GeminiMediaAnalysisError("Gemini 3.1 Pro 素材解析 API key 未配置。", 503);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      messages: [
        {
          role: "developer",
          content: [
            {
              type: "text",
              text: "你是广告素材拆解专家，擅长把竞品图片/视频拆成 Hook、镜头、卖点、锚点资产和可复用结构。"
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "text", text: createMediaAnalysisPrompt(input) },
            { type: "image_url", image_url: { url: input.mediaUrl } }
          ]
        }
      ],
      stream: false,
      include_thoughts: false,
      reasoning_effort: "high"
    }),
    signal: AbortSignal.timeout(120_000)
  });

  const raw = await response.text();
  let payload: OpenAiCompatibleChatResponse | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as OpenAiCompatibleChatResponse) : null;
  } catch {
    // Keep payload null and use the raw response in the error below.
  }

  if (!response.ok) {
    const detail = payload?.error?.message ?? raw;
    throw new GeminiMediaAnalysisError(
      `Gemini 3.1 Pro 素材解析请求失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 280)}` : ""}`,
      response.status
    );
  }

  const text = payload ? extractOpenAiCompatibleText(payload) : "";
  if (!text) {
    throw new GeminiMediaAnalysisError("Gemini 3.1 Pro 素材解析没有返回文本内容。", 502);
  }

  return parseMediaAnalysis(text);
}

export function getGeminiMediaRuntimeInfo() {
  const { apiKey, apiUrl, model } = getGeminiMediaConfig();
  return {
    configured: Boolean(apiKey),
    model,
    apiUrl,
    apiFormat: "openai" as const
  };
}
