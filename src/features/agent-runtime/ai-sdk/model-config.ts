import fs from "node:fs";
import path from "node:path";

export type AgentApiFormat = "gemini" | "openai";

export type GeminiAgentConfig = {
  apiKey: string;
  model: string;
  apiUrl: string;
  apiFormat: AgentApiFormat;
  explicitUrl: string;
  aiSdkProvider: "google" | "off";
  aiSdkBaseUrl: string;
};

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
          return JSON.parse(rawValue);
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

function sanitizeRuntimeUrl(value: string) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    if (url.search) url.search = "?redacted";
    return url.toString();
  } catch {
    return value.replace(/([?&][^=]*(?:key|token|secret)[^=]*=)[^&]+/gi, "$1[redacted]");
  }
}

function getAiSdkProvider(): GeminiAgentConfig["aiSdkProvider"] {
  const value = getEnvValue("AD_STUDIO_AGENT_AI_SDK_PROVIDER", "GEMINI_AGENT_AI_SDK_PROVIDER")
    .trim()
    .toLowerCase();

  if (value === "off" || value === "false" || value === "0") return "off";
  return "google";
}

export function normalizeGeminiModelId(model: string) {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

export function getGeminiAgentConfig(): GeminiAgentConfig {
  const apiKey = getEnvValue("GEMINI_AGENT_API_KEY", "GEMINI_API_KEY");
  const model = getEnvValue("GEMINI_AGENT_MODEL", "GEMINI_MODEL") || "gemini-3-flash";
  const explicitUrl = getEnvValue("GEMINI_AGENT_API_URL", "GEMINI_API_URL");
  const explicitFormat = getEnvValue("GEMINI_AGENT_API_FORMAT", "GEMINI_API_FORMAT");
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const apiUrl =
    explicitUrl ||
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
  const apiFormat: AgentApiFormat =
    explicitFormat === "openai" || apiUrl.includes("/chat/completions") ? "openai" : "gemini";

  return {
    apiKey,
    model,
    apiUrl,
    apiFormat,
    explicitUrl,
    aiSdkProvider: getAiSdkProvider(),
    aiSdkBaseUrl: getEnvValue("AD_STUDIO_AGENT_AI_SDK_BASE_URL", "GEMINI_AGENT_AI_SDK_BASE_URL")
  };
}

export function canUseAiSdkGoogleProvider(config: GeminiAgentConfig) {
  if (config.aiSdkProvider === "off") return false;
  if (config.apiFormat !== "gemini") return false;
  return !config.explicitUrl || Boolean(config.aiSdkBaseUrl);
}

export function getGeminiAgentRuntimeInfo() {
  const config = getGeminiAgentConfig();
  return {
    configured: Boolean(config.apiKey),
    model: config.model,
    apiUrl: sanitizeRuntimeUrl(config.apiUrl),
    apiFormat: config.apiFormat,
    aiSdkProvider: config.aiSdkProvider,
    aiSdkSupported: canUseAiSdkGoogleProvider(config)
  };
}
