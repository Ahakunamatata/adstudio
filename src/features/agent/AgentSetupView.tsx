"use client";

import { useMemo, useState } from "react";
import type { AgentMode, AgentSession, AgentSpecs } from "@/lib/domain/schemas";
import {
  defaultAgentSpecs,
  defaultCreativeGoal,
  focusOptions,
  products,
  specOptions,
  wizardCopy
} from "@/lib/mock-data";
import { createAgentSession, createDefaultAgentAssets, formatSessionSpecs, getAgentOrder } from "./agent-session";

type AgentSetupViewProps = {
  active: boolean;
  mode: AgentMode;
  selectedProduct: string;
  onProductChange: (product: string) => void;
  onCancel: () => void;
  onStartWorkbench: (session: AgentSession) => void;
};

export function AgentSetupView({
  active,
  mode,
  selectedProduct,
  onProductChange,
  onCancel,
  onStartWorkbench
}: AgentSetupViewProps) {
  const [wizardIndex, setWizardIndex] = useState(0);
  const [product, setProduct] = useState(selectedProduct);
  const [competitorUploaded, setCompetitorUploaded] = useState(false);
  const [focus, setFocus] = useState<string[]>(["Hook", "脚本逻辑"]);
  const [creativeGoal, setCreativeGoal] = useState(defaultCreativeGoal);
  const [specs, setSpecs] = useState<AgentSpecs>({ ...defaultAgentSpecs });
  const order = useMemo(() => getAgentOrder(mode), [mode]);
  const step = order[wizardIndex] ?? order[0];
  const copy = wizardCopy[step];
  const isClone = mode === "clone";
  const focusText = focus.length > 0 ? focus.join("、") : "待选择";
  const competitorText = competitorUploaded ? "1 条视频" : "待上传";

  function moveWizard(delta: number) {
    setWizardIndex((index) => Math.max(0, Math.min(order.length - 1, index + delta)));
  }

  function toggleFocus(value: string) {
    setFocus((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function setSpec(key: keyof AgentSpecs, value: string) {
    setSpecs((current) => ({ ...current, [key]: value }));
  }

  function startWorkbench() {
    const uploadedAssets = [
      ...createDefaultAgentAssets(product),
      ...(competitorUploaded
        ? [
            {
              id: "asset-setup-competitor",
              role: "competitor_asset" as const,
              name: "competitor_ad_15s.mp4",
              kind: "video" as const,
              source: "mock" as const
            }
          ]
        : [])
    ];
    const session = createAgentSession(mode, product, creativeGoal, uploadedAssets);
    session.product = product;
    session.competitor = competitorUploaded ? "competitor_ad_15s.mp4" : "";
    session.focus = focus;
    session.creativeGoal = creativeGoal;
    session.specs = specs;
    session.locked = true;
    session.currentStepIndex = order.length;
    onStartWorkbench(session);
  }

  const draftSession = createAgentSession(mode, product, creativeGoal);
  draftSession.specs = specs;

  return (
    <section id="agent-setup" className={`view ${active ? "is-active" : ""}`} aria-label="Agent setup">
      <div className="setup-layout">
        <aside className="setup-sidebar">
          <span className="entry-tag">{isClone ? "Agent Clone" : "Agent Create"}</span>
          <h2>{isClone ? "创建竞品复刻任务" : "创建广告生成任务"}</h2>
          <p className="setup-intro">
            {isClone
              ? "先把产品、竞品素材、解析重点和输出规格锁定，Agent 才会进入工作台开始拆解和复刻。"
              : "先把产品、创作目标和输出规格锁定，Agent 才会进入工作台给出广告方向。"}
          </p>

          <div className="task-summary">
            <span className="summary-title">本次任务</span>
            <div className="summary-row">
              <span>产品</span>
              <strong>{product}</strong>
            </div>
            {isClone ? (
              <>
                <div className="summary-row">
                  <span>竞品素材</span>
                  <strong>{competitorText}</strong>
                </div>
                <div className="summary-row">
                  <span>重点解析</span>
                  <strong>{focusText}</strong>
                </div>
              </>
            ) : (
              <div className="summary-row">
                <span>创意目标</span>
                <strong>{creativeGoal.slice(0, 26)}{creativeGoal.length > 26 ? "..." : ""}</strong>
              </div>
            )}
            <div className="summary-row">
              <span>输出规格</span>
              <strong>{formatSessionSpecs(draftSession)}</strong>
            </div>
          </div>

          <ol className="setup-steps">
            {(["product", "competitor", "focus", "creative", "specs", "confirm"] as const).map((item) => {
              const itemIndex = order.indexOf(item);
              if (itemIndex === -1) return null;
              return (
                <li
                  key={item}
                  className={`${itemIndex === wizardIndex ? "is-current" : ""} ${itemIndex < wizardIndex ? "is-done" : ""}`}
                >
                  {wizardCopy[item].title}
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="setup-panel wizard-panel">
          <div className="wizard-header">
            <div>
              <span className="entry-tag">Step {wizardIndex + 1} / {order.length}</span>
              <h3>{copy.title}</h3>
              <p>{copy.copy}</p>
            </div>
            <span className="cost-pill">边界锁定 {wizardIndex + 1}/{order.length}</span>
          </div>

          <section className={`form-section wizard-step ${step === "product" ? "is-active" : ""}`}>
            <div className="step-question">
              <h3>这次广告要服务哪个产品？</h3>
              <p>选择已有产品包，或者输入产品 URL 创建新的产品包。</p>
            </div>
            <div className="product-selector">
              {products.slice(0, 2).map((item) => (
                <button
                  className={`product-pack product-choice ${product === item.name ? "is-selected" : ""}`}
                  key={item.name}
                  type="button"
                  onClick={() => {
                    setProduct(item.name);
                    onProductChange(item.name);
                  }}
                >
                  <div className={`product-icon ${item.toneClass}`}>{item.shortName}</div>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.type} · {item.name === "Family Locator" ? "家庭安全 · 已解析" : "支持 App Store、商品页、官网"}</small>
                  </div>
                </button>
              ))}
            </div>
            <div className="why-box">
              <strong>为什么先选产品？</strong>
              <p>后续脚本、画面和 CTA 都会绑定这个产品包。确认后，Agent 不应该擅自创造产品不存在的功能。</p>
            </div>
          </section>

          <section className={`form-section wizard-step ${step === "competitor" ? "is-active" : ""}`} hidden={!isClone}>
            <div className="step-question">
              <h3>上传你想复刻的竞品广告</h3>
              <p>支持图片或视频。第一版 Demo 先用占位素材展示流程，后续接真实上传和解析。</p>
            </div>
            <button className="upload-box upload-action" type="button" onClick={() => setCompetitorUploaded(true)}>
              <span className="upload-icon">＋</span>
              <strong>上传图片或视频</strong>
              <small>{competitorUploaded ? "已添加 competitor_ad_15s.mp4" : "还没有上传竞品素材"}</small>
            </button>
            <div className="upload-preview" hidden={!competitorUploaded}>
              <div className="video-thumb" />
              <div>
                <strong>competitor_ad_15s.mp4</strong>
                <small>已添加到任务，进入工作台后会成为竞品素材节点。</small>
              </div>
            </div>
          </section>

          <section className={`form-section wizard-step ${step === "focus" ? "is-active" : ""}`} hidden={!isClone}>
            <div className="step-question">
              <h3>你最想让 Agent 拆解什么？</h3>
              <p>这一步用来避免模型泛泛解析。选择越明确，后面给出的复刻方案越贴近你的判断。</p>
            </div>
            <div className="choice-grid">
              {focusOptions.map(([value, detail]) => (
                <label className={`analysis-choice ${focus.includes(value) ? "is-selected" : ""}`} key={value}>
                  <input type="checkbox" value={value} checked={focus.includes(value)} onChange={() => toggleFocus(value)} />
                  <strong>{value}</strong>
                  <span>{detail}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={`form-section wizard-step ${step === "creative" ? "is-active" : ""}`} hidden={isClone}>
            <div className="step-question">
              <h3>这条广告想解决什么问题？</h3>
              <p>不用写完整脚本，只要告诉 Agent 目标，它会先给多个方向让你选择。</p>
            </div>
            <textarea value={creativeGoal} onChange={(event) => setCreativeGoal(event.target.value)} />
            <div className="choice-grid compact">
              {["痛点放大型", "生活化 UGC", "产品演示型"].map((item, index) => (
                <button
                  className={`analysis-choice ${index === 0 ? "is-selected" : ""}`}
                  type="button"
                  key={item}
                  onClick={() => setCreativeGoal((current) => `${current}。创意倾向：${item}`)}
                >
                  <strong>{item}</strong>
                  <span>{index === 0 ? "先制造强烈焦虑" : index === 1 ? "真实用户分享" : "直接展示 App 使用"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={`form-section wizard-step ${step === "specs" ? "is-active" : ""}`}>
            <div className="step-question">
              <h3>最终要生成什么规格？</h3>
              <p>国家语言会影响脚本和字幕，渠道和比例会影响画面设计，时长会影响脚本密度。</p>
            </div>
            <div className="field-grid">
              {(Object.keys(specOptions) as Array<keyof AgentSpecs>).map((key) => (
                <label key={key}>
                  {key === "language" ? "国家/语言" : key === "channel" ? "渠道" : key === "ratio" ? "比例" : "时长"}
                  <select value={specs[key]} onChange={(event) => setSpec(key, event.target.value)}>
                    {specOptions[key].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className={`form-section wizard-step ${step === "confirm" ? "is-active" : ""}`}>
            <div className="step-question">
              <h3>确认后进入工作台</h3>
              <p>左侧 Agent 会继续推进确认，右侧画布沉淀节点、版本和结果。</p>
            </div>
            <div className="brief-card">
              <div className="summary-row"><span>产品</span><strong>{product}</strong></div>
              {isClone ? (
                <>
                  <div className="summary-row"><span>竞品素材</span><strong>{competitorUploaded ? "1 条竞品视频" : "进入工作台前建议上传"}</strong></div>
                  <div className="summary-row"><span>重点解析</span><strong>{focusText}</strong></div>
                </>
              ) : (
                <div className="summary-row"><span>创意目标</span><strong>{creativeGoal}</strong></div>
              )}
              <div className="summary-row"><span>输出规格</span><strong>{formatSessionSpecs(draftSession)}</strong></div>
            </div>
          </section>

          <div className="setup-actions">
            <button className="ghost-btn" type="button" onClick={onCancel}>
              退出
            </button>
            <button className="ghost-btn" type="button" disabled={wizardIndex === 0} onClick={() => moveWizard(-1)}>
              上一步
            </button>
            <button className="primary-btn" type="button" onClick={step === "confirm" ? startWorkbench : () => moveWizard(1)}>
              {step === "confirm" ? "开始解析并进入工作台" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
