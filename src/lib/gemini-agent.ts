import {
  AgentAiSdkDecisionError,
  decideWithAiSdkStructuredOutput,
  type AgentAiSdkDecisionMetadata
} from "@/features/agent-runtime/ai-sdk/decision-provider";
import {
  canUseAiSdkGoogleProvider,
  getGeminiAgentConfig,
  getGeminiAgentRuntimeInfo
} from "@/features/agent-runtime/ai-sdk/model-config";
import {
  AGENT_PROVIDER_MAX_ATTEMPTS,
  AGENT_PROVIDER_TIMEOUT_MS,
  classifyProviderHttpStatus,
  createProviderRetryDelayMs,
  isRetryableProviderReason,
  normalizeProviderUsage,
  type AgentProviderErrorReason,
  type AgentProviderMetadata,
  type AgentProviderUsage
} from "@/features/agent-runtime/ai-sdk/provider-metadata";
import { AD_STUDIO_AGENT_SYSTEM_PROMPT } from "@/features/agent-runtime/llm/agent-system-prompt";
import { llmAgentOutputSchema, type LlmAgentOutput } from "@/features/agent-runtime/llm/agent-output-schema";

type GeminiContentPart = {
  text?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

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
  usage?: Record<string, unknown>;
};

type ProviderTextResult = {
  text: string;
  usage?: AgentProviderUsage;
  warnings?: string[];
  retryCount: number;
};

export class GeminiAgentError extends Error {
  status: number;
  reason: AgentProviderErrorReason | string;
  detail?: string;
  retryCount: number;

  constructor(
    message: string,
    status = 500,
    reason: AgentProviderErrorReason | string = "provider_request_failed",
    detail?: string,
    retryCount = 0
  ) {
    super(message);
    this.name = "GeminiAgentError";
    this.status = status;
    this.reason = reason;
    this.detail = detail;
    this.retryCount = retryCount;
  }
}

type GeminiAgentRuntimeInfo = ReturnType<typeof getGeminiAgentRuntimeInfo>;

export type GeminiAgentDecisionRuntime = GeminiAgentRuntimeInfo & AgentProviderMetadata & {
  aiSdkAttempted: boolean;
  aiSdkUsed: boolean;
  fallbackUsed: boolean;
  fallbackReason?: AgentProviderErrorReason | string;
  modelId: string;
  aiSdkWarnings?: string[];
  aiSdkUsage?: AgentProviderUsage;
  decisionSource: "ai_sdk_google" | "direct_gemini" | "openai_compatible";
};

export type GeminiAgentDecisionResult = {
  output: LlmAgentOutput;
  runtime: GeminiAgentDecisionRuntime;
};

function extractText(response: GeminiGenerateContentResponse) {
  return response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

function sanitizeProviderDetail(value: string) {
  return value
    .replace(/([?&][^=]*(?:key|token|secret)[^=]*=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key|authorization|bearer|token|secret)([\\":=\s]+)[^\\",\s}]+/gi, "$1$2[redacted]");
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
    if (!match) {
      throw new GeminiAgentError("Gemini 返回内容不是可解析的 JSON。", 502, "provider_invalid_json");
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new GeminiAgentError("Gemini 返回内容包含 JSON 片段，但解析失败。", 502, "provider_invalid_json");
    }
  }
}

function parseAgentOutput(text: string): LlmAgentOutput {
  const parsed = llmAgentOutputSchema.safeParse(parseJsonPayload(text));
  if (parsed.success) return parsed.data;

  const issueSummary = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");

  throw new GeminiAgentError(`Gemini Agent JSON 不符合输出 schema：${issueSummary}`, 502, "schema_validation_failed");
}

function createAgentPrompt(snapshot: unknown) {
  return [
    "你将收到 Ad Studio Agent 的结构化上下文。",
    "请只返回 JSON，不要返回 Markdown、解释或代码块。",
    "JSON 字段必须符合：message, questions, confirmation, canvasActions, briefPatch, safetyNotes。",
    "字段类型：message 是 string；questions 是表单数组；confirmation 是确认对象；canvasActions 是数组；briefPatch 是 string record；safetyNotes 是 string 数组。",
    "先判断最新用户消息属于普通对话、任务启动、已有任务补充还是执行确认。只有任务启动或已有任务补充缺信息时，才输出 questions。",
    "如果最新用户消息只是寒暄、问身份或问怎么用，即使上下文里已有产品或素材，也只用 message 自然回应，并且必须返回 questions: []、confirmation: null、canvasActions: []、briefPatch: {}。不要输出“请选择目标”之类的卡片。",
    "如果最新用户消息只是“先不要生成/先别生成/不要执行”这类执行边界，且当前没有明确广告任务，只确认不会执行生成并邀请用户说明想保存的任务；必须返回 questions: []、confirmation: null、canvasActions: []。",
    "如果信息不足，优先返回 questions。questions[].fields[] 支持 type: text, textarea, upload, product_asset, radio, checkbox；radio 可带 display: \"segmented\" 作为分段选择。",
    "需要用户上传参考广告/竞品素材时，返回 upload 字段并设置 accept 为 image/*,video/*，uploadRole 可用 competitor_asset 或 reference_asset。",
    "需要用户选择已有产品资产或粘贴产品链接解析时，返回 product_asset 字段；不要把产品缺失机械等同为必须立即填写，可以给出稍后补齐或先保存方案的可选路径。",
    "如果用户明确启动复刻任务但没有说明产品还没准备好，第一张信息卡应同时要求参考广告素材和要推广的产品；这两个字段都必须 required。只有用户明确说产品稍后补、产品还没准备好或先只保存参考素材时，产品字段才可以非必填。",
    "参考广告/竞品素材当前只支持上传图片或视频，不要要求用户提供参考广告链接；产品链接只用于解析要推广的产品。",
    "snapshot.intakeSubmissions 是用户通过交互卡提交的结构化事实，优先用它判断上一张卡是否已补齐，不要把补充消息当成新任务重开。",
    "如果 messages 里已有未提交的完整信息卡，不要重复输出同一张完整卡；如果 snapshot.intakeSubmissions 已提交过卡片，不要再次输出同一张完整卡，只问仍缺的字段。",
    "如果用户说产品还没准备好，不要强制产品字段必填；优先给稍后补产品、先保存参考素材或粘贴产品链接的路径。",
    "只有明确广告任务、上传任务素材或提交信息卡时，才在 briefPatch.originalPrompt 写广告任务原文；寒暄、身份说明和使用帮助必须保持 briefPatch: {}。",
    "message、questions、confirmation、safetyNotes 必须使用非技术用户能理解的中文，不得出现 runtime、workspace、snapshot、schema、Zod、fallbackUsed、fallbackReason、provider、LLM 决策失败、M3.2、structured fact 等内部词。",
    "除非用户正在确认执行生成或改动画布，不要反复解释不生成、不扣费、不改画布。",
    "当前版本只保留真实对话能力，不要返回 canvasActions，不要声称已经操作画布。",
    "如果需要下一步生产动作，只用 message 或 confirmation 描述方案预览和需要用户确认的点。",
    "不要生成虚假的媒体结果，不要把占位内容伪装成已完成产物。",
    "snapshot.artifacts 只包含 artifact summary、事实/建议来源、确认状态和引用 ID；不要把它当作完整脚本、分镜或 prompt 全文。",
    "",
    "Agent context:",
    JSON.stringify(snapshot)
  ].join("\n");
}

function toProviderFetchError(error: unknown, prefix: string) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new GeminiAgentError(`${prefix}：请求超时。`, 504, "provider_timeout");
  }

  const detail = error instanceof Error ? sanitizeProviderDetail(error.message) : "未知网络错误。";
  return new GeminiAgentError(`${prefix}：${detail.slice(0, 280)}`, 502, "provider_network_error");
}

function waitForRetryJitter() {
  return new Promise((resolve) => setTimeout(resolve, createProviderRetryDelayMs()));
}

function attachRetryCount(error: unknown, retryCount: number) {
  if (error instanceof GeminiAgentError) {
    error.retryCount = retryCount;
  }
  return error;
}

async function requestOfficialGeminiOnce(apiUrl: string, apiKey: string, prompt: string) {
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: AD_STUDIO_AGENT_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      }),
      signal: AbortSignal.timeout(AGENT_PROVIDER_TIMEOUT_MS)
    });
  } catch (error) {
    throw toProviderFetchError(error, "Gemini Agent 请求失败");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const reason = classifyProviderHttpStatus(response.status);
    throw new GeminiAgentError(
      `Gemini Agent 请求失败：HTTP ${response.status}${detail ? ` · ${sanitizeProviderDetail(detail).slice(0, 280)}` : ""}`,
      response.status,
      reason
    );
  }

  let payload: GeminiGenerateContentResponse;
  try {
    payload = (await response.json()) as GeminiGenerateContentResponse;
  } catch {
    throw new GeminiAgentError("Gemini Agent 响应不是可解析的 JSON。", 502, "provider_invalid_json");
  }

  if (payload.promptFeedback?.blockReason) {
    throw new GeminiAgentError(`Gemini Agent 请求被拦截：${payload.promptFeedback.blockReason}`, 422, "provider_blocked");
  }

  const text = extractText(payload);
  if (!text) {
    throw new GeminiAgentError("Gemini Agent 没有返回文本内容。", 502, "provider_empty_response");
  }

  return {
    text,
    warnings: payload.candidates?.[0]?.finishReason ? [`finishReason:${payload.candidates[0].finishReason}`] : undefined
  };
}

async function requestOfficialGemini(apiUrl: string, apiKey: string, prompt: string): Promise<ProviderTextResult> {
  let retryCount = 0;
  for (let attempt = 1; attempt <= AGENT_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      return {
        ...(await requestOfficialGeminiOnce(apiUrl, apiKey, prompt)),
        retryCount
      };
    } catch (error) {
      if (
        error instanceof GeminiAgentError &&
        attempt < AGENT_PROVIDER_MAX_ATTEMPTS &&
        isRetryableProviderReason(error.reason)
      ) {
        retryCount += 1;
        await waitForRetryJitter();
        continue;
      }
      throw attachRetryCount(error, retryCount);
    }
  }

  throw new GeminiAgentError("Gemini Agent 请求未完成。", 502, "provider_network_error", undefined, retryCount);
}

function extractOpenAiCompatibleText(payload: OpenAiCompatibleChatResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("").trim();
  }
  return "";
}

async function requestOpenAiCompatible(apiUrl: string, apiKey: string, prompt: string): Promise<ProviderTextResult> {
  let response: Response | null = null;
  let raw = "";
  let payload: OpenAiCompatibleChatResponse | null = null;
  let retryCount = 0;

  for (let attempt = 1; attempt <= AGENT_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(apiUrl, {
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
              content: [{ type: "text", text: AD_STUDIO_AGENT_SYSTEM_PROMPT }]
            },
            {
              role: "user",
              content: [{ type: "text", text: prompt }]
            }
          ],
          stream: false,
          include_thoughts: false,
          reasoning_effort: "low"
        }),
        signal: AbortSignal.timeout(AGENT_PROVIDER_TIMEOUT_MS)
      });
    } catch (error) {
      if (attempt < AGENT_PROVIDER_MAX_ATTEMPTS) {
        retryCount += 1;
        await waitForRetryJitter();
        continue;
      }
      throw attachRetryCount(toProviderFetchError(error, "Gemini OpenAI-compatible Agent 请求失败"), retryCount);
    }

    raw = await response.text();
    payload = null;
    try {
      payload = raw ? (JSON.parse(raw) as OpenAiCompatibleChatResponse) : null;
    } catch {
      // Keep payload null and use the raw response in the error below.
    }

    const reason = classifyProviderHttpStatus(response.status);
    if (response.ok || !isRetryableProviderReason(reason) || attempt === AGENT_PROVIDER_MAX_ATTEMPTS) {
      break;
    }

    retryCount += 1;
    await waitForRetryJitter();
  }

  if (!response) {
    throw new GeminiAgentError("Gemini OpenAI-compatible Agent 请求失败：未收到 provider 响应。", 502, "provider_network_error");
  }

  if (!response.ok) {
    const detail = payload?.error?.message ?? raw;
    const reason = classifyProviderHttpStatus(response.status);
    throw new GeminiAgentError(
      `Gemini OpenAI-compatible Agent 请求失败：HTTP ${response.status}${
        detail ? ` · ${sanitizeProviderDetail(detail).slice(0, 280)}` : ""
      }`,
      response.status,
      reason,
      undefined,
      retryCount
    );
  }

  if (!payload) {
    throw new GeminiAgentError("Gemini OpenAI-compatible Agent 响应不是可解析的 JSON。", 502, "provider_invalid_json", undefined, retryCount);
  }

  const text = payload ? extractOpenAiCompatibleText(payload) : "";
  if (!text) {
    throw new GeminiAgentError("Gemini OpenAI-compatible Agent 没有返回文本内容。", 502, "provider_empty_response", undefined, retryCount);
  }

  return {
    text,
    usage: normalizeProviderUsage(payload.usage),
    retryCount
  };
}

function getAiSdkSkipReason(config: ReturnType<typeof getGeminiAgentConfig>): AgentProviderErrorReason {
  if (config.aiSdkProvider === "off") return "ai_sdk_disabled";
  if (config.apiFormat === "openai") return "openai_compatible_config";
  if (config.explicitUrl && !config.aiSdkBaseUrl) return "explicit_url_without_ai_sdk_base_url";
  return "unsupported_config";
}

function createRuntimeInfo(
  config: ReturnType<typeof getGeminiAgentConfig>,
  patch: Partial<GeminiAgentDecisionRuntime>
): GeminiAgentDecisionRuntime {
  const runtimeInfo = getGeminiAgentRuntimeInfo();
  return {
    ...runtimeInfo,
    aiSdkAttempted: false,
    aiSdkUsed: false,
    fallbackUsed: false,
    model: config.model,
    modelId: config.model,
    usage: undefined,
    warnings: undefined,
    latencyMs: 0,
    retryCount: 0,
    decisionSource: config.apiFormat === "openai" ? "openai_compatible" : "direct_gemini",
    ...patch
  };
}

function createAiSdkRuntimeInfo(
  config: ReturnType<typeof getGeminiAgentConfig>,
  metadata: AgentAiSdkDecisionMetadata
) {
  return createRuntimeInfo(config, {
    aiSdkAttempted: true,
    aiSdkUsed: true,
    fallbackUsed: false,
    model: metadata.model,
    modelId: metadata.modelId,
    usage: metadata.usage,
    warnings: metadata.warnings,
    latencyMs: metadata.latencyMs,
    retryCount: metadata.retryCount,
    aiSdkWarnings: metadata.warnings,
    aiSdkUsage: metadata.usage,
    decisionSource: "ai_sdk_google"
  });
}

export async function decideWithGeminiAgentDetailed(snapshot: unknown): Promise<GeminiAgentDecisionResult> {
  const config = getGeminiAgentConfig();
  const { apiKey, apiUrl, apiFormat } = config;
  if (!apiKey) {
    throw new GeminiAgentError("Gemini Agent API key 未配置。", 503, "configuration_missing");
  }

  const startedAt = Date.now();
  const prompt = createAgentPrompt(snapshot);
  const aiSdkSupported = canUseAiSdkGoogleProvider(config);
  let aiSdkAttempted = false;
  let fallbackReason: AgentProviderErrorReason | string = getAiSdkSkipReason(config);
  let aiSdkRetryCount = 0;

  if (aiSdkSupported) {
    try {
      aiSdkAttempted = true;
      const result = await decideWithAiSdkStructuredOutput(config, prompt);
      return {
        output: result.output,
        runtime: createAiSdkRuntimeInfo(config, result.metadata)
      };
    } catch (error) {
      // Keep the direct Gemini/KIE path as compatibility fallback until provider coverage is proven.
      if (error instanceof AgentAiSdkDecisionError) {
        fallbackReason = error.reason;
        aiSdkRetryCount = error.retryCount;
        if (!error.canFallback) throw new GeminiAgentError(error.message, error.status, error.reason);
      } else {
        fallbackReason = "unknown_ai_sdk_error";
      }
    }
  }

  const providerText =
    apiFormat === "openai"
      ? await requestOpenAiCompatible(apiUrl, apiKey, prompt)
      : await requestOfficialGemini(apiUrl, apiKey, prompt);

  return {
    output: parseAgentOutput(providerText.text),
    runtime: createRuntimeInfo(config, {
      aiSdkAttempted,
      aiSdkUsed: false,
      fallbackUsed: true,
      fallbackReason,
      usage: providerText.usage,
      warnings: providerText.warnings,
      latencyMs: Date.now() - startedAt,
      retryCount: aiSdkRetryCount + providerText.retryCount,
      decisionSource: apiFormat === "openai" ? "openai_compatible" : "direct_gemini"
    })
  };
}

export async function decideWithGeminiAgent(snapshot: unknown): Promise<LlmAgentOutput> {
  const result = await decideWithGeminiAgentDetailed(snapshot);
  return result.output;
}

export { getGeminiAgentRuntimeInfo };
