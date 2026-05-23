"use client";

import { useState } from "react";
import type { AgentMode, AgentUploadedAsset, AppRoute } from "@/lib/domain/schemas";
import type { GenerationDraft, GenerationKind } from "@/features/generation/types";
import { Launcher, type LauncherMode } from "./Launcher";
import { ProjectExamples } from "./ProjectExamples";
import { TemplateShowcase } from "./TemplateShowcase";

type HomeViewProps = {
  active: boolean;
  ready?: boolean;
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string, uploadedAssets?: AgentUploadedAsset[]) => void;
  onStartGeneration: (kind: GenerationKind, draft: GenerationDraft) => void;
  onUseTemplate: (templateId: string) => void;
  onOpenDemoAgent: () => void;
};

export function HomeView({ active, ready = true, onRouteChange, onStartAgent, onStartGeneration, onUseTemplate, onOpenDemoAgent }: HomeViewProps) {
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("agent");

  return (
    <section id="home" className={`view ${active ? "is-active" : ""}`} aria-label="Home">
      <section className="hero-band agent-hub">
        <Launcher
          ready={ready}
          onRouteChange={onRouteChange}
          onStartAgent={onStartAgent}
          onStartGeneration={onStartGeneration}
          onModeChange={setLauncherMode}
        />
        {launcherMode === "agent" ? <ProjectExamples onOpenDemoAgent={onOpenDemoAgent} /> : null}
      </section>
      <TemplateShowcase onUseTemplate={onUseTemplate} />
    </section>
  );
}
