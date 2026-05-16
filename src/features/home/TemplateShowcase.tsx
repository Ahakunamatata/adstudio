"use client";

import { useEffect, useMemo, useState } from "react";
import type { Template } from "@/lib/domain/schemas";
import { templateCategories, templates } from "@/lib/mock-data";
import { TemplateCard } from "@/features/templates/TemplateCard";

type TemplateShowcaseProps = {
  onUseTemplate: (templateId: string) => void;
};

const templateVariants = ["Hook", "口播版", "商品演示", "对比版", "转化版", "本地化", "短 CTA", "开场测试"];

function getCategorySectionId(categoryId: string) {
  return `template-category-${categoryId}`;
}

function buildCategoryTemplates(categoryId: string) {
  const categoryTemplates = templates.filter((template) => template.categoryIds.includes(categoryId));
  const itemCount = Math.max(8, categoryTemplates.length * 2);

  return Array.from({ length: itemCount }, (_, index) => {
    const template = categoryTemplates[index % categoryTemplates.length];
    const variant = templateVariants[index % templateVariants.length];

    return {
      key: `${categoryId}-${template.id}-${index}`,
      template: {
        ...template,
        title: index < categoryTemplates.length ? template.title : `${template.title} · ${variant}`
      } satisfies Template
    };
  });
}

export function TemplateShowcase({ onUseTemplate }: TemplateShowcaseProps) {
  const [activeCategory, setActiveCategory] = useState("tiktok");
  const categorySections = useMemo(
    () =>
      templateCategories.map((category) => ({
        ...category,
        templates: buildCategoryTemplates(category.id)
      })),
    []
  );

  useEffect(() => {
    let frame = 0;

    function syncActiveCategory() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const anchorY = window.innerHeight * 0.32;
        const isNearPageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8;
        const current =
          (isNearPageBottom ? templateCategories[templateCategories.length - 1] : undefined) ??
          templateCategories.find((category) => {
            const section = document.getElementById(getCategorySectionId(category.id));
            if (!section) return false;
            const rect = section.getBoundingClientRect();
            return rect.top <= anchorY && rect.bottom > anchorY;
          }) ?? templateCategories[0];

        setActiveCategory(current.id);
      });
    }

    syncActiveCategory();
    window.addEventListener("scroll", syncActiveCategory, { passive: true });
    window.addEventListener("resize", syncActiveCategory);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", syncActiveCategory);
      window.removeEventListener("resize", syncActiveCategory);
    };
  }, []);

  return (
    <section className="section-band template-showcase" id="home-templates">
      <div className="section-head">
        <div>
          <h3>模板区</h3>
        </div>
      </div>
      <div className="filter-row template-tabs" aria-label="模板顶部分类">
        {templateCategories.map((category) => (
          <a
            key={category.id}
            href={`#${getCategorySectionId(category.id)}`}
            className={`chip ${activeCategory === category.id ? "is-selected" : ""}`}
            onClick={() => setActiveCategory(category.id)}
          >
            {category.label}
          </a>
        ))}
      </div>
      <div className="template-browser">
        <div className="template-category-list">
          {categorySections.map((category) => (
            <section className="template-category" id={getCategorySectionId(category.id)} key={category.id}>
              <div className="template-category-head">
                <h4>{category.label}</h4>
              </div>
              <div className="template-grid">
                {category.templates.map((item) => (
                  <TemplateCard key={item.key} template={item.template} onUse={onUseTemplate} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
