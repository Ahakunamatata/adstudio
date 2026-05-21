"use client";

import type { Template } from "@/lib/domain/schemas";

type TemplateCardProps = {
  template: Template;
  onOpen: (templateId: string) => void;
};

export function TemplateCard({ template, onOpen }: TemplateCardProps) {
  return (
    <button className="template-card" type="button" onClick={() => onOpen(template.id)}>
      <div className={`thumb ${template.thumbClass}`}>
        {template.label ? <div className="cutline">{template.label}</div> : null}
      </div>
      <div className="card-meta">
        <span>{template.meta[0]}</span>
        <span>{template.meta[1]}</span>
      </div>
      <h4>{template.title}</h4>
      {template.schema || template.verificationStatus ? (
        <div className="template-card-tags">
          {template.schema ? <span>{template.schema}</span> : null}
          {template.verificationStatus ? <span>{template.verificationStatus}</span> : null}
        </div>
      ) : null}
    </button>
  );
}
