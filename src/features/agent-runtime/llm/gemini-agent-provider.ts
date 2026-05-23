import type { AgentInputSnapshot } from "../agent-snapshot";
import type { AgentProviderMetadata } from "../ai-sdk/provider-metadata";
import type { LlmAgentOutput } from "./agent-output-schema";
import { llmAgentOutputSchema } from "./agent-output-schema";
import type { LlmAgentProvider } from "./llm-agent-provider";

type AgentDecideResponse = {
  output?: LlmAgentOutput;
  error?: string;
  detail?: string;
  reason?: string;
  runtime?: Partial<AgentProviderMetadata> & {
    configured: boolean;
    model: string;
    apiUrl: string;
    apiFormat?: string;
    aiSdkProvider?: string;
    aiSdkSupported?: boolean;
    aiSdkAttempted?: boolean;
    aiSdkUsed?: boolean;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    usage?: Record<string, number>;
    warnings?: string[];
    latencyMs?: number;
    retryCount?: number;
  };
};

export type GeminiAgentProviderResult = {
  output: LlmAgentOutput;
  source: "gemini";
  error?: string;
  runtime?: AgentDecideResponse["runtime"];
};

export class AgentDecideRequestError extends Error {
  status: number;
  reason?: string;
  runtime?: AgentDecideResponse["runtime"];

  constructor(message: string, input: { status: number; reason?: string; runtime?: AgentDecideResponse["runtime"] }) {
    super(message);
    this.name = "AgentDecideRequestError";
    this.status = input.status;
    this.reason = input.reason;
    this.runtime = input.runtime;
  }
}

async function readAgentDecideResponse(response: Response): Promise<AgentDecideResponse> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AgentDecideResponse;
  } catch {
    return {
      error: raw.slice(0, 500)
    };
  }
}

export async function decideWithGemini(snapshot: AgentInputSnapshot): Promise<GeminiAgentProviderResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 70_000);

  try {
    const response = await fetch("/api/agent/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ snapshot }),
      signal: controller.signal
    });

    const payload = await readAgentDecideResponse(response);
    if (!response.ok || !payload.output) {
      throw new AgentDecideRequestError(payload.error || `Agent LLM 请求失败：HTTP ${response.status}`, {
        status: response.status,
        reason: payload.reason,
        runtime: payload.runtime
      });
    }

    return {
      output: llmAgentOutputSchema.parse(payload.output),
      source: "gemini",
      runtime: payload.runtime
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AgentDecideRequestError("Agent 请求超时。请稍后重试，或先补充更短的任务描述。", {
        status: 504,
        reason: "provider_timeout"
      });
    }
    if (error instanceof TypeError) {
      throw new AgentDecideRequestError("Agent 网络连接失败。请稍后重试。", {
        status: 0,
        reason: "provider_network_error"
      });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const geminiAgentProvider: LlmAgentProvider = {
  async decide(snapshot) {
    const result = await decideWithGemini(snapshot);
    return result.output;
  }
};
