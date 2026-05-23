import {
  agentBoundaryLabels,
  defaultAgentSpecs,
  wizardOrders
} from "@/lib/mock-data";
import type {
  AgentMode,
  AgentProjectKind,
  AgentProjectLifecycle,
  AgentSession,
  AgentSpecs,
  AgentStep,
  AgentUploadedAsset
} from "@/lib/domain/schemas";

const placeholderProductNames = new Set(["未指定产品", "待识别产品"]);

export const emptyAgentSpecs: AgentSpecs = {
  language: "",
  channel: "",
  ratio: "",
  duration: ""
};

function createSessionId() {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getAgentOrder(mode: AgentMode): AgentStep[] {
  return wizardOrders[mode];
}

export function getCreativeSeed(promptText: string) {
  return promptText.trim();
}

export function createDefaultAgentAssets(product = ""): AgentUploadedAsset[] {
  const productName = product.trim();
  if (!productName || placeholderProductNames.has(productName)) return [];

  return [
    {
      id: "asset-product-pack",
      role: "product_pack",
      name: productName,
      kind: "product",
      source: "default"
    }
  ];
}

export function isPlaceholderAgentProduct(product: string) {
  const normalized = product.trim();
  return !normalized || placeholderProductNames.has(normalized);
}

function isOnlyDefaultProductAsset(asset: AgentUploadedAsset) {
  return asset.role === "product_pack" && asset.source === "default";
}

function hasTaskStartingAssets(uploadedAssets: AgentUploadedAsset[]) {
  return uploadedAssets.some((asset) => asset.role === "competitor_asset" || asset.role === "reference_asset");
}

function hasMeaningfulAssets(uploadedAssets: AgentUploadedAsset[]) {
  return uploadedAssets.some((asset) => !isOnlyDefaultProductAsset(asset));
}

function resolveInitialLifecycle(
  projectKind: AgentProjectKind,
  promptText: string,
  uploadedAssets: AgentUploadedAsset[]
): AgentProjectLifecycle {
  if (projectKind === "demo") return "ready";
  if (promptText.trim() || hasTaskStartingAssets(uploadedAssets)) return "intake";
  return "empty";
}

export function getAgentProjectLifecycle(session: AgentSession): AgentProjectLifecycle {
  if (session.lifecycle) return session.lifecycle;
  if (session.projectKind === "demo") return "ready";
  if (session.originalPrompt?.trim() || hasMeaningfulAssets(session.uploadedAssets ?? [])) return "intake";
  return "empty";
}

export function hasAgentStartupContext(session: AgentSession) {
  return Boolean(session.originalPrompt.trim() || hasTaskStartingAssets(session.uploadedAssets));
}

function hasDefaultSpecs(specs: AgentSpecs) {
  return (
    specs.language === defaultAgentSpecs.language &&
    specs.channel === defaultAgentSpecs.channel &&
    specs.ratio === defaultAgentSpecs.ratio &&
    specs.duration === defaultAgentSpecs.duration
  );
}

function isLegacySeededBlankSession(session: AgentSession) {
  return (
    session.projectKind === "blank" &&
    !session.originalPrompt.trim() &&
    (isPlaceholderAgentProduct(session.product) || session.product === "Family Locator") &&
    hasDefaultSpecs(session.specs) &&
    !hasMeaningfulAssets(session.uploadedAssets ?? [])
  );
}

export function normalizeAgentSession(session: AgentSession): AgentSession {
  if (isLegacySeededBlankSession(session)) {
    return createAgentSession(session.mode, "", "", [], "blank", session.id);
  }

  return {
    ...session,
    projectTitle: session.projectTitle?.trim() || "未命名项目",
    lifecycle: getAgentProjectLifecycle(session),
    product: isPlaceholderAgentProduct(session.product) ? "" : session.product,
    uploadedAssets: session.uploadedAssets ?? []
  };
}

export function createAgentSession(
  mode: AgentMode,
  product = "",
  promptText = "",
  uploadedAssets: AgentUploadedAsset[] = createDefaultAgentAssets(product),
  projectKind: AgentProjectKind = "blank",
  sessionId = createSessionId()
): AgentSession {
  const productName = product.trim();
  const competitorAsset = uploadedAssets.find((asset) => asset.role === "competitor_asset");
  const lifecycle = resolveInitialLifecycle(projectKind, promptText, uploadedAssets);

  return {
    id: sessionId,
    projectTitle: "未命名项目",
    projectKind,
    lifecycle,
    mode,
    currentStepIndex: 0,
    locked: false,
    product: isPlaceholderAgentProduct(productName) ? "" : productName,
    competitor: competitorAsset?.name ?? "",
    focus: lifecycle === "empty" ? [] : ["Hook", "脚本逻辑"],
    creativeGoal: getCreativeSeed(promptText),
    specs: projectKind === "demo" ? { ...defaultAgentSpecs } : { ...emptyAgentSpecs },
    originalPrompt: promptText,
    uploadedAssets
  };
}

export function createDemoAgentSession(): AgentSession {
  return createAgentSession(
    "clone",
    "Family Locator",
    "Demo：复刻 Family Locator 泰语安全焦虑广告，9:16 TikTok 15s。严格复刻剧情结构，生活场景为主，App 作为解决方案出现，需要泰语配音和硬字幕。",
    [
      ...createDefaultAgentAssets("Family Locator"),
      {
        id: "asset-demo-competitor",
        role: "competitor_asset",
        name: "demo_family_locator_competitor.mp4",
        kind: "video",
        source: "mock"
      }
    ],
    "demo"
  );
}

export function formatSessionSpecs(session: AgentSession) {
  const language = session.specs.language.split(" / ").pop() ?? session.specs.language;
  const parts = [language, session.specs.channel, session.specs.ratio, session.specs.duration].filter(Boolean);
  return parts.length ? parts.join(" / ") : "规格待确认";
}

export function buildAgentBrief(session: AgentSession) {
  const workType = session.mode === "clone" ? "竞品复刻" : "从 0 生成广告";
  const middle = session.mode === "clone" ? session.focus.join("、") || "重点待确认" : "创意目标待确认";
  const status = session.locked ? formatSessionSpecs(session) : "边界确认中";
  return `${session.product || "未指定产品"} · ${workType} · ${middle} · ${status}`;
}

export function getCurrentAgentStep(session: AgentSession) {
  if (session.locked) return null;
  return getAgentOrder(session.mode)[session.currentStepIndex] ?? null;
}

export function getStepLabel(step: AgentStep) {
  return agentBoundaryLabels[step];
}
