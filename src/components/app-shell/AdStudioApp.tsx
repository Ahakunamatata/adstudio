"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentMode, AgentSession, AppRoute, CanvasNode } from "@/lib/domain/schemas";
import {
  createInitialGenerationState,
  createMockGenerationSlotInput,
  generationDefaults,
  getDefaultGenerationParamValues,
  getGenerationModel,
  templateMap
} from "@/lib/mock-data";
import { AgentSetupView } from "@/features/agent/AgentSetupView";
import { AgentView } from "@/features/agent/AgentView";
import { createAgentSession } from "@/features/agent/agent-session";
import { AssetsView } from "@/features/assets/AssetsView";
import { GenerationView } from "@/features/generation/GenerationView";
import type { GenerationKind, GenerationModeKey, GenerationSlotKey, GenerationState, SingleGenerationState } from "@/features/generation/types";
import { HomeView } from "@/features/home/HomeView";
import { TemplatesView } from "@/features/templates/TemplatesView";
import { AgentWorkbenchView } from "@/features/workbench/AgentWorkbenchView";
import { AppShell } from "./AppShell";

type GenerationStateUpdater = SingleGenerationState | ((current: SingleGenerationState) => SingleGenerationState);

const templateSlotAliases: Partial<Record<string, GenerationSlotKey>> = {
  app_ui: "product_image",
  avatar_style: "reference_image",
  gameplay: "reference_video",
  old_way: "reference_video",
  new_way: "reference_video",
  product_image: "product_image",
  proof: "reference_image",
  style: "style_reference"
};

function getTemplateModelId(kind: GenerationKind, recommendedModel: string) {
  const catalog = generationDefaults[kind];
  return (
    catalog.models.find((model) => model.displayName === recommendedModel)?.id ??
    catalog.models.find((model) => recommendedModel.includes(model.displayName))?.id ??
    catalog.models.find((model) => model.defaultForKind)?.id ??
    catalog.models[0].id
  );
}

function getTemplateMode(kind: GenerationKind, slotKeys: GenerationSlotKey[]): GenerationModeKey {
  if (kind === "image") {
    return slotKeys.length ? "image-reference" : "text-to-image";
  }
  if (slotKeys.includes("reference_video") || slotKeys.includes("reference_image")) return "reference";
  if (slotKeys.includes("start_frame") || slotKeys.includes("end_frame")) return "first-last-frame";
  if (slotKeys.includes("product_image")) return "image-to-video";
  return "text-to-video";
}

function mapTemplateSlots(kind: GenerationKind, requiredSlots: string[]) {
  const supportedSlotKeys = new Set(generationDefaults[kind].slots.map((slot) => slot.key));
  const seen = new Set<GenerationSlotKey>();
  return requiredSlots.flatMap((slotId, index) => {
    const slotKey = (templateSlotAliases[slotId] ?? slotId) as GenerationSlotKey;
    if (seen.has(slotKey) || !supportedSlotKeys.has(slotKey)) return [];
    seen.add(slotKey);
    const slot = createMockGenerationSlotInput(kind, slotKey, index);
    return slot ? [slot] : [];
  });
}

export function AdStudioApp() {
  const [route, setRoute] = useState<AppRoute>("home");
  const [selectedProduct, setSelectedProduct] = useState("Family Locator");
  const [setupMode, setSetupMode] = useState<AgentMode>("clone");
  const [setupKey, setSetupKey] = useState(0);
  const [agentSession, setAgentSession] = useState<AgentSession>(() => createAgentSession("clone", "Family Locator"));
  const [generationState, setGenerationState] = useState<GenerationState>(() => createInitialGenerationState());
  const [drawerNode, setDrawerNode] = useState<CanvasNode | null>(null);
  const [toastText, setToastText] = useState("已套用模板");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number | null>(null);

  function showToast(text: string) {
    setToastText(text);
    setToastVisible(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), 1800);
  }

  function goRoute(nextRoute: AppRoute) {
    setRoute(nextRoute);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function startAgent(mode: AgentMode, prompt = "") {
    setSetupMode(mode);
    setAgentSession(createAgentSession(mode, selectedProduct, prompt));
    goRoute("workbench");
  }

  function startGeneration(kind: GenerationKind, prompt: string) {
    setGenerationState((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        prompt
      }
    }));
    goRoute(kind);
  }

  function startSetup(mode: AgentMode) {
    setSetupMode(mode);
    setSetupKey((key) => key + 1);
    goRoute("agent-setup");
  }

  function startWorkbench(session: AgentSession) {
    setSelectedProduct(session.product);
    setAgentSession(session);
    goRoute("workbench");
  }

  function applyTemplate(templateId: string) {
    const template = templateMap[templateId];
    if (!template) return;
    const modelId = getTemplateModelId(template.route, template.recommendedModel);
    const model = getGenerationModel(template.route, modelId);
    const slots = mapTemplateSlots(template.route, template.requiredSlots);
    const modeKey = getTemplateMode(template.route, slots.map((slot) => slot.slotKey));
    setGenerationState((current) => ({
      ...current,
      [template.route]: {
        ...current[template.route],
        prompt: template.prompt,
        modelId,
        modeKey: model.modeKeys.includes(modeKey) ? modeKey : model.defaultModeKey,
        paramValues: {
          ...getDefaultGenerationParamValues(model),
          ratio: template.defaultRatio,
          ...(template.defaultDuration ? { duration: template.defaultDuration } : {})
        },
        slots
      }
    }));
    goRoute(template.route);
    showToast(template.toast);
  }

  function updateGeneration(kind: GenerationKind, nextState: GenerationStateUpdater) {
    setGenerationState((current) => ({
      ...current,
      [kind]: typeof nextState === "function" ? nextState(current[kind]) : nextState
    }));
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <AppShell
      route={route}
      drawerNode={drawerNode}
      toastText={toastText}
      toastVisible={toastVisible}
      onRouteChange={goRoute}
      onCloseDrawer={() => setDrawerNode(null)}
    >
      <HomeView
        active={route === "home"}
        onRouteChange={goRoute}
        onStartAgent={startAgent}
        onStartGeneration={startGeneration}
        onUseTemplate={applyTemplate}
      />
      <AgentView
        active={route === "agent"}
        onRouteChange={goRoute}
        onStartAgent={startAgent}
        onStartSetup={startSetup}
      />
      <AgentSetupView
        key={setupKey}
        active={route === "agent-setup"}
        mode={setupMode}
        selectedProduct={selectedProduct}
        onProductChange={setSelectedProduct}
        onCancel={() => goRoute("agent")}
        onStartWorkbench={startWorkbench}
      />
      <AgentWorkbenchView
        active={route === "workbench"}
        session={agentSession}
        onSessionChange={setAgentSession}
        onNodeOpen={setDrawerNode}
      />
      <GenerationView
        active={route === "video"}
        kind="video"
        state={generationState.video}
        onStateChange={updateGeneration}
        onRouteChange={goRoute}
        onToast={showToast}
      />
      <GenerationView
        active={route === "image"}
        kind="image"
        state={generationState.image}
        onStateChange={updateGeneration}
        onRouteChange={goRoute}
        onToast={showToast}
      />
      <TemplatesView active={route === "templates"} onUseTemplate={applyTemplate} />
      <AssetsView active={route === "assets"} onStartAgent={startAgent} />
    </AppShell>
  );
}
