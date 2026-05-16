"use client";

import { useState } from "react";
import { templateCategories, templates } from "@/lib/mock-data";
import { TemplateCard } from "./TemplateCard";

type TemplatesViewProps = {
  active: boolean;
  onUseTemplate: (templateId: string) => void;
};

export function TemplatesView({ active, onUseTemplate }: TemplatesViewProps) {
  const [activeFilter, setActiveFilter] = useState("all");
  const visibleTemplates =
    activeFilter === "all" ? templates : templates.filter((template) => template.categoryIds.includes(activeFilter));

  return (
    <section id="templates" className={`view ${active ? "is-active" : ""}`} aria-label="Templates">
      <section className="section-band">
        <div className="section-head">
          <div>
            <h2>Templates</h2>
            <p>按渠道、产品类型和素材形态筛选，点击后进入预填表单。</p>
          </div>
        </div>
        <div className="filter-row">
          <button className={`chip ${activeFilter === "all" ? "is-selected" : ""}`} type="button" onClick={() => setActiveFilter("all")}>
            全部
          </button>
          {templateCategories.map((category) => (
            <button
              className={`chip ${activeFilter === category.id ? "is-selected" : ""}`}
              type="button"
              key={category.id}
              onClick={() => setActiveFilter(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
        <div className="template-grid large">
          {visibleTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} onUse={onUseTemplate} />
          ))}
        </div>
      </section>
    </section>
  );
}
