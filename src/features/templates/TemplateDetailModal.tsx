"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Image as ImageIcon, WandSparkles, X } from "lucide-react";
import type { Template, TemplateRichTextToken } from "@/lib/domain/schemas";
import { getProductTemplateSlotValues } from "@/lib/mock-data/products";
import type { ProductTemplateSlotMap } from "@/lib/mock-data/products";

type TemplateDetailModalProps = {
  productName: string;
  template: Template | null;
  onClose: () => void;
  onUseTemplate: (templateId: string, promptOverride?: string) => void;
};

type SlotValues = Record<string, string>;

function collectSlotDefaults(template: Template | null, productSlotValues: ProductTemplateSlotMap) {
  const defaults: SlotValues = {};
  if (!template) return defaults;
  const tokenGroups = [
    ...(template.scriptBlocks ?? []).flatMap((block) => block.content),
    ...(template.slotTokens ?? [])
  ];

  tokenGroups.forEach((token) => {
    if (token.type === "slot" && defaults[token.key] === undefined) {
      defaults[token.key] = token.source === "product_pack" ? productSlotValues[token.key] ?? token.value : token.value;
    }
  });

  return defaults;
}

function renderTokenAsText(token: TemplateRichTextToken, slotValues: SlotValues) {
  if (token.type === "text") return token.value;
  if (token.type === "slot") return slotValues[token.key] ?? token.value;
  return token.label;
}

function buildTemplatePrompt(template: Template, slotValues: SlotValues) {
  if (!template.scriptBlocks?.length) return template.prompt;

  const script = template.scriptBlocks
    .map((block) => {
      const timeRange = block.startSec === block.endSec ? "" : ` (${block.startSec}-${block.endSec}s)`;
      const content = block.content.map((token) => renderTokenAsText(token, slotValues)).join("");
      return `[${block.label}${timeRange}]: ${content}`;
    })
    .join("\n");

  return `${template.prompt}\n\n${script}`;
}

export function TemplateDetailModal({ productName, template, onClose, onUseTemplate }: TemplateDetailModalProps) {
  const [slotState, setSlotState] = useState<{ templateId: string | null; values: SlotValues }>({ templateId: null, values: {} });
  const productSlotValues = useMemo(() => getProductTemplateSlotValues(productName), [productName]);
  const slotDefaults = useMemo(() => collectSlotDefaults(template, productSlotValues), [productSlotValues, template]);

  useEffect(() => {
    if (!template) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, template]);

  if (!template) return null;

  const activeTemplate = template;
  const slotValues = slotState.templateId === activeTemplate.id ? slotState.values : slotDefaults;
  const promptPreview = buildTemplatePrompt(activeTemplate, slotValues);
  const hasScript = Boolean(activeTemplate.scriptBlocks?.length);
  const creditsLabel = template.credits?.replace(/\s*credits$/i, "") ?? "TBD";

  function setSlotValue(key: string, value: string) {
    setSlotState({ templateId: activeTemplate.id, values: { ...slotValues, [key]: value } });
  }

  function renderRichToken(token: TemplateRichTextToken, key: string) {
    if (token.type === "text") {
      return <span key={key}>{token.value}</span>;
    }

    if (token.type === "asset") {
      return (
        <span className="template-asset-token" key={key}>
          {token.label}
        </span>
      );
    }

    const value = slotValues[token.key] ?? token.value;
    return (
      <input
        className="template-slot-token"
        aria-label={token.label}
        key={key}
        size={Math.max(value.length, 4)}
        value={value}
        onChange={(event) => setSlotValue(token.key, event.target.value)}
      />
    );
  }

  function renderScriptProse() {
    if (!hasScript) return activeTemplate.prompt;

    return activeTemplate.scriptBlocks?.flatMap((block, blockIndex) => {
      const renderedTokens = block.content.map((token, tokenIndex) =>
        renderRichToken(token, `${block.label}-${block.startSec}-${token.type}-${tokenIndex}`)
      );

      if (blockIndex === (activeTemplate.scriptBlocks?.length ?? 0) - 1) {
        return renderedTokens;
      }

      return [...renderedTokens, <span key={`block-space-${block.label}-${blockIndex}`}> </span>];
    });
  }

  return (
    <div
      className="template-detail-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label={`${template.title} template detail`}
      onClick={onClose}
    >
      <button className="template-detail-close icon-btn" type="button" aria-label="关闭模板详情" onClick={onClose}>
        <X size={18} />
      </button>

      <div className="template-detail-shell" onClick={(event) => event.stopPropagation()}>
        <section className="template-detail-preview">
          <div className={`template-video-frame ${template.thumbClass}`}>
            <div className="template-video-topline">
              <span className="template-video-duration">{template.defaultDuration ?? "15s"}</span>
            </div>
            <div className="template-video-progress" />
          </div>
        </section>

        <section className="template-detail-panel ai-template-panel">
          <header className="template-detail-head">
            <div>
              <h2>{template.title}</h2>
              <p className="template-detail-desc">{template.summary}</p>
            </div>
            <span className="template-verify-badge"><BadgeCheck size={15} /> {template.verificationStatus ?? "Prompt tested"}</span>
          </header>

          {(template.referenceAssets ?? []).length ? (
            <div className="template-reference-section">
              <div className="template-reference-label">参考素材</div>
              <div className="template-reference-strip">
                {(template.referenceAssets ?? []).map((asset) => (
                  <div className="template-reference-item" key={asset.key}>
                    <span style={asset.previewUrl ? { backgroundImage: `url(${asset.previewUrl})` } : undefined}>
                      {!asset.previewUrl ? <ImageIcon size={16} /> : null}
                    </span>
                    <small>{asset.label}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="template-script-label-row">
            <span className="template-script-label-text">提示词</span>
            <span className="template-script-label-hint">按需编辑绿色文字</span>
            <span className="template-script-lang">English ▾</span>
          </div>

          <p className="template-script-prose">{renderScriptProse()}</p>

          <div className="template-detail-bottombar">
            <div className="template-detail-params">
              <span className="param-pill">
                {template.recommendedModel} <span className="caret">▾</span>
              </span>
              <span className="param-pill">
                {template.defaultRatio} <span className="caret">▾</span>
              </span>
              <span className="param-pill">
                {template.defaultDuration ?? "-"} <span className="caret">▾</span>
              </span>
              <span className="param-credit">✨ {creditsLabel}</span>
            </div>
            <button
              className="primary-btn template-detail-generate"
              type="button"
              onClick={() => {
                onUseTemplate(template.id, promptPreview);
                onClose();
              }}
            >
              <WandSparkles size={16} /> 使用模板生成
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
