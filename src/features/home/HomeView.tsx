"use client";

import { useState } from "react";
import type { AgentMode, AppRoute } from "@/lib/domain/schemas";
import type { GenerationKind } from "@/features/generation/types";
import { Launcher, type LauncherMode } from "./Launcher";
import { ProjectExamples } from "./ProjectExamples";
import { TemplateShowcase } from "./TemplateShowcase";

type HomeViewProps = {
  active: boolean;
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string) => void;
  onStartGeneration: (kind: GenerationKind, prompt: string) => void;
  onOpenTemplate: (templateId: string) => void;
};

export function HomeView({ active, onRouteChange, onStartAgent, onStartGeneration, onOpenTemplate }: HomeViewProps) {
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("agent");

  return (
    <section id="home" className={`view ${active ? "is-active" : ""}`} aria-label="Home">
      <section className="hero-band agent-hub">
        <Launcher onRouteChange={onRouteChange} onStartAgent={onStartAgent} onStartGeneration={onStartGeneration} onModeChange={setLauncherMode} />
        {launcherMode === "agent" ? <ProjectExamples /> : null}
      </section>
      <TemplateShowcase onOpenTemplate={onOpenTemplate} />
    </section>
  );
}
