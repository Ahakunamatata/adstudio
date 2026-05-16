"use client";

import type { AgentMode, AppRoute } from "@/lib/domain/schemas";
import type { GenerationKind } from "@/features/generation/types";
import { Launcher } from "./Launcher";
import { ProjectExamples } from "./ProjectExamples";
import { TemplateShowcase } from "./TemplateShowcase";

type HomeViewProps = {
  active: boolean;
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string) => void;
  onStartGeneration: (kind: GenerationKind, prompt: string) => void;
  onUseTemplate: (templateId: string) => void;
};

export function HomeView({ active, onRouteChange, onStartAgent, onStartGeneration, onUseTemplate }: HomeViewProps) {
  return (
    <section id="home" className={`view ${active ? "is-active" : ""}`} aria-label="Home">
      <section className="hero-band agent-hub">
        <Launcher onRouteChange={onRouteChange} onStartAgent={onStartAgent} onStartGeneration={onStartGeneration} />
        <ProjectExamples />
      </section>
      <TemplateShowcase onUseTemplate={onUseTemplate} />
    </section>
  );
}
