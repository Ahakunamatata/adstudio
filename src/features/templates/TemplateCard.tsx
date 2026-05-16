"use client";

import type { Template } from "@/lib/domain/schemas";

type TemplateCardProps = {
  template: Template;
  onUse: (templateId: string) => void;
};

export function TemplateCard({ template, onUse }: TemplateCardProps) {
  return (
    <button className="template-card" type="button" onClick={() => onUse(template.id)}>
      <div className={`thumb ${template.thumbClass}`}>
        {template.label ? <div className="cutline">{template.label}</div> : null}
      </div>
      <div className="card-meta">
        <span>{template.meta[0]}</span>
        <span>{template.meta[1]}</span>
      </div>
      <h4>{template.title}</h4>
    </button>
  );
}
