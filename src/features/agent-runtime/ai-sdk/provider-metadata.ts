export type AgentApiFormat = "gemini" | "openai";

export type AgentDecisionSource = "ai_sdk_google" | "direct_gemini" | "openai_compatible";

export type AgentProviderErrorReason =
  | "configuration_missing"
  | "provider_timeout"
  | "provider_network_error"
  | "provider_invalid_json"
  | "schema_validation_failed"
  | "provider_rate_limited"
  | "provider_bad_gateway"
  | "route_unhandled_error"
  | "unsupported_config"
  | "openai_compatible_config"
  | "ai_sdk_disabled"
  | "explicit_url_without_ai_sdk_base_url"
  | "unknown_ai_sdk_error"
  | "provider_blocked"
  | "provider_empty_response"
  | "provider_request_failed";

export type AgentProviderUsage = Record<string, number>;

export type AgentProviderMetadata = {
  model: string;
  apiFormat: AgentApiFormat;
  decisionSource: AgentDecisionSource;
  aiSdkAttempted: boolean;
  aiSdkUsed: boolean;
  fallbackUsed: boolean;
  fallbackReason?: AgentProviderErrorReason | string;
  usage?: AgentProviderUsage;
  warnings?: string[];
  latencyMs: number;
  retryCount: number;
};

export const AGENT_PROVIDER_TIMEOUT_MS = 58_000;
export const AGENT_PROVIDER_MAX_ATTEMPTS = 2;

export function normalizeProviderWarnings(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const warnings = value
    .map((warning) => {
      if (typeof warning === "string") return warning.slice(0, 240);
      if (warning && typeof warning === "object" && "message" in warning) {
        return String((warning as { message?: unknown }).message ?? "").slice(0, 240);
      }
      return String(warning).slice(0, 240);
    })
    .filter(Boolean);
  return warnings.length ? warnings : undefined;
}

export function normalizeProviderUsage(value: unknown): AgentProviderUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: AgentProviderUsage = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function classifyProviderHttpStatus(status: number): AgentProviderErrorReason {
  if (status === 429) return "provider_rate_limited";
  if (status === 502) return "provider_bad_gateway";
  if (status === 504 || status === 408) return "provider_timeout";
  return "provider_request_failed";
}

export function isRetryableProviderReason(reason: string | undefined) {
  return (
    reason === "provider_timeout" ||
    reason === "provider_network_error" ||
    reason === "provider_rate_limited" ||
    reason === "provider_bad_gateway"
  );
}

export function createProviderRetryDelayMs() {
  return 350 + Math.floor(Math.random() * 450);
}
