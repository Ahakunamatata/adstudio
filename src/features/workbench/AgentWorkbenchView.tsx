"use client";

import { ArrowRight, Plus } from "lucide-react";
import type { AgentSession, AgentSpecs, CanvasNode } from "@/lib/domain/schemas";
import { agentBoundaryLabels, focusOptions, specOptions } from "@/lib/mock-data";
import {
  buildAgentBrief,
  formatSessionSpecs,
  getAgentOrder,
  getCurrentAgentStep
} from "@/features/agent/agent-session";
import { WorkbenchCanvas } from "./WorkbenchCanvas";

type AgentWorkbenchViewProps = {
  active: boolean;
  session: AgentSession;
  onSessionChange: (session: AgentSession) => void;
  onNodeOpen: (node: CanvasNode) => void;
};

export function AgentWorkbenchView({ active, session, onSessionChange, onNodeOpen }: AgentWorkbenchViewProps) {
  const order = getAgentOrder(session.mode);
  const step = getCurrentAgentStep(session);
  const isClone = session.mode === "clone";

  function updateSession(patch: Partial<AgentSession>) {
    onSessionChange({ ...session, ...patch });
  }

  function confirmCurrentBoundaryStep() {
    updateSession({ currentStepIndex: Math.min(order.length - 1, session.currentStepIndex + 1) });
  }

  function lockAgentTask() {
    updateSession({ locked: true, currentStepIndex: order.length });
  }

  function toggleFocus(value: string) {
    const focus = session.focus.includes(value)
      ? session.focus.filter((item) => item !== value)
      : [...session.focus, value];
    updateSession({ focus });
  }

  function setSpec(key: keyof AgentSpecs, value: string) {
    updateSession({ specs: { ...session.specs, [key]: value } });
  }

  function renderCurrentBoundaryCard() {
    if (step === "product") {
      return (
        <article className="boundary-card">
          <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>产品包</span></div>
          <h3>这次广告服务哪个产品？</h3>
          <p>我会先用产品包约束卖点、用户和痛点，避免后续脚本创造不存在的功能。</p>
          <div className="boundary-option-grid">
            {["Family Locator", "新产品 URL"].map((product) => (
              <button
                className={`boundary-option ${session.product === product ? "is-selected" : ""}`}
                type="button"
                key={product}
                onClick={() => updateSession({ product })}
              >
                <strong>{product === "Family Locator" ? "Family Locator" : "输入产品 URL"}</strong>
                <span>{product === "Family Locator" ? "App · 家庭安全 · 已解析" : "支持 App Store、商品页、官网"}</span>
              </button>
            ))}
          </div>
          <button className="small-btn is-selected" type="button" onClick={confirmCurrentBoundaryStep}>确认产品，下一步</button>
        </article>
      );
    }

    if (step === "competitor") {
      return (
        <article className="boundary-card">
          <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>竞品素材</span></div>
          <h3>要复刻哪条竞品广告？</h3>
          <p>素材会进入右侧画布，成为客观拆解和复刻迁移的输入节点。也可以先跳过，进入工作台后再补。</p>
          <button className="upload-box compact-upload" type="button" onClick={() => updateSession({ competitor: "competitor_ad_15s.mp4" })}>
            <span className="upload-icon">{session.competitor ? "✓" : "＋"}</span>
            <strong>{session.competitor || "添加竞品图片或视频"}</strong>
            <small>{session.competitor ? "已作为竞品素材节点" : "Demo 先使用占位素材"}</small>
          </button>
          <div className="boundary-actions">
            <button className="small-btn" type="button" onClick={confirmCurrentBoundaryStep}>稍后补充，继续</button>
            <button
              className="small-btn is-selected"
              type="button"
              onClick={() => {
                updateSession({ competitor: "competitor_ad_15s.mp4", currentStepIndex: Math.min(order.length - 1, session.currentStepIndex + 1) });
              }}
            >
              使用该素材，下一步
            </button>
          </div>
        </article>
      );
    }

    if (step === "focus") {
      return (
        <article className="boundary-card">
          <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>解析重点</span></div>
          <h3>最想让我拆解什么？</h3>
          <p>这一步只保留有限选项，用来避免泛泛解析。</p>
          <div className="choice-grid chat-choice-grid">
            {focusOptions.map(([value, detail]) => (
              <label className={`analysis-choice ${session.focus.includes(value) ? "is-selected" : ""}`} key={value}>
                <input type="checkbox" value={value} checked={session.focus.includes(value)} onChange={() => toggleFocus(value)} />
                <strong>{value}</strong>
                <span>{detail}</span>
              </label>
            ))}
          </div>
          <button className="small-btn is-selected" type="button" onClick={confirmCurrentBoundaryStep}>确认重点，下一步</button>
        </article>
      );
    }

    if (step === "creative") {
      return (
        <article className="boundary-card">
          <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>创意目标</span></div>
          <h3>这条广告想解决什么问题？</h3>
          <p>不用写完整脚本，只要确认目标，Agent 会先给多个方向让你选。</p>
          <textarea value={session.creativeGoal} onChange={(event) => updateSession({ creativeGoal: event.target.value })} />
          <div className="boundary-actions">
            {["痛点放大型", "生活化 UGC", "产品演示型"].map((item) => (
              <button
                className="small-btn"
                type="button"
                key={item}
                onClick={() => updateSession({ creativeGoal: `${session.creativeGoal}。创意倾向：${item}` })}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="small-btn is-selected" type="button" onClick={confirmCurrentBoundaryStep}>确认目标，下一步</button>
        </article>
      );
    }

    if (step === "specs") {
      return (
        <article className="boundary-card">
          <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>输出规格</span></div>
          <h3>最终要生成什么规格？</h3>
          <p>语言、渠道、比例和时长会影响脚本密度、字幕表达和画面构图。</p>
          <div className="field-grid chat-field-grid">
            {(Object.keys(specOptions) as Array<keyof AgentSpecs>).map((key) => (
              <label key={key}>
                {key === "language" ? "国家/语言" : key === "channel" ? "渠道" : key === "ratio" ? "比例" : "时长"}
                <select value={session.specs[key]} onChange={(event) => setSpec(key, event.target.value)}>
                  {specOptions[key].map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="small-btn is-selected" type="button" onClick={confirmCurrentBoundaryStep}>确认规格，下一步</button>
        </article>
      );
    }

    const competitorText = session.mode === "clone" ? session.competitor || "进入工作台后补充" : "不需要竞品素材";
    return (
      <article className="boundary-card">
        <div className="card-meta"><span>Step {session.currentStepIndex + 1}</span><span>任务边界</span></div>
        <h3>最后确认一下任务边界</h3>
        <p>确认后我再开始解析或生成方向，右侧画布会沉淀对应节点。</p>
        <div className="brief-card compact-brief">
          <div className="summary-row"><span>产品</span><strong>{session.product}</strong></div>
          <div className="summary-row"><span>{session.mode === "clone" ? "竞品素材" : "任务类型"}</span><strong>{competitorText}</strong></div>
          {session.mode === "create" ? (
            <div className="summary-row"><span>创意目标</span><strong>{session.creativeGoal}</strong></div>
          ) : (
            <div className="summary-row"><span>解析重点</span><strong>{session.focus.join("、") || "待选择"}</strong></div>
          )}
          <div className="summary-row"><span>输出规格</span><strong>{formatSessionSpecs(session)}</strong></div>
        </div>
        <button className="small-btn is-selected" type="button" onClick={lockAgentTask}>确认任务，开始{session.mode === "clone" ? "解析" : "生成方向"}</button>
      </article>
    );
  }

  function renderDraftCards() {
    const doneSteps = order.slice(0, session.currentStepIndex);
    return (
      <>
        {doneSteps.length > 0 ? (
          <article className="boundary-summary">
            <span>已确认</span>
            <strong>{doneSteps.map((item) => agentBoundaryLabels[item]).join("、")}</strong>
          </article>
        ) : null}
        {renderCurrentBoundaryCard()}
        <article className="progress-card">
          <h3>当前进度</h3>
          <ul>
            {order.map((item, index) => {
              const className = index < session.currentStepIndex ? "ok" : index === session.currentStepIndex ? "run" : "";
              const suffix = index < session.currentStepIndex ? "已确认" : index === session.currentStepIndex ? "等待确认" : "待处理";
              return <li className={className} key={item}>{agentBoundaryLabels[item]}：{suffix}</li>;
            })}
          </ul>
        </article>
      </>
    );
  }

  function renderLockedCards() {
    const secondItem = session.mode === "create" ? "已生成 3 个创意方向" : "竞品客观拆解已完成";
    const thirdItem = session.mode === "create" ? "等待确认广告方向" : "等待确认复刻方案";
    return (
      <>
        <article className="decision-card">
          <div className="card-meta">
            <span>{session.mode === "create" ? "方向 A" : "方案 A"}</span>
            <span>{session.mode === "create" ? "痛点放大" : "高强度 Hook"}</span>
          </div>
          <h3>{session.mode === "create" ? "父母发现孩子未按时到家，用定位快速确认安全" : "孩子没回家，母亲用 App 定位确认安全"}</h3>
          <p>{session.mode === "create" ? "以真实焦虑开场，用产品能力承接解决方案，适合 TikTok 高转化短视频。" : "保留竞品的紧张开场和反转释然，用家庭安全痛点替换原商品卖点。"}</p>
          <button className="small-btn is-selected" type="button">已选择</button>
        </article>
        <article className="decision-card muted">
          <div className="card-meta"><span>{session.mode === "create" ? "方向 B" : "方案 B"}</span><span>生活化 UGC</span></div>
          <h3>妈妈日常分享：放学路上终于不用一直打电话</h3>
          <button className="small-btn" type="button">切换</button>
        </article>
        <article className="progress-card">
          <h3>当前进度</h3>
          <ul>
            <li className="ok">产品资料包已锁定</li>
            <li className="ok">{secondItem}</li>
            <li className="run">{thirdItem}</li>
            <li>下一步生成脚本与锚点资产</li>
          </ul>
        </article>
      </>
    );
  }

  const firstMessage = session.locked
    ? isClone
      ? `任务边界已锁定。我会先客观拆解竞品素材，检查是否覆盖「${session.focus.join("、") || "重点未指定"}」，再结合 ${session.product} 生成 3 个复刻方向。`
      : `任务边界已锁定。我会先结合 ${session.product} 和输出规格生成 3 个广告方向，等你选择后再进入脚本、锚点和分镜生产。`
    : `${session.originalPrompt ? `我已收到你的需求：“${session.originalPrompt}”。` : ""}我会把${isClone ? "复刻广告" : "创作广告"}拆成几个边界确认，不需要你一次填完所有字段。`;

  return (
    <section id="workbench" className={`view workbench-view ${active ? "is-active" : ""}`} aria-label="Agent workbench">
      <div className="studio-shell">
        <aside className="agent-panel">
          <div className="agent-head">
            <div>
              <span className="entry-tag">Agent</span>
              <h2>{isClone ? "复刻广告工作台" : "生成广告工作台"}</h2>
            </div>
            <span className="cost-pill">{session.locked ? "Cost 42 cr" : "Cost 0 cr"}</span>
          </div>
          <div className="phase-list">
            {order.map((item, index) => {
              const className = session.locked || index < session.currentStepIndex ? "done" : index === session.currentStepIndex ? "current" : "";
              return <span className={className} key={item}>{agentBoundaryLabels[item]}</span>;
            })}
          </div>
          <div className="locked-brief">
            <span>{session.locked ? "任务已锁定" : "需求草稿"}</span>
            <strong>{buildAgentBrief(session)}</strong>
          </div>

          <div className="chat-stream">
            <article className="message agent-message">
              <span className="speaker">创意总监</span>
              <p>{firstMessage}</p>
            </article>
            {session.locked ? renderLockedCards() : renderDraftCards()}
          </div>

          <div className="agent-composer">
            <button className="square-btn" aria-label="Upload" type="button">
              <Plus size={16} />
            </button>
            <input value={session.locked ? "确认方案 A，继续生成脚本" : "可以直接补充或修改当前边界"} aria-label="Agent input" readOnly />
            <button className="send-btn" type="button" aria-label="Send">
              <ArrowRight size={16} />
            </button>
          </div>
        </aside>

        <WorkbenchCanvas key={session.cloneSource?.topAdId ?? "default"} session={session} onNodeOpen={onNodeOpen} />
      </div>
    </section>
  );
}
