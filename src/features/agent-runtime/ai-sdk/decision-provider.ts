import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { AD_STUDIO_AGENT_SYSTEM_PROMPT } from "@/features/agent-runtime/llm/agent-system-prompt";
import { llmAgentOutputSchema, type LlmAgentOutput } from "@/features/agent-runtime/llm/agent-output-schema";
import {
  canUseAiSdkGoogleProvider,
  normalizeGeminiModelId,
  type GeminiAgentConfig
} from "./model-config";
import {
  AGENT_PROVIDER_MAX_ATTEMPTS,
  AGENT_PROVIDER_TIMEOUT_MS,
  classifyProviderHttpStatus,
  createProviderRetryDelayMs,
  isRetryableProviderReason,
  normalizeProviderUsage,
  normalizeProviderWarnings,
  type AgentProviderErrorReason,
  type AgentProviderUsage
} from "./provider-metadata";

export class AgentAiSdkDecisionError extends Error {
  status: number;
  canFallback: boolean;
  reason: AgentProviderErrorReason | string;
  retryCount: number;

  constructor(
    message: string,
    status = 502,
    canFallback = true,
    reason: AgentProviderErrorReason | string = "provider_request_failed",
    retryCount = 0
  ) {
    super(message);
    this.name = "AgentAiSdkDecisionError";
    this.status = status;
    this.canFallback = canFallback;
    this.reason = reason;
    this.retryCount = retryCount;
  }
}

export type AgentAiSdkDecisionMetadata = {
  model: string;
  modelId: string;
  warnings?: string[];
  usage?: AgentProviderUsage;
  latencyMs: number;
  retryCount: number;
};

export type AgentAiSdkDecisionResult = {
  output: LlmAgentOutput;
  metadata: AgentAiSdkDecisionMetadata;
};

function toSafeError(error: unknown) {
  if (NoObjectGeneratedError.isInstance(error)) {
    const detail = error.cause instanceof Error ? error.cause.message : String(error.cause ?? "");
    const reason = /schema|validation|zod/i.test(detail) ? "schema_validation_failed" : "provider_invalid_json";
    return {
      message: `AI SDK 结构化输出未生成有效对象${detail ? `：${detail.slice(0, 220)}` : "。"}`,
      reason
    };
  }

  if (error instanceof z.ZodError) {
    return {
      message: `AI SDK 输出不符合 Agent schema：${error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
      reason: "schema_validation_failed"
    };
  }

  if (APICallError.isInstance(error)) {
    const reason = typeof error.statusCode === "number"
      ? classifyProviderHttpStatus(error.statusCode)
      : error.isRetryable
        ? "provider_network_error"
        : "provider_request_failed";
    return {
      message: error.message,
      reason,
      status: error.statusCode
    };
  }

  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return {
      message: "AI SDK Agent 请求超时。",
      reason: "provider_timeout"
    };
  }

  return {
    message: error instanceof Error ? error.message : "未知 AI SDK 错误。",
    reason: "provider_network_error"
  };
}

function waitForRetryJitter() {
  return new Promise((resolve) => setTimeout(resolve, createProviderRetryDelayMs()));
}

export async function decideWithAiSdkStructuredOutput(
  config: GeminiAgentConfig,
  prompt: string
): Promise<AgentAiSdkDecisionResult> {
  if (!canUseAiSdkGoogleProvider(config)) {
    throw new AgentAiSdkDecisionError(
      "当前 Agent 配置不适合使用 AI SDK Google provider。",
      501,
      true,
      "unsupported_config"
    );
  }

  const startedAt = Date.now();
  let retryCount = 0;
  const google = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    ...(config.aiSdkBaseUrl ? { baseURL: config.aiSdkBaseUrl } : {})
  });

  for (let attempt = 1; attempt <= AGENT_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateText({
        model: google(normalizeGeminiModelId(config.model)),
        system: AD_STUDIO_AGENT_SYSTEM_PROMPT,
        prompt,
        temperature: 0.2,
        maxRetries: 0,
        timeout: AGENT_PROVIDER_TIMEOUT_MS,
        providerOptions: {
          google: {
            structuredOutputs: false
          } satisfies GoogleLanguageModelOptions
        },
        output: Output.object({
          schema: llmAgentOutputSchema,
          name: "ad_studio_agent_decision",
          description: "Ad Studio Agent decision object for the current user turn."
        })
      });

      return {
        output: llmAgentOutputSchema.parse(result.output),
        metadata: {
          model: config.model,
          modelId: config.model,
          warnings: normalizeProviderWarnings(result.warnings),
          usage: normalizeProviderUsage(result.usage),
          latencyMs: Date.now() - startedAt,
          retryCount
        }
      };
    } catch (error) {
      const safeError = toSafeError(error);
      if (attempt < AGENT_PROVIDER_MAX_ATTEMPTS && isRetryableProviderReason(safeError.reason)) {
        retryCount += 1;
        await waitForRetryJitter();
        continue;
      }

      throw new AgentAiSdkDecisionError(
        safeError.message,
        safeError.status ?? 502,
        true,
        safeError.reason,
        retryCount
      );
    }
  }

  throw new AgentAiSdkDecisionError("AI SDK Agent 请求未完成。", 502, true, "provider_network_error", retryCount);
}
