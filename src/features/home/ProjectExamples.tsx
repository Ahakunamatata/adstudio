"use client";

import { projectExamples } from "@/lib/mock-data";

type ProjectExamplesProps = {
  onOpenDemoAgent: () => void;
};

const PROJECT_EXAMPLE_SLOT_COUNT = 5;

export function ProjectExamples({ onOpenDemoAgent }: ProjectExamplesProps) {
  const exampleSlots = Array.from({ length: PROJECT_EXAMPLE_SLOT_COUNT }, (_, index) => {
    const example = projectExamples[index];

    if (example) {
      return { ...example, isPlaceholder: false };
    }

    return {
      title: "项目占位",
      subtitle: "等待补充 Agent Demo 资产",
      label: `Slot ${index + 1}`,
      className: "placeholder",
      isPlaceholder: true
    };
  });

  return (
    <div className="agent-proof">
      <div className="section-head">
        <div>
          <h3>Agent Demo 项目</h3>
        </div>
      </div>
      <div className="example-row">
        {exampleSlots.map((example, index) => {
          const previewClassName = ["example-preview", example.className].filter(Boolean).join(" ");

          if (example.isPlaceholder) {
            return (
              <article className="example-card is-placeholder" key={`project-placeholder-${index + 1}`} aria-label={`Agent Demo 项目占位 ${index + 1}`}>
                <div className={previewClassName}>
                  <span>{example.label}</span>
                  <div className="mini-node n1" />
                  <div className="mini-node n2" />
                  <div className="mini-node n3" />
                </div>
                <h4>{example.title}</h4>
                <p>{example.subtitle}</p>
              </article>
            );
          }

          return (
            <button className="example-card" key={example.title} type="button" onClick={onOpenDemoAgent}>
              <div className={previewClassName}>
                <span>{example.label}</span>
                <div className="mini-node n1" />
                <div className="mini-node n2" />
                <div className="mini-node n3" />
              </div>
              <h4>{example.title}</h4>
              <p>{example.subtitle}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
