"use client";

import { Trash2, X } from "lucide-react";
import { useState } from "react";
import type { AgentMode, AgentUploadedAsset, AppRoute } from "@/lib/domain/schemas";
import { Launcher } from "@/features/home/Launcher";

type AgentSessionHistoryItem = {
  id: string;
  title: string;
  product: string;
  mode: AgentMode;
  updatedAt: string;
};

type AgentViewProps = {
  active: boolean;
  ready?: boolean;
  sessionHistory: AgentSessionHistoryItem[];
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string, uploadedAssets?: AgentUploadedAsset[]) => void;
  onResumeSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

function formatSessionUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getModeLabel(mode: AgentMode) {
  return mode === "clone" ? "克隆广告素材" : "创作广告素材";
}

export function AgentView({ active, ready = true, sessionHistory, onRouteChange, onStartAgent, onResumeSession, onDeleteSession }: AgentViewProps) {
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionHistoryItem | null>(null);
  const sortedSessionHistory = [...sessionHistory].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  function confirmDeleteSession() {
    if (!deleteTarget) return;
    onDeleteSession(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <section id="agent" className={`view ${active ? "is-active" : ""}`} aria-label="Agent entry">
      <section className="section-band agent-page-shell">
        <div className="agent-page-launcher">
          <Launcher
            ready={ready}
            onRouteChange={onRouteChange}
            onStartAgent={onStartAgent}
            promptId="agent-page-prompt"
            showTabs={false}
          />
        </div>

        <section className="agent-projects-block">
          <div className="section-head compact">
            <div>
              <h3>最近项目</h3>
              <p>点击项目可回到 Agent Workbench。</p>
            </div>
          </div>
          {sortedSessionHistory.length ? (
            <div className="project-row">
              {sortedSessionHistory.map((project) => (
                <article className="project-card agent-session-card" key={project.id}>
                  <button className="agent-session-main" type="button" onClick={() => onResumeSession(project.id)}>
                    <strong>{project.title || "未命名项目"}</strong>
                    <small className="agent-session-meta">
                      {project.product || "未指定产品"} · {formatSessionUpdatedAt(project.updatedAt)}
                    </small>
                    <span className={`agent-session-label ${project.mode === "create" ? "is-create" : ""}`}>{getModeLabel(project.mode)}</span>
                  </button>
                  <button
                    className="agent-session-delete"
                    type="button"
                    aria-label={`删除${project.title || "未命名项目"}`}
                    onClick={() => setDeleteTarget(project)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="project-empty-state">暂无历史会话。上方输入任务后会自动保存到这里。</div>
          )}
        </section>
      </section>

      {deleteTarget ? (
        <div className="agent-delete-modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
          <div
            className="agent-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="agent-delete-modal-head">
              <div>
                <h3 id="agent-delete-title">删除项目？</h3>
                <p>删除后会从最近项目中移除，并清除这次 Agent 会话记录。这个操作不能撤销。</p>
              </div>
              <button className="agent-delete-close" type="button" aria-label="关闭删除确认" onClick={() => setDeleteTarget(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="agent-delete-summary">
              <strong>{deleteTarget.title || "未命名项目"}</strong>
              <small>
                {deleteTarget.product || "未指定产品"} · {getModeLabel(deleteTarget.mode)}
              </small>
            </div>
            <div className="agent-delete-actions">
              <button className="ghost-btn" type="button" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="danger-btn" type="button" onClick={confirmDeleteSession}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
