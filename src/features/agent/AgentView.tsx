"use client";

import type { AgentMode, AppRoute } from "@/lib/domain/schemas";
import { recentAgentProjects } from "@/lib/mock-data";
import { Launcher } from "@/features/home/Launcher";

type AgentViewProps = {
  active: boolean;
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string) => void;
  onStartSetup: (mode: AgentMode) => void;
};

export function AgentView({ active, onRouteChange, onStartAgent, onStartSetup }: AgentViewProps) {
  return (
    <section id="agent" className={`view ${active ? "is-active" : ""}`} aria-label="Agent entry">
      <section className="section-band agent-page-shell">
        <div className="agent-page-launcher">
          <Launcher onRouteChange={onRouteChange} onStartAgent={onStartAgent} promptId="agent-page-prompt" showTabs={false} />
        </div>

        <section className="agent-projects-block">
          <div className="section-head compact">
            <div>
              <h3>最近项目</h3>
              <p>点击项目可回到 Agent Workbench。</p>
            </div>
            <button className="ghost-btn" type="button" onClick={() => onStartSetup("clone")}>
              创建正式任务
            </button>
          </div>
          <div className="project-row">
            {recentAgentProjects.map((project) => (
              <button className="project-card" type="button" key={project.title} onClick={() => onRouteChange("workbench")}>
                <span className={`project-status ${project.muted ? "muted" : ""}`}>{project.status}</span>
                <strong>{project.title}</strong>
                <small>{project.meta}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="agent-projects-block">
          <div className="section-head compact">
            <div>
              <h3>深度入口</h3>
              <p>Agent 路径会先锁定产品包、素材和输出边界，再进入画布。</p>
            </div>
          </div>
          <div className="project-row">
            <button className="project-card" type="button" onClick={() => onStartSetup("clone")}>
              <span className="project-status">P0</span>
              <strong>复刻竞品广告</strong>
              <small>产品包 + 竞品素材 + 解析重点 + 工作台</small>
            </button>
            <button className="project-card" type="button" onClick={() => onStartSetup("create")}>
              <span className="project-status muted">P0</span>
              <strong>从 0 生成广告</strong>
              <small>产品包 + 创意目标 + 多方向选择</small>
            </button>
            <button className="project-card" type="button" onClick={() => onRouteChange("assets")}>
              <span className="project-status muted">Assets</span>
              <strong>产品包资产</strong>
              <small>管理 Logo、UI、人物、场景和竞品素材</small>
            </button>
          </div>
        </section>
      </section>
    </section>
  );
}
