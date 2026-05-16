import {
  agentBoundaryLabels,
  defaultAgentSpecs,
  defaultCreativeGoal,
  wizardOrders
} from "@/lib/mock-data";
import type { AgentMode, AgentSession, AgentStep } from "@/lib/domain/schemas";

export function getAgentOrder(mode: AgentMode): AgentStep[] {
  return wizardOrders[mode];
}

export function getCreativeSeed(promptText: string) {
  return promptText.trim() || defaultCreativeGoal;
}

export function createAgentSession(mode: AgentMode, product = "Family Locator", promptText = ""): AgentSession {
  return {
    mode,
    currentStepIndex: 0,
    locked: false,
    product,
    competitor: "",
    focus: ["Hook", "脚本逻辑"],
    creativeGoal: getCreativeSeed(promptText),
    specs: { ...defaultAgentSpecs },
    originalPrompt: promptText
  };
}

export function formatSessionSpecs(session: AgentSession) {
  const language = session.specs.language.split(" / ").pop() ?? session.specs.language;
  return `${language} / ${session.specs.channel} / ${session.specs.ratio} / ${session.specs.duration}`;
}

export function buildAgentBrief(session: AgentSession) {
  const workType = session.mode === "clone" ? "竞品复刻" : "从 0 生成广告";
  const middle = session.mode === "clone" ? session.focus.join("、") || "重点待确认" : "创意目标待确认";
  const status = session.locked ? formatSessionSpecs(session) : "边界确认中";
  return `${session.product} · ${workType} · ${middle} · ${status}`;
}

export function getCurrentAgentStep(session: AgentSession) {
  if (session.locked) return null;
  return getAgentOrder(session.mode)[session.currentStepIndex] ?? null;
}

export function getStepLabel(step: AgentStep) {
  return agentBoundaryLabels[step];
}
