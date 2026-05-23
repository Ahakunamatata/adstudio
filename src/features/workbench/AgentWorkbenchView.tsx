"use client";

import { AlertTriangle, ArrowRight, Download, ExternalLink, FileSearch, GripVertical, History, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Paperclip, RefreshCw, Upload, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { AgentCanvasState, AgentSession, AgentUploadedAsset, CanvasNode } from "@/lib/domain/schemas";
import { hasAgentStartupContext } from "@/features/agent/agent-session";
import { AgentEventRenderer, type AgentQuestionUploadInput } from "@/features/agent-runtime/AgentEventRenderer";
import type {
  AgentEvent,
  AgentIntakeSubmissionFact,
  AgentQuestionSubmission,
  AgentQuestionSubmittedAsset
} from "@/features/agent-runtime/agent-events";
import { createBrowserWorkspaceArtifactStore } from "@/features/agent-runtime/artifact-store";
import { agentArtifactsSchema, createEmptyAgentArtifacts, type AgentArtifacts } from "@/features/agent-runtime/artifacts";
import { createEmptyCanvasSnapshot, type CanvasSnapshot } from "@/features/agent-runtime/agent-snapshot";
import {
  createPendingAgentTurn,
  getPendingTurnRetryInput,
  isActiveAgentTurn,
  markAgentTurnFailed,
  markAgentTurnReceived,
  markAgentTurnRequesting,
  type PendingAgentTurn
} from "@/features/agent-runtime/agent-message-lifecycle";
import type { AgentTransition } from "@/features/agent-runtime/agent-decision";
import type { AgentControllerResult } from "@/features/agent-runtime/agent-controller";
import {
  createBrowserAgentProjectStore,
  readBrowserAgentProjectBundles,
  syncBrowserAgentWorkspaceToServer,
  upsertBrowserAgentProjectBundle
} from "@/features/agent-runtime/browser-agent-project-store";
import {
  createApprovalRequestProjectPatch,
  executeApprovalActionBatch,
  rejectApprovalRequest
} from "@/features/agent-runtime/approval-flow";
import { CANVAS_ACTION_EVENT } from "@/features/canvas/events";
import { CanvasMediaPreviewOverlay, isPlayableVideoSrc, type CanvasMediaPreviewItem } from "@/features/canvas/CanvasMediaPreview";
import { llmAgentController, submitInternalAgentTask } from "@/features/agent-runtime/llm-agent-controller";
import { runM3GoldenPathDemo, shouldUseM3GoldenPathDemo } from "@/features/agent-runtime/m3-golden-path";
import { getMediaFileKind, getMediaFiles, hasMediaDataTransfer } from "@/features/generation/slot-inputs";
import { createInitialLlmAgentRuntime } from "@/features/workbench/agent-orchestrator";
import { isAgentArtifactsEmpty, type AgentSessionRecord } from "@/lib/agent-workspace-model";
import type { AgentMessage, AgentQuickAction, AgentRuntimeState } from "./agent-types";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
import type {
  AgentProjectBundle,
  GenerationTaskRecord,
  MediaAssetRecord
} from "@/lib/agent-project-store";

type AgentWorkbenchViewProps = {
  active: boolean;
  session: AgentSession;
  startupPrompt?: string;
  activeSessionId: string | null;
  sessionHistory: AgentSessionRecord[];
  onSessionChange: (session: AgentSession, runtime?: AgentRuntimeState) => void;
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onStartupPromptConsumed?: (sessionId: string) => void;
  onNodeOpen: (node: CanvasNode) => void;
};

type PersistedAgentRuntimeLoadResult = {
  state: AgentRuntimeState | null;
  artifactRestoreError?: string;
};

type AgentGenerationApiResponse = {
  ok: boolean;
  status?: string;
  approvalStatus?: string;
  task?: Pick<
    GenerationTaskRecord,
    "id" | "approvalRequestId" | "provider" | "providerTaskId" | "status" | "progress" | "credits" | "costUsd" | "outputAssetId" | "output" | "errorCode" | "errorMessage" | "updatedAt"
  >;
  asset?: {
    id: string;
    kind: MediaAssetRecord["kind"];
    source: MediaAssetRecord["source"];
    recoverable?: boolean;
    storageProvider?: string;
    storageKey?: string;
    publicUrl?: string;
    signedUrlExpiresAt?: string;
  };
  bundle?: AgentProjectBundle;
  eventIds?: string[];
  idempotent?: boolean;
  blocker?: string;
  error?: string;
  temporaryExternalAssetWarning?: string;
  realProviderCalls?: number;
  oldViduRouteCalls?: number;
};

type ReplayVisibility = "user_visible" | "internal_diagnostic";
type ReplayTimelineItem = {
  id: string;
  type: string;
  visibility: ReplayVisibility;
  createdAt?: string;
  title?: string;
  body?: unknown;
  eventKind?: unknown;
  cardKind?: unknown;
  status?: unknown;
  details?: unknown;
};

type PmReplaySummary = {
  schemaVersion: 1;
  audience: "pm_debug";
  viewNote: string;
  sessionId: string;
  title?: string;
  product?: string;
  updatedAt?: string;
  timeline: ReplayTimelineItem[];
  approvals: Array<{
    id: string;
    kind: string;
    title: string;
    status: string;
    estimatedCredits?: number;
    actualCredits?: number;
    requestedAt?: string;
    respondedAt?: string;
    executedAt?: string;
  }>;
  generationTasks: Array<{
    id: string;
    kind: string;
    provider?: string;
    status: string;
    progress: number;
    credits: number;
    outputAssetId?: string;
    updatedAt?: string;
    errorMessage?: string;
  }>;
  mediaAssets: Array<{
    id: string;
    kind: string;
    role: string;
    source: string;
    storageProvider?: string;
    storageKey?: string;
    hasPublicUrl?: boolean;
    recoverable?: boolean;
    analysisStatus?: string;
    updatedAt?: string;
  }>;
  canvas?: {
    nodeCount: number;
    edgeCount: number;
    graphVersion?: string;
    updatedAt?: string;
  } | null;
  canvasChanges: Array<{
    id: string;
    eventType: string;
    objectType?: string;
    objectId?: string;
    actorType?: string;
    createdAt?: string;
  }>;
  diagnostics: {
    userVisibleItems: number;
    internalDiagnosticItems: number;
    debugLogCount: number;
    workspaceEventCount: number;
    projectEventCount: number;
    redactionApplied: boolean;
  };
};

type AgentSessionReplayResponse = {
  schemaVersion: number;
  exportedAt: string;
  sessionId: string;
  pmReview?: PmReplaySummary;
};

const FIRST_RUN_AGENT_PROMPT = "请基于当前真实任务和已上传素材解析结果，做第一轮理解和追问。当前只保留对话能力，不要输出画布动作。";
const agentRuntimeStoragePrefix = "ad-studio:agent-runtime:chat-only:v1:";
const agentStartupPromptStoragePrefix = "ad-studio:agent-startup-prompt:v1:";
const agentPanelDefaultWidth = 400;
const agentPanelMinWidth = 300;
const agentPanelMaxWidth = 640;

type WorkbenchShellStyle = CSSProperties & {
  "--agent-panel-width": string;
};

function clampAgentPanelWidth(width: number) {
  return Math.round(Math.min(agentPanelMaxWidth, Math.max(agentPanelMinWidth, width)));
}

function getAgentRuntimeStorageKey(sessionId: string) {
  return `${agentRuntimeStoragePrefix}${sessionId}`;
}

function parseRuntimeArtifacts(value: unknown): { artifacts: AgentArtifacts; error?: string } {
  const parsedArtifacts = agentArtifactsSchema.safeParse(value ?? createEmptyAgentArtifacts());
  if (parsedArtifacts.success) return { artifacts: parsedArtifacts.data };
  return {
    artifacts: createEmptyAgentArtifacts(),
    error: parsedArtifacts.error.message
  };
}

function getArtifactPersistKey(sessionId: string, artifacts: AgentArtifacts) {
  return `${sessionId}:${JSON.stringify(artifacts)}`;
}

function parsePersistedAgentRuntime(value: unknown): AgentRuntimeState | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as AgentRuntimeState;
  if (!parsed.messages || !parsed.brief || !Array.isArray(parsed.actionHistory)) return null;
  const parsedArtifacts = parseRuntimeArtifacts(parsed.artifacts);
  return {
    ...parsed,
    artifacts: parsedArtifacts.artifacts
  };
}

function loadPersistedAgentRuntime(sessionId: string): PersistedAgentRuntimeLoadResult {
  if (typeof window === "undefined") return { state: null };

  try {
    const rawState = window.localStorage.getItem(getAgentRuntimeStorageKey(sessionId));
    if (!rawState) return { state: null };
    const parsed = JSON.parse(rawState) as unknown;
    const state = parsePersistedAgentRuntime(parsed);
    if (!state) return { state: null };
    const parsedArtifacts = parseRuntimeArtifacts(state.artifacts);
    return {
      state,
      artifactRestoreError: parsedArtifacts.error
    };
  } catch {
    return { state: null };
  }
}

function storeAgentRuntime(sessionId: string, state: AgentRuntimeState) {
  try {
    window.localStorage.setItem(getAgentRuntimeStorageKey(sessionId), JSON.stringify(state));
  } catch {
    // Keep the in-memory Agent usable if storage is unavailable.
  }
}

function takeStoredStartupPrompt(sessionId: string) {
  if (typeof window === "undefined") return "";
  try {
    const key = `${agentStartupPromptStoragePrefix}${sessionId}`;
    const prompt = window.sessionStorage.getItem(key)?.trim() ?? "";
    if (prompt) window.sessionStorage.removeItem(key);
    return prompt;
  } catch {
    return "";
  }
}

function createLocalMessage(
  role: AgentMessage["role"],
  body: string,
  patch: Pick<AgentMessage, "events" | "metadata"> = {}
): AgentMessage {
  return {
    id: `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    body,
    createdAt: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    ...patch
  };
}

function createSystemMessage(body: string): AgentMessage {
  return createLocalMessage("system", body);
}

function isAgentAssetRole(value: unknown): value is AgentUploadedAsset["role"] {
  return value === "product_pack" || value === "competitor_asset" || value === "reference_asset";
}

function mergeUploadedAssets(existing: AgentUploadedAsset[], incoming: AgentUploadedAsset[]) {
  if (!incoming.length) return existing;
  const incomingIds = new Set(incoming.map((asset) => asset.id));
  return [...incoming, ...existing.filter((asset) => !incomingIds.has(asset.id))];
}

function getSpeakerLabel(role: AgentMessage["role"]) {
  if (role === "user") return "你";
  if (role === "system") return "系统";
  return "创意总监";
}

const internalMessageTermPattern =
  /\b(fallbackUsed|fallbackReason|runtime|workspace|snapshot|schema|structured fact|provider|GenerationTask|MediaAsset|ApprovalRequest|Approval request|recoverable|actionHash|idempotencyKey|M3\.?2|Zod|LLM|canvasActions|uploadedAssets|executable|connectNodes|source|target|nodeId|validator|Action\s*\d+)\b|Agent LLM 决策失败|决策失败|目标节点.*不存在|不能连接到自身/i;

function sanitizeMessageBody(body: string) {
  if (!internalMessageTermPattern.test(body)) return body;
  const visibleLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !internalMessageTermPattern.test(line));
  return visibleLines.join("\n") || "连接失败，可重试。";
}

function sanitizeOperationalMessage(message: string, fallback: string) {
  return internalMessageTermPattern.test(message) ? fallback : message;
}

function hasAssistantResponse(state: AgentRuntimeState) {
  return state.messages.some((message) => message.role === "assistant");
}

function hasPersistedRuntimeContent(state: AgentRuntimeState) {
  return Boolean(
    state.messages.length ||
    state.pendingConfirmation ||
    state.actionHistory.length ||
    state.intakeSubmissions?.length ||
    state.fallback
  );
}

function hasRetryEvent(events: AgentEvent[] | undefined) {
  return Boolean(events?.some((event) => event.kind === "retry"));
}

function getRetryTextForMessage(messages: AgentMessage[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role !== "user") continue;
    const text = message.body.trim();
    if (text) return text;
  }
  return "";
}

function formatSessionUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatReplayTimestamp(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function getModeLabel(mode: AgentSession["mode"]) {
  return mode === "clone" ? "复刻" : "生成";
}

function getSessionShortId(sessionId: string) {
  return sessionId.split("-").slice(-2).join("-") || sessionId.slice(-6);
}

function getCurrentSessionInfo(session: AgentSession) {
  const hasProjectBrief = Boolean(
    session.lifecycle !== "empty" ||
    session.product.trim() ||
    session.originalPrompt.trim() ||
    session.uploadedAssets.length
  );
  const modeLabel = hasProjectBrief ? getModeLabel(session.mode) : "未开始任务";
  return {
    title: session.projectTitle?.trim() || "未命名项目",
    meta: `${session.product || "未指定产品"} · ${modeLabel} · ${getSessionShortId(session.id)}`
  };
}

function getReplaySessionLabel(record: Pick<AgentSessionRecord, "title" | "product" | "updatedAt">) {
  const title = record.title?.trim() || "未命名项目";
  const time = formatSessionUpdatedAt(record.updatedAt);
  return `${time ? `${time} · ` : ""}${title}${record.product ? ` · ${record.product}` : ""}`;
}

function stringifyReplayValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getReplayTimelineTypeLabel(type: string) {
  const labels: Record<string, string> = {
    user_input: "用户输入",
    agent_reply: "Agent 回复",
    card_event: "结构化卡片",
    debug_log: "内部诊断",
    workspace_event: "工作区事件",
    project_event: "项目事件"
  };
  return labels[type] ?? type;
}

function getReplayVisibilityLabel(visibility: ReplayVisibility) {
  return visibility === "user_visible" ? "用户可见" : "内部诊断";
}

function getBrowserProjectBundle(projectId: string) {
  return readBrowserAgentProjectBundles().find((bundle) => bundle.project.id === projectId) ?? null;
}

function isGenerationTaskTerminal(status: GenerationTaskRecord["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function getTaskAsset(bundle: AgentProjectBundle | null, task: GenerationTaskRecord) {
  if (!task.outputAssetId) return undefined;
  return bundle?.mediaAssets.find((asset) => asset.id === task.outputAssetId);
}

function getTaskOutputUrl(bundle: AgentProjectBundle | null, task: GenerationTaskRecord) {
  const asset = getTaskAsset(bundle, task);
  return asset?.storage?.publicUrl ?? task.output?.downloadUrl ?? task.output?.assetUrl;
}

function getTaskCanvasNodeId(bundle: AgentProjectBundle | null, task: GenerationTaskRecord) {
  const projectedNode = bundle?.canvasGraph.nodes.find((node) =>
    node.versions.some((version) => version.providerTaskId && version.providerTaskId === task.providerTaskId)
  );
  return projectedNode?.id ?? task.nodeId;
}

function getGenerationStatusLabel(status: GenerationTaskRecord["status"]) {
  const labels: Record<GenerationTaskRecord["status"], string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "生成完成",
    failed: "生成失败",
    cancelled: "已取消"
  };
  return labels[status];
}

function getAssetPersistenceLabel(asset: MediaAssetRecord | undefined) {
  if (!asset) return "结果保存状态待更新";
  if (asset.storage?.provider === "external" && asset.recoverable === false) return "结果仅可临时预览，长期保存失败";
  if (asset.storage?.provider === "supabase_storage" && asset.recoverable === true) return "结果已保存，可恢复";
  if (asset.recoverable === true) return "结果已保存，可恢复";
  return "结果保存状态待确认";
}

function getProviderTaskShortId(task: GenerationTaskRecord) {
  const value = task.providerTaskId ?? task.id;
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function AgentSessionReplayPanel({
  replay,
  selectedSessionId,
  sessionOptions,
  loading,
  error,
  onSelectSession,
  onRefresh,
  onDownload,
  onClose
}: {
  replay: AgentSessionReplayResponse | null;
  selectedSessionId: string;
  sessionOptions: AgentSessionRecord[];
  loading: boolean;
  error: string;
  onSelectSession: (sessionId: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const review = replay?.pmReview;
  const timeline = review?.timeline ?? [];
  const visibleTimeline = timeline.slice(-20);

  return (
    <div className="agent-replay-panel" role="dialog" aria-modal="false" aria-label="PM 会话回放验收视图">
      <div className="agent-replay-head">
        <div>
          <strong>PM 会话回放</strong>
          <span>调试/验收视图，不是普通用户聊天 UI</span>
        </div>
        <button className="agent-icon-btn" type="button" aria-label="关闭会话回放" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="agent-replay-controls">
        <label>
          <span>Session</span>
          <select value={selectedSessionId} onChange={(event) => onSelectSession(event.target.value)}>
            {sessionOptions.map((item) => (
              <option value={item.id} key={item.id}>
                {getReplaySessionLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button className="small-btn" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} />
            <span>{loading ? "加载中" : "刷新"}</span>
          </button>
          <button className="small-btn is-selected" type="button" onClick={onDownload} disabled={!replay}>
            <Download size={14} />
            <span>导出 JSON</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="agent-replay-error">{error}</div>
      ) : null}

      {review ? (
        <div className="agent-replay-content">
          <section className="agent-replay-section">
            <div className="agent-replay-section-head">
              <strong>{review.title || review.sessionId}</strong>
              <span>{formatReplayTimestamp(review.updatedAt)}</span>
            </div>
            <div className="agent-replay-kpis">
              <span>用户可见 {review.diagnostics.userVisibleItems}</span>
              <span>内部诊断 {review.diagnostics.internalDiagnosticItems}</span>
              <span>debugLog {review.diagnostics.debugLogCount}</span>
              <span>{review.diagnostics.redactionApplied ? "已脱敏" : "无敏感字段"}</span>
            </div>
          </section>

          <section className="agent-replay-section">
            <div className="agent-replay-section-head">
              <strong>状态概览</strong>
              <span>{review.product || "未指定产品"}</span>
            </div>
            <div className="agent-replay-status-grid">
              <div>
                <span>Approval</span>
                <strong>{review.approvals.length ? review.approvals.map((item) => item.status).join(" / ") : "无"}</strong>
              </div>
              <div>
                <span>GenerationTask</span>
                <strong>{review.generationTasks.length ? review.generationTasks.map((item) => `${item.status} ${item.progress}%`).join(" / ") : "无"}</strong>
              </div>
              <div>
                <span>MediaAsset</span>
                <strong>{review.mediaAssets.length ? review.mediaAssets.map((item) => `${item.source}:${String(item.recoverable)}`).join(" / ") : "无"}</strong>
              </div>
              <div>
                <span>Canvas</span>
                <strong>{review.canvas ? `${review.canvas.nodeCount} nodes / ${review.canvasChanges.length} changes` : "无"}</strong>
              </div>
            </div>
          </section>

          <section className="agent-replay-section">
            <div className="agent-replay-section-head">
              <strong>过程时间线</strong>
              <span>{visibleTimeline.length}/{timeline.length}</span>
            </div>
            <div className="agent-replay-timeline">
              {visibleTimeline.map((item) => (
                <article className={`agent-replay-timeline-item is-${item.visibility}`} key={item.id}>
                  <div>
                    <strong>{getReplayTimelineTypeLabel(item.type)}</strong>
                    <span>{getReplayVisibilityLabel(item.visibility)} · {formatReplayTimestamp(item.createdAt)}</span>
                  </div>
                  <p>{item.title || stringifyReplayValue(item.body) || stringifyReplayValue(item.details)}</p>
                  {item.status || item.cardKind ? (
                    <small>{[item.cardKind, item.status].filter(Boolean).join(" · ")}</small>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="agent-replay-section">
            <div className="agent-replay-section-head">
              <strong>诊断明细</strong>
              <span>已脱敏</span>
            </div>
            <details className="agent-replay-debug">
              <summary>查看内部 debug / event 片段</summary>
              <pre>{stringifyReplayValue(timeline.filter((item) => item.visibility === "internal_diagnostic").slice(-8))}</pre>
            </details>
          </section>
        </div>
      ) : (
        <div className="agent-replay-empty">{loading ? "正在加载会话回放..." : "选择 session 后查看回放。"}</div>
      )}
    </div>
  );
}

function AgentGenerationTaskPanel({
  bundle,
  tasks,
  onRefresh,
  onPreview,
  onRepair
}: {
  bundle: AgentProjectBundle | null;
  tasks: GenerationTaskRecord[];
  onRefresh: (task: GenerationTaskRecord) => void;
  onPreview: (task: GenerationTaskRecord) => void;
  onRepair: (task: GenerationTaskRecord) => void;
}) {
  if (!tasks.length) return null;

  return (
    <div className="agent-generation-panel" aria-label="生成任务状态">
      <div className="agent-generation-panel-head">
        <strong>真实生成任务</strong>
        <span>{tasks.length} 个任务</span>
      </div>
      {tasks.map((task) => {
        const asset = getTaskAsset(bundle, task);
        const outputUrl = getTaskOutputUrl(bundle, task);
        const nodeId = getTaskCanvasNodeId(bundle, task);
        const temporaryExternalAsset = asset?.storage?.provider === "external" && asset.recoverable === false;
        return (
          <article className={`agent-generation-task-card is-${task.status}`} key={task.id}>
            <div className="agent-generation-task-top">
              <div>
                <strong>{task.modelName}</strong>
                <span>{task.modeKey} · {task.kind}</span>
              </div>
              <span className={`generation-status-badge is-${task.status}`}>{getGenerationStatusLabel(task.status)}</span>
            </div>
            <p className="agent-generation-prompt">{task.prompt}</p>
            <div className="agent-generation-meta">
              <span>任务编号 {getProviderTaskShortId(task)}</span>
              <span>{task.progress}%</span>
              <span>{task.credits} credits</span>
            </div>
            {task.status === "queued" || task.status === "running" ? (
              <div className="generation-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(4, Math.min(100, task.progress))}%` }} />
              </div>
            ) : null}
            {task.errorMessage ? (
              <div className="agent-generation-error">{sanitizeOperationalMessage(task.errorMessage, "生成失败，请稍后重试或调整后重新提交。")}</div>
            ) : null}
            {asset ? (
              <div className="agent-generation-asset">
                <span>保存状态</span>
                <span>{getAssetPersistenceLabel(asset)}</span>
              </div>
            ) : null}
            {nodeId ? (
              <div className="agent-generation-asset">
                <span>画布状态</span>
                <span>结果已关联到画布</span>
              </div>
            ) : null}
            {outputUrl ? (
              <button className="agent-generation-preview" type="button" onClick={() => onPreview(task)}>
                {task.kind === "video" && isPlayableVideoSrc(outputUrl) ? (
                  <video src={outputUrl} muted playsInline preload="metadata" />
                ) : (
                  <span style={{ backgroundImage: task.kind === "image" ? `url(${outputUrl})` : undefined }} />
                )}
                <strong>{temporaryExternalAsset ? "临时结果预览" : "结果预览"}</strong>
              </button>
            ) : null}
            {temporaryExternalAsset ? (
              <div className="agent-generation-warning">
                <AlertTriangle size={14} />
                <span>结果仅可临时预览，长期保存失败；外链过期后可能无法恢复。</span>
              </div>
            ) : null}
            <div className="agent-card-actions">
              {!isGenerationTaskTerminal(task.status) ? (
                <button className="small-btn" type="button" onClick={() => onRefresh(task)}>
                  <RefreshCw size={14} />
                  <span>刷新状态</span>
                </button>
              ) : null}
              {outputUrl ? (
                <a className="small-btn is-selected" href={outputUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} />
                  <span>{temporaryExternalAsset ? "打开临时外链" : "打开结果"}</span>
                </a>
              ) : null}
              {task.status === "succeeded" && asset ? (
                <button className="small-btn" type="button" onClick={() => onRepair(task)}>
                  <Wand2 size={14} />
                  <span>局部返工</span>
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function hasSessionTaskBrief(session: AgentSession, runtime: AgentRuntimeState) {
  return Boolean(
    runtime.brief.product.trim() ||
    runtime.brief.competitorAsset.trim() ||
    runtime.brief.originalPrompt.trim() ||
    session.product.trim() ||
    session.competitor.trim() ||
    session.originalPrompt.trim() ||
    session.uploadedAssets.length
  );
}

function syncSessionFromRuntimeBrief(session: AgentSession, runtime: AgentRuntimeState): AgentSession {
  const product = runtime.brief.product.trim() || session.product;
  const competitor = runtime.brief.competitorAsset.trim() || session.competitor;
  const originalPrompt = runtime.brief.originalPrompt.trim() || session.originalPrompt;
  const hasTaskBrief = hasSessionTaskBrief(session, runtime);

  return {
    ...session,
    lifecycle: hasTaskBrief ? "intake" : session.lifecycle === "empty" ? "empty" : session.lifecycle,
    product,
    competitor,
    originalPrompt,
    creativeGoal: originalPrompt || session.creativeGoal,
    projectTitle:
      session.projectTitle === "未命名项目" && product
        ? `广告项目 · ${product}`
        : session.projectTitle
  };
}

function AgentChatMessage({
  message,
  sessionId,
  submittedFormIds,
  onQuickAction,
  onSubmitText,
  onSubmitQuestion,
  onUploadQuestionFiles,
  retryText
}: {
  message: AgentMessage;
  sessionId: string;
  submittedFormIds: Set<string>;
  onQuickAction: (action: AgentQuickAction) => void;
  onSubmitText: (text: string) => void;
  onSubmitQuestion: (submission: AgentQuestionSubmission) => void;
  onUploadQuestionFiles: (input: AgentQuestionUploadInput) => AgentQuestionSubmittedAsset[];
  retryText?: string;
}) {
  const showSpeaker = message.role !== "user";
  const events =
    message.events?.length && message.metadata?.fallbackUsed && retryText && !hasRetryEvent(message.events)
      ? [...message.events, { kind: "retry" as const, label: "重新连接 Agent", text: retryText }]
      : message.events;

  return (
    <article className={`message ${message.role === "user" ? "user-message" : "agent-message"}`}>
      <div className={`message-head ${showSpeaker ? "" : "is-user-head"}`}>
        {showSpeaker ? <span className="speaker">{getSpeakerLabel(message.role)}</span> : null}
        <time>{message.createdAt}</time>
      </div>
      {events?.length ? (
        <AgentEventRenderer
          events={events}
          sessionId={sessionId}
          submittedFormIds={submittedFormIds}
          onQuickAction={onQuickAction}
          onSubmitText={onSubmitText}
          onSubmitQuestion={onSubmitQuestion}
          onUploadQuestionFiles={onUploadQuestionFiles}
        />
      ) : (
        <p>{sanitizeMessageBody(message.body)}</p>
      )}
    </article>
  );
}

function AgentPendingTurnView({ pendingTurn, onRetry }: { pendingTurn: PendingAgentTurn; onRetry: (text: string) => void }) {
  const retryInput = getPendingTurnRetryInput(pendingTurn);
  return (
    <>
      {pendingTurn.userInput ? (
        <article className="message user-message pending-message">
          <div className="message-head is-user-head">
            <time>{pendingTurn.createdAt}</time>
          </div>
          <p>{pendingTurn.userInput}</p>
          {pendingTurn.status === "failed" ? (
            <span className="message-delivery is-failed">这条消息还没有生成回复</span>
          ) : null}
        </article>
      ) : null}

      <article className={`message agent-message agent-loading-message ${pendingTurn.status === "failed" ? "is-failed" : ""}`} aria-live="polite">
        <div className="message-head">
          <span className="speaker">Ad Studio Agent</span>
          <time>{pendingTurn.status === "failed" ? "未完成" : "进行中"}</time>
        </div>
        {pendingTurn.status === "failed" ? (
          <div className="agent-loading-error">
            <strong>{pendingTurn.userVisibleError ?? "这次没有生成有效回复"}</strong>
            {retryInput ? (
              <button className="small-btn" type="button" onClick={() => onRetry(retryInput)}>
                重试
              </button>
            ) : null}
          </div>
        ) : (
          <div className="agent-loading-row">
            <span className="agent-loading-avatar" aria-hidden="true">
              <span />
            </span>
            <div>
              <strong>{pendingTurn.title}</strong>
              <p>{pendingTurn.detail}</p>
            </div>
            <span className="agent-typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </article>
    </>
  );
}

export function AgentWorkbenchView({
  active,
  session,
  startupPrompt = "",
  activeSessionId,
  sessionHistory,
  onSessionChange,
  onNewSession,
  onResumeSession,
  onStartupPromptConsumed,
  onNodeOpen
}: AgentWorkbenchViewProps) {
  const [runtime, setRuntime] = useState<AgentRuntimeState>(() => createInitialLlmAgentRuntime(session));
  const [composerValue, setComposerValue] = useState("");
  const [isAgentBooting, setIsAgentBooting] = useState(false);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingAgentTurn | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [canvasSnapshot, setCanvasSnapshot] = useState<CanvasSnapshot>(() => createEmptyCanvasSnapshot());
  const [projectBundle, setProjectBundle] = useState<AgentProjectBundle | null>(() => getBrowserProjectBundle(session.id));
  const [mediaPreview, setMediaPreview] = useState<CanvasMediaPreviewItem | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replaySelectedSessionId, setReplaySelectedSessionId] = useState(activeSessionId ?? session.id);
  const [sessionReplay, setSessionReplay] = useState<AgentSessionReplayResponse | null>(null);
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [runtimeHydratedSessionId, setRuntimeHydratedSessionId] = useState<string | null>(null);
  const [artifactHydratedSessionId, setArtifactHydratedSessionId] = useState<string | null>(null);
  const artifactStore = useMemo(() => createBrowserWorkspaceArtifactStore(), []);
  const agentProjectStore = useMemo(() => createBrowserAgentProjectStore(), []);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const uploadedPreviewUrlsRef = useRef<Set<string>>(new Set());
  const uploadedAssetIdRef = useRef(0);
  const questionUploadedAssetsRef = useRef<Record<string, AgentUploadedAsset>>({});
  const llmStartupSessionRef = useRef<string | null>(null);
  const storedStartupPromptRef = useRef<{ sessionId: string; prompt: string } | null>(null);
  const artifactPersistKeyRef = useRef<string | null>(null);
  const agentPanelResizeRef = useRef<{ pointerX: number; width: number } | null>(null);
  const generationExecutionRef = useRef<Set<string>>(new Set());
  const generationPollInFlightRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef(session);
  const runtimeRef = useRef(runtime);
  const runtimeArtifactsRef = useRef(runtime.artifacts);
  const canvasSnapshotRef = useRef(canvasSnapshot);
  const onSessionChangeRef = useRef(onSessionChange);
  const onStartupPromptConsumedRef = useRef(onStartupPromptConsumed);
  const sessionHistoryRef = useRef(sessionHistory);
  const sortedSessionHistory = [...sessionHistory].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const activeHistoryId = activeSessionId ?? session.id;
  const replaySessionOptions = useMemo(() => {
    const records = new Map<string, AgentSessionRecord>();
    sortedSessionHistory.forEach((record) => records.set(record.id, record));
    if (!records.has(session.id)) {
      records.set(session.id, {
        id: session.id,
        title: session.projectTitle || "未命名项目",
        product: session.product,
        mode: session.mode,
        updatedAt: new Date().toISOString(),
        session,
        runtime
      });
    }
    return Array.from(records.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [runtime, session, sortedSessionHistory]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isAgentPanelCollapsed, setIsAgentPanelCollapsed] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(agentPanelDefaultWidth);
  const [isAgentPanelResizing, setIsAgentPanelResizing] = useState(false);
  const currentSessionInfo = getCurrentSessionInfo(session);
  const submittedFormIds = useMemo(
    () => new Set(runtime.intakeSubmissions?.map((submission) => submission.formId) ?? []),
    [runtime.intakeSubmissions]
  );
  const titleInputKey = `${session.id}:${currentSessionInfo.title}`;
  const isRuntimeHydrating = active && runtimeHydratedSessionId !== session.id;
  const isAgentBusy = isRuntimeHydrating || isAgentBooting || isAgentThinking || isActiveAgentTurn(pendingTurn);
  const visiblePendingTurn =
    pendingTurn && pendingTurn.status !== "received" && pendingTurn.status !== "cancelled"
      ? pendingTurn
      : null;
  const visibleGenerationTasks = useMemo(
    () => (projectBundle?.generationTasks ?? [])
      .filter((task) => task.sessionId === session.id || task.surface === "agent")
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [projectBundle, session.id]
  );
  const workbenchShellStyle: WorkbenchShellStyle = {
    "--agent-panel-width": `${agentPanelWidth}px`
  };

  const handleCanvasStateChange = useCallback(
    (canvasState: AgentCanvasState) => {
      onSessionChange({
        ...sessionRef.current,
        canvasState
      }, runtimeRef.current);
    },
    [onSessionChange]
  );

  function dispatchCanvasRuntimeActions(actions: AgentTransition["canvasActions"]) {
    actions?.forEach((action) => {
      window.dispatchEvent(new CustomEvent(CANVAS_ACTION_EVENT, { detail: action }));
    });
  }

  function setSessionAndRuntime(nextSession: AgentSession, nextRuntime: AgentRuntimeState) {
    sessionRef.current = nextSession;
    runtimeRef.current = nextRuntime;
    storeAgentRuntime(nextSession.id, nextRuntime);
    onSessionChangeRef.current(nextSession, nextRuntime);
    setRuntime(nextRuntime);
  }

  const syncSessionCanvasFromBundle = useCallback((bundle: AgentProjectBundle | undefined | null) => {
    if (!bundle || bundle.project.id !== sessionRef.current.id) return;
    const canvasState = {
      nodes: bundle.canvasGraph.nodes,
      edges: bundle.canvasGraph.edges
    };
    if (!canvasState.nodes.length && !canvasState.edges.length) return;
    const currentCanvasState = sessionRef.current.canvasState ?? { nodes: [], edges: [] };
    if (JSON.stringify(currentCanvasState) === JSON.stringify(canvasState)) return;

    const nextSession = {
      ...sessionRef.current,
      canvasState
    };
    sessionRef.current = nextSession;
    onSessionChangeRef.current(nextSession, runtimeRef.current);
  }, []);

  const mergeProjectBundle = useCallback((bundle: AgentProjectBundle | undefined | null) => {
    if (!bundle) return;
    upsertBrowserAgentProjectBundle(bundle);
    setProjectBundle(bundle);
    syncSessionCanvasFromBundle(bundle);
  }, [syncSessionCanvasFromBundle]);

  function refreshProjectBundle(projectId = sessionRef.current.id) {
    const bundle = getBrowserProjectBundle(projectId);
    setProjectBundle(bundle);
    return bundle;
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [runtime.messages.length, pendingTurn?.id, pendingTurn?.status]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [composerValue]);

  useEffect(() => {
    if (!isAgentPanelResizing) return undefined;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = agentPanelResizeRef.current;
      if (!resizeStart) return;
      setAgentPanelWidth(clampAgentPanelWidth(resizeStart.width + event.clientX - resizeStart.pointerX));
    }

    function handlePointerUp() {
      agentPanelResizeRef.current = null;
      setIsAgentPanelResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isAgentPanelResizing]);

  useEffect(() => {
    const previewUrls = uploadedPreviewUrlsRef.current;
    return () => {
      for (const previewUrl of previewUrls) URL.revokeObjectURL(previewUrl);
      previewUrls.clear();
    };
  }, [mergeProjectBundle]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  useEffect(() => {
    onStartupPromptConsumedRef.current = onStartupPromptConsumed;
  }, [onStartupPromptConsumed]);

  useEffect(() => {
    sessionHistoryRef.current = sessionHistory;
  }, [sessionHistory]);

  useEffect(() => {
    if (!replaySessionOptions.some((record) => record.id === replaySelectedSessionId)) {
      setReplaySelectedSessionId(activeHistoryId);
    }
  }, [activeHistoryId, replaySelectedSessionId, replaySessionOptions]);

  useEffect(() => {
    runtimeRef.current = runtime;
    runtimeArtifactsRef.current = runtime.artifacts;
  }, [runtime]);

  useEffect(() => {
    canvasSnapshotRef.current = canvasSnapshot;
  }, [canvasSnapshot]);

  useEffect(() => {
    if (activeSessionId !== session.id) return undefined;

    const sessionId = sessionRef.current.id;
    const persistedRuntime = loadPersistedAgentRuntime(sessionId);
    const workspaceRuntime = parsePersistedAgentRuntime(sessionHistoryRef.current.find((record) => record.id === sessionId)?.runtime);
    const restoredRuntime = persistedRuntime.state ?? workspaceRuntime;
    const baseRuntime = restoredRuntime ?? createInitialLlmAgentRuntime(sessionRef.current);
    const baseArtifacts = parseRuntimeArtifacts(baseRuntime.artifacts).artifacts;
    let cancelled = false;
    const restoreTimer = window.setTimeout(() => {
      if (cancelled) return;

      setArtifactHydratedSessionId(null);
      artifactPersistKeyRef.current = null;
      setRuntime(baseRuntime);
      setRuntimeHydratedSessionId(sessionId);
      refreshProjectBundle(sessionId);
      setCanvasSnapshot(createEmptyCanvasSnapshot());
      llmStartupSessionRef.current =
        restoredRuntime && (hasAssistantResponse(restoredRuntime) || hasPersistedRuntimeContent(restoredRuntime))
          ? sessionId
          : llmStartupSessionRef.current === sessionId
            ? sessionId
            : null;
      setIsAgentBooting(false);
      setIsAgentThinking(false);
      setPendingTurn(null);

      if (persistedRuntime.artifactRestoreError) {
        void artifactStore.recordRestoreFailure(sessionId, persistedRuntime.artifactRestoreError, "runtime-localStorage");
      }

      void artifactStore.load(sessionId)
        .then((storedArtifacts) => {
          if (cancelled) return;
          const nextArtifacts = isAgentArtifactsEmpty(storedArtifacts) ? baseArtifacts : storedArtifacts;
          artifactPersistKeyRef.current = getArtifactPersistKey(sessionId, nextArtifacts);
          setArtifactHydratedSessionId(sessionId);
          setRuntime((current) => ({
            ...current,
            artifacts: nextArtifacts
          }));

          if (isAgentArtifactsEmpty(storedArtifacts) && !isAgentArtifactsEmpty(baseArtifacts)) {
            void artifactStore.save(sessionId, baseArtifacts);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          void artifactStore.recordRestoreFailure(sessionId, error, "workspace");
          artifactPersistKeyRef.current = getArtifactPersistKey(sessionId, baseArtifacts);
          setArtifactHydratedSessionId(sessionId);
          setRuntime((current) => ({
            ...current,
            artifacts: baseArtifacts
          }));
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimer);
    };
  }, [activeSessionId, artifactStore, session.id]);

  useEffect(() => {
    if (activeSessionId !== session.id) return;
    refreshProjectBundle(session.id);
  }, [activeSessionId, session.id, runtimeHydratedSessionId]);

  useEffect(() => {
    if (activeSessionId !== session.id) return;
    if (runtimeHydratedSessionId !== session.id) return;

    storeAgentRuntime(session.id, runtime);
    onSessionChangeRef.current(sessionRef.current, runtime);
    if (artifactHydratedSessionId !== session.id) return;
    const parsedArtifacts = parseRuntimeArtifacts(runtime.artifacts);
    if (parsedArtifacts.error) {
      void artifactStore.recordRestoreFailure(session.id, parsedArtifacts.error, "runtime-localStorage");
      return;
    }

    const persistKey = getArtifactPersistKey(session.id, parsedArtifacts.artifacts);
    if (artifactPersistKeyRef.current === persistKey) return;

    artifactPersistKeyRef.current = persistKey;
    void artifactStore.save(session.id, parsedArtifacts.artifacts).catch((error) => {
      void artifactStore.recordRestoreFailure(session.id, error, "workspace");
    });
  }, [activeSessionId, artifactHydratedSessionId, artifactStore, runtime, runtimeHydratedSessionId, session.id]);

  function createUploadedAsset(file: File, role: AgentUploadedAsset["role"]): AgentUploadedAsset | null {
    const mediaKind = getMediaFileKind(file);
    if (!mediaKind) return null;

    const previewUrl = URL.createObjectURL(file);
    uploadedPreviewUrlsRef.current.add(previewUrl);
    uploadedAssetIdRef.current += 1;

    return {
      id: `asset-${role}-${file.lastModified}-${uploadedAssetIdRef.current}`,
      role,
      name: file.name,
      kind: mediaKind,
      source: "upload",
      previewUrl,
      uploadStatus: "uploaded",
      analysisStatus: "idle"
    };
  }

  function addUploadedFiles(files: File[], role: AgentUploadedAsset["role"]) {
    return getMediaFiles(files)
      .map((file) => createUploadedAsset(file, role))
      .filter((asset): asset is AgentUploadedAsset => Boolean(asset));
  }

  function addUploadedReferenceFiles(files: File[]) {
    const assets = addUploadedFiles(files, "reference_asset");

    if (!assets.length) return;

    const currentSession = sessionRef.current;
    const nextSession: AgentSession = {
      ...currentSession,
      lifecycle: "intake",
      competitor: currentSession.competitor || assets[0]?.name || "",
      uploadedAssets: mergeUploadedAssets(currentSession.uploadedAssets, assets)
    };
    const nextRuntime: AgentRuntimeState = {
      ...runtimeRef.current,
      messages: [
        ...runtimeRef.current.messages,
        createSystemMessage(`已上传 ${assets.length} 个参考素材：${assets.map((asset) => asset.name).join("、")}。继续补充需求后发送，我会一起判断。`)
      ]
    };

    sessionRef.current = nextSession;
    runtimeRef.current = nextRuntime;
    onSessionChange(nextSession, nextRuntime);
    storeAgentRuntime(nextSession.id, nextRuntime);
    setRuntime(nextRuntime);
  }

  function uploadQuestionFiles(input: AgentQuestionUploadInput): AgentQuestionSubmittedAsset[] {
    const role = isAgentAssetRole(input.uploadRole) ? input.uploadRole : "reference_asset";
    const assets = addUploadedFiles(input.files, role);
    if (!assets.length) return [];

    assets.forEach((asset) => {
      questionUploadedAssetsRef.current[asset.id] = asset;
    });

    const currentSession = sessionRef.current;
    const nextSession: AgentSession = {
      ...currentSession,
      lifecycle: "intake",
      competitor:
        currentSession.competitor ||
        assets.find((asset) => asset.role === "competitor_asset" || asset.role === "reference_asset")?.name ||
        "",
      product: currentSession.product || assets.find((asset) => asset.role === "product_pack")?.name || "",
      uploadedAssets: mergeUploadedAssets(currentSession.uploadedAssets, assets)
    };
    const nextRuntime: AgentRuntimeState = {
      ...runtimeRef.current,
      messages: [
        ...runtimeRef.current.messages,
        createSystemMessage(`已在交互卡上传 ${assets.length} 个素材：${assets.map((asset) => asset.name).join("、")}`)
      ]
    };

    sessionRef.current = nextSession;
    runtimeRef.current = nextRuntime;
    onSessionChange(nextSession, nextRuntime);
    storeAgentRuntime(nextSession.id, nextRuntime);
    setRuntime(nextRuntime);

    return assets.map((asset) => ({
      id: asset.id,
      fieldId: input.fieldId,
      uploadRole: role,
      name: asset.name,
      kind: asset.kind,
      source: asset.source,
      previewUrl: asset.previewUrl
    }));
  }

  function resolveSubmittedQuestionAssets(submission: AgentQuestionSubmission) {
    const submittedAssets = submission.assets
      .map((asset): AgentUploadedAsset | null => {
        const uploadedAsset = questionUploadedAssetsRef.current[asset.id];
        if (uploadedAsset) return uploadedAsset;
        if (!isAgentAssetRole(asset.uploadRole)) return null;
        return {
          id: asset.id,
          role: asset.uploadRole,
          name: asset.name,
          kind: asset.kind,
          source: asset.source ?? (asset.uploadRole === "product_pack" ? "mock" : "upload"),
          previewUrl: asset.previewUrl,
          uploadStatus: asset.uploadRole === "product_pack" ? undefined : "uploaded",
          analysisStatus: asset.uploadRole === "product_pack" ? undefined : "idle"
        };
      })
      .filter((asset): asset is AgentUploadedAsset => Boolean(asset));

    return submittedAssets;
  }

  function createIntakeSubmissionMessage(
    submission: AgentQuestionSubmission,
    submittedAssets: AgentUploadedAsset[]
  ): { message: AgentMessage; fact: AgentIntakeSubmissionFact } {
    const submittedAt = new Date().toISOString();
    const productAsset = submittedAssets.find((asset) => asset.role === "product_pack");
    const message = createLocalMessage("user", `提交信息「${submission.title}」：\n${submission.summary}`);
    const fact: AgentIntakeSubmissionFact = {
      formId: submission.formId,
      title: submission.title,
      answers: submission.answers,
      uploadedAssetIds: submittedAssets.map((asset) => asset.id),
      selectedProductAssetId: productAsset?.id,
      productName: productAsset?.name,
      submittedAt,
      sourceMessageId: message.id
    };

    return {
      fact,
      message: {
        ...message,
        metadata: {
          intakeSubmission: fact
        },
        events: [
          {
            kind: "intake_submission",
            submission: fact
          },
          {
            kind: "text",
            text: `已提交信息「${submission.title}」。`
          }
        ]
      }
    };
  }

  function submitStructuredQuestion(submission: AgentQuestionSubmission) {
    if (isAgentBusy) return;
    const submittedAssets = resolveSubmittedQuestionAssets(submission);
    const currentSession = sessionRef.current;
    const productAsset = submittedAssets.find((asset) => asset.role === "product_pack");
    const productName = productAsset?.name ?? currentSession.product;
    const referenceAssetName =
      submittedAssets.find((asset) => asset.role === "competitor_asset" || asset.role === "reference_asset")?.name ??
      currentSession.uploadedAssets.find((asset) => asset.role === "competitor_asset")?.name ??
      currentSession.competitor;
    const { message: intakeMessage, fact } = createIntakeSubmissionMessage(submission, submittedAssets);
    const nextSession: AgentSession = {
      ...currentSession,
      lifecycle: "intake",
      product: productName,
      competitor: referenceAssetName,
      creativeGoal: currentSession.creativeGoal,
      projectTitle:
        productName && currentSession.projectTitle === "未命名项目"
          ? `广告项目 · ${productName}`
          : currentSession.projectTitle,
      uploadedAssets: mergeUploadedAssets(currentSession.uploadedAssets, submittedAssets)
    };
    const nextRuntime: AgentRuntimeState = {
      ...runtimeRef.current,
      stage: "collecting",
      brief: {
        ...runtimeRef.current.brief,
        product: productName,
        competitorAsset: referenceAssetName,
        originalPrompt: runtimeRef.current.brief.originalPrompt || nextSession.originalPrompt
      },
      pendingConfirmation: null,
      messages: [...runtimeRef.current.messages, intakeMessage],
      intakeSubmissions: [...(runtimeRef.current.intakeSubmissions ?? []), fact]
    };

    sessionRef.current = nextSession;
    runtimeRef.current = nextRuntime;
    onSessionChange(nextSession, nextRuntime);
    storeAgentRuntime(nextSession.id, nextRuntime);
    setRuntime(nextRuntime);
    setPendingTurn(createPendingAgentTurn({
      title: "正在提交信息并等待 Agent 回复",
      detail: "会把这次提交的信息和素材一起发送给 Agent。"
    }));
    void applyTransition(submitInternalAgentTask(
      nextRuntime,
      "用户刚刚提交了信息卡。请结合已提交信息、素材和当前对话判断下一步；当前只允许对话、保存方案或继续追问，不要返回画布动作。",
      nextSession,
      canvasSnapshot
    ));
  }

  function submitQuestion(submission: AgentQuestionSubmission) {
    if (isAgentBusy) return;
    submitStructuredQuestion(submission);
  }

  const applyTransition = useCallback(async (result: AgentControllerResult) => {
    setPendingTurn((current) => current ? markAgentTurnRequesting(current) : null);
    setIsAgentThinking(true);
    try {
      const transition: AgentTransition = await result;
      const nextSession = syncSessionFromRuntimeBrief(sessionRef.current, transition.state);
      if (transition.approvalRequest) {
        const patchedBundle = await agentProjectStore.saveProjectPatch(nextSession.id, createApprovalRequestProjectPatch({
          session: nextSession,
          runtime: transition.state,
          approval: transition.approvalRequest,
          canvasState: nextSession.canvasState
        }));
        setProjectBundle(patchedBundle);
      }
      setSessionAndRuntime(nextSession, transition.state);
      setPendingTurn((current) => current ? markAgentTurnReceived(current) : null);
    } catch (error) {
      setPendingTurn((current) => current
        ? markAgentTurnFailed(current, {
            userVisibleError: "这次没有生成有效回复",
            developerError: error instanceof Error ? error.message : String(error)
          })
        : null);
    } finally {
      setIsAgentThinking(false);
    }
  }, [agentProjectStore]);

  useEffect(() => {
    if (!active) return undefined;
    const currentSession = sessionRef.current;
    if (artifactHydratedSessionId !== currentSession.id) return undefined;
    if (llmStartupSessionRef.current === currentSession.id) return undefined;
    const startupText = startupPrompt.trim();
    if (startupText) {
      storedStartupPromptRef.current = { sessionId: currentSession.id, prompt: startupText };
    } else if (storedStartupPromptRef.current?.sessionId !== currentSession.id) {
      const storedPrompt = takeStoredStartupPrompt(currentSession.id);
      storedStartupPromptRef.current = storedPrompt ? { sessionId: currentSession.id, prompt: storedPrompt } : null;
    }
    const resolvedStartupPrompt = storedStartupPromptRef.current?.sessionId === currentSession.id
      ? storedStartupPromptRef.current.prompt
      : "";
    const hasStartupPrompt = Boolean(resolvedStartupPrompt);
    const hasSessionStartupContext = hasAgentStartupContext(currentSession);
    if (!hasStartupPrompt && !hasSessionStartupContext) {
      llmStartupSessionRef.current = currentSession.id;
      return undefined;
    }

    const initialRuntime = {
      ...createInitialLlmAgentRuntime(currentSession),
      artifacts: parseRuntimeArtifacts(runtimeArtifactsRef.current).artifacts
    };
    llmStartupSessionRef.current = currentSession.id;
    let cancelled = false;
    const bootTimer = window.setTimeout(() => {
      if (cancelled) return;
      const bootSession = sessionRef.current;
      const bootCanvasSnapshot = canvasSnapshotRef.current;
      const sessionStartupText = bootSession.originalPrompt.trim();
      const startupTaskText = resolvedStartupPrompt || sessionStartupText;
      const useM3GoldenPathDemo = shouldUseM3GoldenPathDemo(startupTaskText);
      setIsAgentBooting(true);
      setRuntime(initialRuntime);
      setPendingTurn(createPendingAgentTurn({
        userInput: hasStartupPrompt ? resolvedStartupPrompt : undefined,
        title: useM3GoldenPathDemo ? "正在运行 M3 安全路径" : "正在发送初始信息并等待 Agent 回复",
        detail: useM3GoldenPathDemo
          ? "我会保存 artifact 并返回不可执行 proposal，不触发画布或媒体生成。"
          : "会根据你的目标、素材和制作边界生成第一版回复。"
      }));

      const startupResult = useM3GoldenPathDemo
        ? runM3GoldenPathDemo({
            state: initialRuntime,
            text: startupTaskText,
            session: bootSession,
            canvas: bootCanvasSnapshot,
            artifactStore,
            showUserMessage: false
          })
        : hasStartupPrompt
          ? llmAgentController.submitText(initialRuntime, resolvedStartupPrompt, bootSession, bootCanvasSnapshot)
          : submitInternalAgentTask(initialRuntime, FIRST_RUN_AGENT_PROMPT, bootSession, bootCanvasSnapshot);

      void Promise.resolve(startupResult)
        .then((transition) => {
          if (cancelled) return undefined;
          return applyTransition(transition);
        })
        .catch((error) => {
          if (cancelled) return;
          setPendingTurn((current) => current
            ? markAgentTurnFailed(current, {
                userVisibleError: "这次没有生成有效回复",
                developerError: error instanceof Error ? error.message : String(error)
              })
            : null);
        })
        .finally(() => {
          if (!cancelled && hasStartupPrompt) {
            storedStartupPromptRef.current = null;
            onStartupPromptConsumedRef.current?.(bootSession.id);
          }
          if (!cancelled) setIsAgentBooting(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
    };
  }, [active, applyTransition, artifactHydratedSessionId, artifactStore, session.id, startupPrompt]);

  function runQuickAction(action: AgentQuickAction) {
    if (isAgentBusy) return;
    const pendingApproval = runtimeRef.current.pendingConfirmation;
    if (pendingApproval?.approvalRequestId && action === "confirm_pending") {
      if (pendingApproval.kind === "controlled_generation" || pendingApproval.generation) {
        void executePendingGenerationApproval();
      } else {
        void executePendingCanvasApproval();
      }
      return;
    }
    if (pendingApproval?.approvalRequestId && action === "request_adjustment") {
      void rejectPendingCanvasApproval();
      return;
    }
    if (action === "confirm_pending" || action === "request_adjustment") {
      return;
    }

    setPendingTurn(createPendingAgentTurn({
      title: "正在提交选择并等待 Agent 回复",
      detail: "会把你的选择和当前会话一起发送给 Agent。"
    }));
    void applyTransition(llmAgentController.submitQuickAction(runtime, action, session, canvasSnapshot));
  }

  async function readGenerationApiResponse(response: Response): Promise<AgentGenerationApiResponse> {
    const data = await response.json().catch(() => ({}));
    return data && typeof data === "object" ? data as AgentGenerationApiResponse : { ok: false, error: "Invalid generation response." };
  }

  function appendGenerationMessage(input: {
    pending: NonNullable<AgentRuntimeState["pendingConfirmation"]>;
    response: AgentGenerationApiResponse;
    userVisibleMessage: string;
  }) {
    const taskStatus = input.response.task?.status;
    const nextRuntime: AgentRuntimeState = {
      ...runtimeRef.current,
      stage: taskStatus && !isGenerationTaskTerminal(taskStatus) ? "executing" : "collecting",
      pendingConfirmation: null,
      messages: [
        ...runtimeRef.current.messages,
        createLocalMessage("user", input.pending.confirmLabel),
        createLocalMessage("assistant", input.userVisibleMessage, {
          events: [
            {
              kind: "status",
              label: input.response.ok ? "executing" : "error",
              detail: input.response.ok ? getGenerationStatusLabel(taskStatus ?? "queued") : "真实生成未启动"
            },
            { kind: "text", text: input.userVisibleMessage },
            ...(input.response.temporaryExternalAssetWarning
              ? [
                  {
                    kind: "warning" as const,
                    text: input.response.temporaryExternalAssetWarning
                  }
                ]
              : [])
          ]
        })
      ],
      actionHistory: [
        ...runtimeRef.current.actionHistory,
        {
          id: input.pending.id,
          title: input.pending.title,
          actionCount: 1,
          createdAt: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
          })
        }
      ]
    };
    setSessionAndRuntime(sessionRef.current, nextRuntime);
  }

  const pollGenerationTask = useCallback(async (taskId: string, providerTaskId?: string) => {
    const taskKey = taskId || providerTaskId;
    if (!taskKey || generationPollInFlightRef.current.has(taskKey)) return;
    generationPollInFlightRef.current.add(taskKey);
    try {
      const response = await fetch("/api/agent/generation/poll", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId: sessionRef.current.id,
          taskId: taskId || undefined,
          providerTaskId
        })
      });
      const data = await response.json().catch(() => ({})) as AgentGenerationApiResponse;
      if (data && typeof data === "object") {
        const bundle = data.bundle;
        if (bundle) {
          mergeProjectBundle(bundle);
        }
      }
    } finally {
      generationPollInFlightRef.current.delete(taskKey);
    }
  }, [mergeProjectBundle]);

  function previewGenerationTask(task: GenerationTaskRecord) {
    const outputUrl = getTaskOutputUrl(projectBundle, task);
    if (!outputUrl || (task.kind !== "image" && task.kind !== "video")) return;
    setMediaPreview({
      kind: task.kind,
      title: task.output?.title ?? task.modelName,
      src: outputUrl,
      playbackSrc: task.kind === "video" && isPlayableVideoSrc(outputUrl) ? outputUrl : undefined
    });
  }

  async function proposeGenerationRepair(task: GenerationTaskRecord) {
    const bundle = projectBundle;
    const asset = getTaskAsset(bundle, task);
    const nodeId = getTaskCanvasNodeId(bundle, task);
    const storageProvider = asset?.storage?.provider ?? "unknown";
    const recoverable = asset?.recoverable === true;
    const now = new Date().toISOString();

    if (bundle) {
      const patchedBundle = await agentProjectStore.saveProjectPatch(bundle.project.id, {
        events: [
          {
            projectId: bundle.project.id,
            sessionId: task.sessionId,
            actorType: "agent",
            eventType: "repair.proposed",
            objectType: "generation_task",
            objectId: task.id,
            correlationId: task.approvalRequestId,
            requestId: task.idempotencyKey,
            payload: {
              taskId: task.id,
              mediaAssetId: asset?.id,
              canvasNodeId: nodeId,
              storageProvider,
              recoverable
            },
            createdAt: now
          }
        ],
        updatedAt: now
      });
      mergeProjectBundle(patchedBundle);
    }

    const repairText = "已基于当前生成结果准备局部返工提案。";
    const nextRuntime: AgentRuntimeState = {
      ...runtimeRef.current,
      stage: "rework",
      messages: [
        ...runtimeRef.current.messages,
        createLocalMessage("user", "局部返工这个生成结果"),
        createLocalMessage("assistant", repairText, {
          events: [
            { kind: "status", label: "planning", detail: "整理返工提案" },
            {
              kind: "confirmation",
              confirmation: {
                id: `repair-proposal-${task.id}`,
                kind: "rework_icon",
                title: "局部返工提案",
                summary: "先记录返工意图和影响范围，不直接重新生成，也不消耗 credits。",
                bullets: [
                  "目标：当前生成结果。",
                  nodeId ? "影响范围：当前结果已关联到画布。" : "影响范围：当前结果尚未关联到指定画布节点。",
                  recoverable
                    ? "当前结果已保存，可作为返工输入。"
                    : "当前结果仅可临时预览，返工前应确认素材是否仍可访问。",
                  "下一步只生成新的确认单；确认后才会重新生成。"
                ],
                confirmLabel: "生成返工确认单",
                secondaryLabel: "先不返工",
                executable: false,
                actions: nodeId ? [{ type: "markNodeStale", nodeId, reason: "用户准备局部返工生成结果" }] : []
              }
            }
          ]
        })
      ]
    };
    setSessionAndRuntime(sessionRef.current, nextRuntime);
  }

  function downloadSessionReplay(data: AgentSessionReplayResponse, sessionId: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ad-studio-session-replay-${sessionId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchSessionReplay(sessionId: string) {
    await syncBrowserAgentWorkspaceToServer().catch(() => undefined);
    const response = await fetch(`/api/agent/session-replay?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: "no-store"
    });
    const data = await response.json().catch(() => null);
    return { response, data: data as AgentSessionReplayResponse | null };
  }

  async function openSessionReplay(sessionId = replaySelectedSessionId) {
    setReplayOpen(true);
    setHistoryOpen(false);
    setReplaySelectedSessionId(sessionId);
    setIsReplayLoading(true);
    setReplayError("");
    try {
      const { response, data } = await fetchSessionReplay(sessionId);
      if (!response.ok || !data?.pmReview) throw new Error(data && "error" in data ? String(data.error) : "会话回放读取失败。");
      setSessionReplay(data);
    } catch (error) {
      setSessionReplay(null);
      setReplayError(error instanceof Error ? error.message : "会话回放读取失败。");
    } finally {
      setIsReplayLoading(false);
    }
  }

  async function exportSessionReplay(sessionId = sessionRef.current.id) {
    const { response, data } = await fetchSessionReplay(sessionId);
    if (!response.ok || !data) {
      setPendingTurn(createPendingAgentTurn({
        title: "会话回放导出失败",
        detail: "本地调试数据暂时不可用。"
      }));
      setPendingTurn((current) => current ? markAgentTurnFailed(current, { userVisibleError: "会话回放导出失败。" }) : null);
      return;
    }

    downloadSessionReplay(data, sessionId);
  }

  async function executePendingGenerationApproval() {
    const pending = runtimeRef.current.pendingConfirmation;
    if (!pending?.approvalRequestId || !pending.actionHash || !pending.idempotencyKey || !pending.generation) return;
    if (generationExecutionRef.current.has(pending.approvalRequestId)) return;
    generationExecutionRef.current.add(pending.approvalRequestId);

    setPendingTurn(createPendingAgentTurn({
      title: "正在校验确认并提交生成请求",
      detail: "会先确认授权有效，再提交生成请求。"
    }));
    setIsAgentThinking(true);

    try {
      await syncBrowserAgentWorkspaceToServer().catch(() => undefined);
      const response = await fetch("/api/agent/generation/execute", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId: sessionRef.current.id,
          approvalRequestId: pending.approvalRequestId,
          actionHash: pending.actionHash,
          idempotencyKey: pending.idempotencyKey,
          generation: pending.generation,
          actorId: "user"
        })
      });
      const data = await readGenerationApiResponse(response);
      mergeProjectBundle(data.bundle);

      if (!response.ok || !data.ok) {
        const message = sanitizeOperationalMessage(data.blocker ?? data.error ?? "真实生成提交失败。", "真实生成提交失败，请稍后重试。");
        appendGenerationMessage({
          pending,
          response: data,
          userVisibleMessage: message
        });
        setPendingTurn((current) => current ? markAgentTurnFailed(current, { userVisibleError: message }) : null);
        return;
      }

      const message = data.idempotent
        ? "这次确认已经有对应生成任务，本次没有重复提交。"
        : "已提交真实生成请求。下方状态卡会显示排队中、生成中、生成完成或失败，并在成功后给出预览入口。";
      appendGenerationMessage({
        pending,
        response: data,
        userVisibleMessage: message
      });
      setPendingTurn((current) => current ? markAgentTurnReceived(current) : null);

      if (data.task && !isGenerationTaskTerminal(data.task.status)) {
        window.setTimeout(() => {
          void pollGenerationTask(data.task?.id ?? "", data.task?.providerTaskId);
        }, 1000);
      }
    } catch (error) {
      const userVisibleError = sanitizeOperationalMessage(error instanceof Error ? error.message : String(error), "真实生成提交失败，请稍后重试。");
      setPendingTurn((current) => current
        ? markAgentTurnFailed(current, {
            userVisibleError,
            developerError: userVisibleError
          })
        : null);
    } finally {
      generationExecutionRef.current.delete(pending.approvalRequestId);
      setIsAgentThinking(false);
    }
  }

  useEffect(() => {
    if (!active || !projectBundle) return undefined;
    const activeTasks = projectBundle.generationTasks.filter((task) => (
      (task.sessionId === session.id || task.surface === "agent") &&
      !isGenerationTaskTerminal(task.status)
    ));
    if (!activeTasks.length) return undefined;

    const pollAll = () => {
      activeTasks.forEach((task) => {
        void pollGenerationTask(task.id, task.providerTaskId);
      });
    };
    const firstPoll = window.setTimeout(pollAll, 1200);
    const interval = window.setInterval(pollAll, 4000);

    return () => {
      window.clearTimeout(firstPoll);
      window.clearInterval(interval);
    };
  }, [active, pollGenerationTask, projectBundle, session.id]);

  async function executePendingCanvasApproval() {
    const pending = runtimeRef.current.pendingConfirmation;
    if (!pending?.approvalRequestId || !pending.actionHash || !pending.idempotencyKey) return;

    setPendingTurn(createPendingAgentTurn({
      title: "正在执行确认的画布方案",
      detail: "只会创建/更新画布结构，不会生成媒体或扣费。"
    }));
    setIsAgentThinking(true);

    try {
      const result = await executeApprovalActionBatch(agentProjectStore, {
        projectId: sessionRef.current.id,
        approvalRequestId: pending.approvalRequestId,
        actionHash: pending.actionHash,
        idempotencyKey: pending.idempotencyKey,
        actorId: "user"
      });

      if (!result.ok || !result.canvasGraph) {
        mergeProjectBundle(result.bundle);
        const message = sanitizeOperationalMessage(result.blocker ?? result.error ?? "画布方案执行失败。", "画布方案执行失败，请重新确认后再试。");
        const nextRuntime: AgentRuntimeState = {
          ...runtimeRef.current,
          messages: [
            ...runtimeRef.current.messages,
            createLocalMessage("assistant", message, {
              events: [
                { kind: "status", label: "error", detail: "确认执行被阻止" },
                { kind: "warning", text: message }
              ]
            })
          ]
        };
        setSessionAndRuntime(sessionRef.current, nextRuntime);
        setPendingTurn((current) => current ? markAgentTurnFailed(current, { userVisibleError: message }) : null);
        return;
      }

      dispatchCanvasRuntimeActions(result.actions);
      mergeProjectBundle(result.bundle);

      const nextSession: AgentSession = {
        ...sessionRef.current,
        lifecycle: sessionRef.current.lifecycle === "empty" ? "intake" : sessionRef.current.lifecycle,
        canvasState: {
          nodes: result.canvasGraph.nodes,
          edges: result.canvasGraph.edges
        }
      };
      const message = result.idempotent
        ? "这批画布动作此前已执行，本次没有重复创建节点。"
        : pending.completionMessage;
      const nextRuntime: AgentRuntimeState = {
        ...runtimeRef.current,
        stage: pending.nextStage,
        pendingConfirmation: null,
        messages: [
          ...runtimeRef.current.messages,
          createLocalMessage("user", pending.confirmLabel),
          createLocalMessage("assistant", message, {
            events: [
              { kind: "status", label: "done", detail: "画布结构已更新" },
              { kind: "text", text: message },
              ...result.actions.map((canvasAction) => ({
                kind: "canvas_action" as const,
                action: canvasAction,
                status: "done" as const
              }))
            ]
          })
        ],
        actionHistory: [
          ...runtimeRef.current.actionHistory,
          {
            id: pending.id,
            title: pending.title,
            actionCount: pending.actions.length,
            createdAt: new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit"
            })
          }
        ]
      };

      setSessionAndRuntime(nextSession, nextRuntime);
      setPendingTurn((current) => current ? markAgentTurnReceived(current) : null);
    } catch (error) {
      const userVisibleError = sanitizeOperationalMessage(error instanceof Error ? error.message : String(error), "画布方案执行失败，请重新确认后再试。");
      setPendingTurn((current) => current
        ? markAgentTurnFailed(current, {
            userVisibleError,
            developerError: userVisibleError
          })
        : null);
    } finally {
      setIsAgentThinking(false);
    }
  }

  async function rejectPendingCanvasApproval() {
    const pending = runtimeRef.current.pendingConfirmation;
    if (!pending?.approvalRequestId) return;

    setPendingTurn(createPendingAgentTurn({
      title: "正在记录你的调整要求",
      detail: "这版方案会被标记为已拒绝，画布不会改变。"
    }));
    setIsAgentThinking(true);

    try {
      await rejectApprovalRequest(agentProjectStore, {
        projectId: sessionRef.current.id,
        approvalRequestId: pending.approvalRequestId,
        actorId: "user"
      });
      refreshProjectBundle();
      const isGenerationApproval = pending.kind === "controlled_generation" || Boolean(pending.generation);
      const assistantText = isGenerationApproval
        ? "已拒绝这版真实生成方案，没有提交生成请求。你可以直接告诉我要调整提示词、时长或画面方向。"
        : "已拒绝这版画布方案，画布未改变。你可以直接告诉我要调整哪些节点或顺序。";
      const nextRuntime: AgentRuntimeState = {
        ...runtimeRef.current,
        stage: "collecting",
        pendingConfirmation: null,
        messages: [
          ...runtimeRef.current.messages,
          createLocalMessage("user", pending.secondaryLabel ?? "先调整"),
          createLocalMessage("assistant", assistantText, {
            events: [
              { kind: "status", label: "done", detail: "方案已拒绝" },
              { kind: "text", text: assistantText }
            ]
          })
        ]
      };
      setSessionAndRuntime(sessionRef.current, nextRuntime);
      setPendingTurn((current) => current ? markAgentTurnReceived(current) : null);
    } catch (error) {
      const userVisibleError = sanitizeOperationalMessage(error instanceof Error ? error.message : String(error), "调整要求记录失败，请稍后重试。");
      setPendingTurn((current) => current
        ? markAgentTurnFailed(current, {
            userVisibleError,
            developerError: userVisibleError
          })
        : null);
    } finally {
      setIsAgentThinking(false);
    }
  }

  function submitTextValue(value: string, options: { retry?: boolean } = {}) {
    if (isAgentBusy) return;
    const text = value.trim();
    if (!text) return;
    setComposerValue("");
    const useM3GoldenPathDemo = shouldUseM3GoldenPathDemo(text);
    setPendingTurn(createPendingAgentTurn({
      userInput: text,
      status: options.retry ? "retrying" : "submitted",
      title: useM3GoldenPathDemo
        ? "正在运行 M3 安全路径"
        : "正在发送消息并等待 Agent 回复",
      detail: useM3GoldenPathDemo
        ? "我会保存 artifact 并返回不可执行 proposal，不触发画布或媒体生成。"
        : "会把你的消息、素材和当前项目一起发送给 Agent。"
    }));
    const submissionResult = useM3GoldenPathDemo
      ? runM3GoldenPathDemo({
          state: runtime,
          text,
          session,
          canvas: canvasSnapshot,
          artifactStore,
          showUserMessage: true
        })
      : llmAgentController.submitText(runtime, text, session, canvasSnapshot);
    void applyTransition(submissionResult);
  }

  function submitComposer() {
    submitTextValue(composerValue);
  }

  function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>) {
    addUploadedReferenceFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleMediaDrag(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropActive(true);
  }

  function handleMediaDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDropActive(false);
  }

  function handleMediaDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setIsDropActive(false);
    addUploadedReferenceFiles(Array.from(event.dataTransfer.files));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitComposer();
  }

  function handleNewSession() {
    setHistoryOpen(false);
    onNewSession();
  }

  function handleResumeSession(sessionId: string) {
    setHistoryOpen(false);
    onResumeSession(sessionId);
  }

  function commitProjectTitle(value: string) {
    const nextTitle = value.trim() || "未命名项目";
    if (nextTitle === currentSessionInfo.title) return nextTitle;
    onSessionChange({
      ...session,
      projectTitle: nextTitle
    }, runtimeRef.current);
    return nextTitle;
  }

  function handleProjectTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.value = currentSessionInfo.title;
      event.currentTarget.blur();
    }
  }

  function handleAgentPanelToggle() {
    if (!isAgentPanelCollapsed) {
      setHistoryOpen(false);
      setReplayOpen(false);
    }
    setIsAgentPanelCollapsed(!isAgentPanelCollapsed);
  }

  function handleAgentPanelResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (isAgentPanelCollapsed) return;
    event.preventDefault();
    agentPanelResizeRef.current = {
      pointerX: event.clientX,
      width: agentPanelWidth
    };
    setIsAgentPanelResizing(true);
  }

  function handleAgentPanelResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isAgentPanelCollapsed) return;

    if (event.key === "Home") {
      event.preventDefault();
      setAgentPanelWidth(agentPanelMinWidth);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setAgentPanelWidth(agentPanelMaxWidth);
      return;
    }

    const delta = event.shiftKey ? 48 : 24;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setAgentPanelWidth((width) => clampAgentPanelWidth(width - delta));
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setAgentPanelWidth((width) => clampAgentPanelWidth(width + delta));
    }
  }

  return (
    <section id="workbench" className={`view workbench-view ${active ? "is-active" : ""}`} aria-label="Agent workbench">
      <div
        className={`studio-shell ${isAgentPanelCollapsed ? "is-agent-panel-collapsed" : ""} ${isAgentPanelResizing ? "is-agent-panel-resizing" : ""}`}
        style={workbenchShellStyle}
      >
        <aside className={`agent-panel ${isAgentPanelCollapsed ? "is-collapsed" : ""}`}>
          <div className="agent-head">
            <button
              className="agent-icon-btn agent-collapse-btn"
              type="button"
              aria-label={isAgentPanelCollapsed ? "展开 Agent 对话框" : "折叠 Agent 对话框"}
              aria-expanded={!isAgentPanelCollapsed}
              onClick={handleAgentPanelToggle}
            >
              {isAgentPanelCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <div className="agent-head-copy">
              <input
                key={titleInputKey}
                className="agent-title-input"
                defaultValue={currentSessionInfo.title}
                aria-label="项目名称"
                placeholder="未命名项目"
                onBlur={(event) => {
                  event.currentTarget.value = commitProjectTitle(event.currentTarget.value);
                }}
                onKeyDown={handleProjectTitleKeyDown}
              />
              <small>{currentSessionInfo.meta}</small>
            </div>
            <div className="agent-head-actions">
              <button
                className="agent-icon-btn"
                type="button"
                aria-label="历史项目"
                aria-expanded={historyOpen}
                onClick={() => {
                  setReplayOpen(false);
                  setHistoryOpen((open) => !open);
                }}
              >
                <History size={17} />
              </button>
              <button className="agent-icon-btn" type="button" aria-label="新建项目" onClick={handleNewSession}>
                <MessageSquarePlus size={17} />
              </button>
              <button
                className="agent-icon-btn"
                type="button"
                aria-label="查看会话回放"
                aria-expanded={replayOpen}
                onClick={() => {
                  if (replayOpen) {
                    setReplayOpen(false);
                    return;
                  }
                  void openSessionReplay(activeHistoryId);
                }}
              >
                <FileSearch size={16} />
              </button>
              <button className="agent-icon-btn" type="button" aria-label="导出会话回放" onClick={() => void exportSessionReplay()}>
                <Download size={16} />
              </button>
            </div>
          </div>

          {historyOpen ? (
            <div className="agent-history-drawer" role="dialog" aria-modal="false" aria-label="历史项目">
              <div className="agent-history-head">
                <div>
                  <strong>历史项目</strong>
                  <span>{sortedSessionHistory.length ? `${sortedSessionHistory.length} 个最近项目` : "暂无历史项目"}</span>
                </div>
                <button className="agent-icon-btn" type="button" aria-label="关闭历史项目" onClick={() => setHistoryOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              {sortedSessionHistory.length ? (
                <div className="agent-history-list">
                  {sortedSessionHistory.map((item) => (
                    <button
                      className={`agent-history-item ${item.id === activeHistoryId ? "is-selected" : ""}`}
                      type="button"
                      key={item.id}
                      onClick={() => handleResumeSession(item.id)}
                      disabled={item.id === activeHistoryId}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.product || "未指定产品"} · {getModeLabel(item.mode)}</span>
                      <small>{formatSessionUpdatedAt(item.updatedAt)}</small>
                      {item.id === activeHistoryId ? <em>当前项目</em> : null}
                    </button>
                  ))}
                </div>
              ) : (
              <div className="agent-history-empty">暂无历史项目</div>
              )}
            </div>
          ) : null}

          {replayOpen ? (
            <AgentSessionReplayPanel
              replay={sessionReplay}
              selectedSessionId={replaySelectedSessionId}
              sessionOptions={replaySessionOptions}
              loading={isReplayLoading}
              error={replayError}
              onSelectSession={(sessionId) => {
                void openSessionReplay(sessionId);
              }}
              onRefresh={() => {
                void openSessionReplay(replaySelectedSessionId);
              }}
              onDownload={() => {
                if (sessionReplay) {
                  downloadSessionReplay(sessionReplay, replaySelectedSessionId);
                } else {
                  void exportSessionReplay(replaySelectedSessionId);
                }
              }}
              onClose={() => setReplayOpen(false)}
            />
          ) : null}

          <div className="chat-stream">
            {runtime.messages.map((message, index) => (
              <AgentChatMessage
                message={message}
                sessionId={session.id}
                submittedFormIds={submittedFormIds}
                key={message.id}
                onQuickAction={runQuickAction}
                onSubmitText={(text) => submitTextValue(text, { retry: message.metadata?.fallbackUsed })}
                onSubmitQuestion={submitQuestion}
                onUploadQuestionFiles={uploadQuestionFiles}
                retryText={message.metadata?.fallbackUsed ? getRetryTextForMessage(runtime.messages, index) : undefined}
              />
            ))}
            <AgentGenerationTaskPanel
              bundle={projectBundle}
              tasks={visibleGenerationTasks}
              onRefresh={(task) => {
                void pollGenerationTask(task.id, task.providerTaskId);
              }}
              onPreview={previewGenerationTask}
              onRepair={(task) => {
                void proposeGenerationRepair(task);
              }}
            />
            {visiblePendingTurn ? (
              <AgentPendingTurnView
                pendingTurn={visiblePendingTurn}
                onRetry={(text) => submitTextValue(text, { retry: true })}
              />
            ) : null}
            <div ref={chatEndRef} />
          </div>

          <div
            className={`agent-composer ${isDropActive ? "is-drop-active" : ""}`}
            onDragEnter={handleMediaDrag}
            onDragOver={handleMediaDrag}
            onDragLeave={handleMediaDragLeave}
            onDrop={handleMediaDrop}
          >
            {isDropActive ? (
              <div className="input-drop-overlay" aria-hidden="true">
                <Upload size={18} />
                <span>松开上传图片或视频</span>
              </div>
            ) : null}
            <input
              ref={uploadInputRef}
              className="hidden-file-input"
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleUploadInputChange}
            />
            <div className="agent-composer-box">
              <textarea
                ref={composerTextareaRef}
                value={composerValue}
                rows={3}
                className="agent-composer-input"
                aria-label="Agent input"
                placeholder={
                  isRuntimeHydrating
                    ? "正在恢复会话..."
                    : isAgentBusy
                    ? "正在等待 Agent 回复..."
                    : "继续补充产品、竞品素材、参考程度、字幕/配音等约束..."
                }
                disabled={isAgentBusy}
                onChange={(event) => setComposerValue(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="agent-composer-actions">
                <button
                  className="square-btn agent-composer-upload"
                  aria-label="上传图片或视频"
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  className={`send-btn agent-composer-send ${isAgentBusy ? "is-loading" : ""}`}
                  type="button"
                  aria-label="Send"
                  onClick={submitComposer}
                  disabled={isAgentBusy}
                >
                  <ArrowRight size={15} />
                  <span>发送</span>
                </button>
              </div>
            </div>
          </div>

          <div
            className="agent-panel-resizer"
            role="separator"
            aria-label="调整 Agent 对话框宽度"
            aria-orientation="vertical"
            aria-valuemin={agentPanelMinWidth}
            aria-valuemax={agentPanelMaxWidth}
            aria-valuenow={agentPanelWidth}
            aria-disabled={isAgentPanelCollapsed}
            tabIndex={isAgentPanelCollapsed ? -1 : 0}
            onPointerDown={handleAgentPanelResizeStart}
            onKeyDown={handleAgentPanelResizeKeyDown}
          >
            <GripVertical size={16} />
          </div>
        </aside>

        <WorkbenchCanvas
          key={session.id}
          session={session}
          onNodeOpen={onNodeOpen}
          onCanvasSnapshotChange={setCanvasSnapshot}
          onCanvasStateChange={handleCanvasStateChange}
        />
      </div>
      <CanvasMediaPreviewOverlay item={mediaPreview} onClose={() => setMediaPreview(null)} />
    </section>
  );
}
