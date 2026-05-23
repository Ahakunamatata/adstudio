import type { AgentProjectBundle } from "@/lib/agent-project-store";
import type { AgentWorkspaceEvent, StoredAgentWorkspace } from "@/lib/agent-workspace-model";

const secretKeyPattern = /(secret|token|api.?key|authorization|apikey|password|credential|service.?role)/i;
const secretAssignmentPattern = /\b(secret|token|api.?key|authorization|apikey|password|credential|service.?role)\b\s*[:=]\s*([^\s,;"'}]+)/gi;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

type ReplayVisibility = "user_visible" | "internal_diagnostic";
type ReplayTimelineItem = {
  id: string;
  type: "user_input" | "agent_reply" | "card_event" | "debug_log" | "workspace_event" | "project_event";
  visibility: ReplayVisibility;
  createdAt?: unknown;
  messageId?: unknown;
  role?: unknown;
  title?: string;
  body?: unknown;
  eventKind?: unknown;
  cardKind?: unknown;
  status?: unknown;
  summary?: unknown;
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function redactUrlSecrets(value: string) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    let changed = false;
    url.searchParams.forEach((_, key) => {
      if (!secretKeyPattern.test(key)) return;
      url.searchParams.set(key, "[REDACTED]");
      changed = true;
    });
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function redactReplayString(value: string) {
  return redactUrlSecrets(value)
    .replace(bearerTokenPattern, "Bearer [REDACTED]")
    .replace(secretAssignmentPattern, "$1=[REDACTED]");
}

function redactReplaySecretsWithReport(value: unknown): { value: unknown; redactionCount: number } {
  if (typeof value === "string") {
    const redacted = redactReplayString(value);
    return {
      value: redacted,
      redactionCount: redacted === value ? 0 : 1
    };
  }

  if (Array.isArray(value)) {
    let redactionCount = 0;
    const items = value.map((item) => {
      const result = redactReplaySecretsWithReport(item);
      redactionCount += result.redactionCount;
      return result.value;
    });
    return { value: items, redactionCount };
  }

  if (!isRecord(value)) return { value, redactionCount: 0 };

  let redactionCount = 0;
  const entries = Object.entries(value).map(([key, item]) => {
    if (secretKeyPattern.test(key)) {
      redactionCount += 1;
      return [key, "[REDACTED]"];
    }

    const result = redactReplaySecretsWithReport(item);
    redactionCount += result.redactionCount;
    return [key, result.value];
  });

  return {
    value: Object.fromEntries(entries),
    redactionCount
  };
}

export function redactReplaySecrets(value: unknown): unknown {
  return redactReplaySecretsWithReport(value).value;
}

function getRuntimeMessages(runtime: unknown) {
  if (!isRecord(runtime) || !Array.isArray(runtime.messages)) return [];
  return runtime.messages.filter(isRecord);
}

function getMessageEvents(message: Record<string, unknown>) {
  return Array.isArray(message.events) ? message.events.filter(isRecord) : [];
}

function filterMessageEvents(messages: Record<string, unknown>[], kind: string) {
  return messages.flatMap((message) =>
    getMessageEvents(message).filter((event) => event.kind === kind).map((event) => ({
      messageId: message.id,
      role: message.role,
      createdAt: message.createdAt,
      event
    }))
  );
}

function getMessageMetadataDebugLog(message: Record<string, unknown>) {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  return metadata.debugLog;
}

function getMessageTitle(message: Record<string, unknown>) {
  const body = typeof message.body === "string" ? message.body.trim() : "";
  if (!body) return undefined;
  return body.length > 42 ? `${body.slice(0, 42)}...` : body;
}

function getEventTitle(event: Record<string, unknown>) {
  if (event.kind === "confirmation" && isRecord(event.confirmation)) {
    return typeof event.confirmation.title === "string" ? event.confirmation.title : "确认卡";
  }
  if (event.kind === "question" && isRecord(event.form)) {
    return typeof event.form.title === "string" ? event.form.title : "信息收集卡";
  }
  if (event.kind === "status") return "状态";
  if (event.kind === "warning") return "提醒";
  if (event.kind === "canvas_action") return "画布动作";
  return typeof event.kind === "string" ? event.kind : "事件";
}

function getEventStatus(event: Record<string, unknown>) {
  if (event.kind === "confirmation" && isRecord(event.confirmation)) return event.confirmation.status;
  if (event.kind === "status") return event.label;
  if (event.kind === "canvas_action") return event.status;
  return undefined;
}

function getCardKind(event: Record<string, unknown>) {
  if (event.kind === "confirmation") return "confirmation";
  if (event.kind === "question") return "question";
  if (event.kind === "intake_submission") return "intake_submission";
  if (event.kind === "canvas_action") return "canvas_action";
  if (event.kind === "warning") return "warning";
  if (event.kind === "retry") return "retry";
  return event.kind;
}

function createReplayTimeline(
  messages: Record<string, unknown>[],
  workspaceEvents: AgentWorkspaceEvent[],
  projectEvents: AgentProjectBundle["events"]
) {
  const timeline: ReplayTimelineItem[] = [];

  messages.forEach((message, messageIndex) => {
    const base = {
      messageId: message.id,
      createdAt: message.createdAt,
      role: message.role
    };

    if (message.role === "user") {
      timeline.push({
        ...base,
        id: `message-${String(message.id ?? messageIndex)}-user`,
        type: "user_input",
        visibility: "user_visible",
        title: getMessageTitle(message),
        body: message.body
      });
    }

    if (message.role === "assistant" || message.role === "system") {
      timeline.push({
        ...base,
        id: `message-${String(message.id ?? messageIndex)}-assistant`,
        type: "agent_reply",
        visibility: "user_visible",
        title: getMessageTitle(message),
        body: message.body
      });
    }

    getMessageEvents(message).forEach((event, eventIndex) => {
      timeline.push({
        ...base,
        id: `message-${String(message.id ?? messageIndex)}-event-${eventIndex}`,
        type: "card_event",
        visibility: "user_visible",
        eventKind: event.kind,
        cardKind: getCardKind(event),
        status: getEventStatus(event),
        title: getEventTitle(event),
        details: event
      });
    });

    const debugLog = getMessageMetadataDebugLog(message);
    if (debugLog) {
      timeline.push({
        ...base,
        id: `message-${String(message.id ?? messageIndex)}-debug`,
        type: "debug_log",
        visibility: "internal_diagnostic",
        title: "内部诊断日志",
        details: debugLog
      });
    }
  });

  workspaceEvents.forEach((event) => {
    timeline.push({
      id: `workspace-event-${event.id}`,
      type: "workspace_event",
      visibility: "internal_diagnostic",
      createdAt: event.createdAt,
      title: event.kind,
      status: event.source,
      details: event
    });
  });

  projectEvents.forEach((event) => {
    timeline.push({
      id: `project-event-${event.id}`,
      type: "project_event",
      visibility: event.eventType.startsWith("canvas.") ? "user_visible" : "internal_diagnostic",
      createdAt: event.createdAt,
      title: event.eventType,
      eventKind: event.eventType,
      status: event.actorType,
      details: event
    });
  });

  return timeline.sort((left, right) => {
    const leftTime = typeof left.createdAt === "string" ? Date.parse(left.createdAt) : 0;
    const rightTime = typeof right.createdAt === "string" ? Date.parse(right.createdAt) : 0;
    return leftTime - rightTime;
  });
}

function summarizeApprovals(bundle: AgentProjectBundle | undefined, sessionId: string) {
  return (bundle?.approvalRequests ?? [])
    .filter((approval) => approval.sessionId === sessionId || approval.projectId === sessionId)
    .map((approval) => ({
      id: approval.id,
      kind: approval.kind,
      title: approval.title,
      status: approval.status,
      requestedAt: approval.requestedAt,
      respondedAt: approval.respondedAt,
      executedAt: approval.executedAt,
      estimatedCredits: approval.estimatedCredits,
      actualCredits: approval.actualCredits,
      affectedNodeIds: approval.affectedNodeIds,
      affectedArtifactIds: approval.affectedArtifactIds,
      actionHash: approval.actionHash,
      idempotencyKey: approval.idempotencyKey,
      executionResult: approval.executionResult
    }));
}

function summarizeGenerationTasks(bundle: AgentProjectBundle | undefined, sessionId: string) {
  return (bundle?.generationTasks ?? [])
    .filter((task) => task.sessionId === sessionId || task.projectId === sessionId)
    .map((task) => ({
      id: task.id,
      approvalRequestId: task.approvalRequestId,
      nodeId: task.nodeId,
      artifactId: task.artifactId,
      kind: task.kind,
      surface: task.surface,
      provider: task.provider,
      providerTaskId: task.providerTaskId,
      modelName: task.modelName,
      modeKey: task.modeKey,
      status: task.status,
      progress: task.progress,
      credits: task.credits,
      costUsd: task.costUsd,
      outputAssetId: task.outputAssetId,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }));
}

function summarizeMediaAssets(bundle: AgentProjectBundle | undefined, sessionId: string) {
  return (bundle?.mediaAssets ?? [])
    .filter((asset) => asset.sessionId === sessionId || asset.projectId === sessionId)
    .map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      role: asset.role,
      source: asset.source,
      storageProvider: asset.storage?.provider,
      storageKey: asset.storage?.key,
      hasPublicUrl: Boolean(asset.storage?.publicUrl),
      signedUrlExpiresAt: asset.storage?.signedUrlExpiresAt,
      recoverable: asset.recoverable,
      analysisStatus: asset.analysisStatus,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt
    }));
}

function summarizeCanvasChanges(bundle: AgentProjectBundle | undefined, sessionId: string) {
  return (bundle?.events ?? [])
    .filter((event) => (event.sessionId === sessionId || event.projectId === sessionId) && event.eventType.startsWith("canvas."))
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      actorType: event.actorType,
      sequence: event.sequence,
      payload: event.payload,
      createdAt: event.createdAt
    }));
}

function createPmReview(
  workspace: StoredAgentWorkspace,
  sessionId: string,
  sessionRecord: StoredAgentWorkspace["sessions"][number] | undefined,
  bundle: AgentProjectBundle | undefined,
  messages: Record<string, unknown>[],
  workspaceEventLog: AgentWorkspaceEvent[]
) {
  const projectEvents = (bundle?.events ?? []).filter((event) => event.sessionId === sessionId || event.projectId === sessionId);
  const timeline = createReplayTimeline(messages, workspaceEventLog, projectEvents);
  const userVisibleItems = timeline.filter((item) => item.visibility === "user_visible").length;
  const internalDiagnosticItems = timeline.filter((item) => item.visibility === "internal_diagnostic").length;

  return {
    schemaVersion: 1,
    audience: "pm_debug",
    viewNote: "PM/调试验收视图；不是普通用户聊天 UI。",
    sessionId,
    title: sessionRecord?.title ?? bundle?.project.title ?? sessionId,
    product: sessionRecord?.product ?? bundle?.project.productName ?? workspace.selectedProduct,
    updatedAt: sessionRecord?.updatedAt ?? bundle?.updatedAt,
    timeline,
    approvals: summarizeApprovals(bundle, sessionId),
    generationTasks: summarizeGenerationTasks(bundle, sessionId),
    mediaAssets: summarizeMediaAssets(bundle, sessionId),
    canvas: bundle
      ? {
          nodeCount: bundle.canvasGraph.nodes.length,
          edgeCount: bundle.canvasGraph.edges.length,
          graphVersion: bundle.canvasGraph.graphVersion,
          updatedAt: bundle.canvasGraph.updatedAt
        }
      : null,
    canvasChanges: summarizeCanvasChanges(bundle, sessionId),
    diagnostics: {
      userVisibleItems,
      internalDiagnosticItems,
      debugLogCount: timeline.filter((item) => item.type === "debug_log").length,
      workspaceEventCount: workspaceEventLog.length,
      projectEventCount: projectEvents.length,
      redactionApplied: false
    }
  };
}

function getProjectBundle(workspace: StoredAgentWorkspace, sessionId: string): AgentProjectBundle | undefined {
  return workspace.projectBundles?.find((bundle) =>
    bundle.project.id === sessionId ||
    bundle.project.activeSessionId === sessionId ||
    bundle.sessions.some((record) => record.id === sessionId) ||
    bundle.approvalRequests.some((approval) => approval.sessionId === sessionId) ||
    bundle.generationTasks.some((task) => task.sessionId === sessionId)
  );
}

export function createAgentSessionReplay(workspace: StoredAgentWorkspace, sessionId: string) {
  const sessionRecord = workspace.sessions.find((record) => record.id === sessionId);
  const bundle = getProjectBundle(workspace, sessionId);
  const messages = getRuntimeMessages(sessionRecord?.runtime);
  const workspaceEventLog = workspace.eventLog.filter((event: AgentWorkspaceEvent) => event.sessionId === sessionId || event.projectId === sessionId);
  const replay = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sessionId,
    pmReview: createPmReview(workspace, sessionId, sessionRecord, bundle, messages, workspaceEventLog),
    workspace: {
      route: workspace.route,
      selectedProduct: workspace.selectedProduct,
      setupMode: workspace.setupMode,
      activeSessionId: workspace.activeSessionId
    },
    session: sessionRecord
      ? {
          id: sessionRecord.id,
          title: sessionRecord.title,
          product: sessionRecord.product,
          mode: sessionRecord.mode,
          updatedAt: sessionRecord.updatedAt,
          session: sessionRecord.session
        }
      : null,
    runtime: isRecord(sessionRecord?.runtime)
      ? {
          stage: sessionRecord.runtime.stage,
          brief: sessionRecord.runtime.brief,
          pendingConfirmation: sessionRecord.runtime.pendingConfirmation,
          actionHistory: sessionRecord.runtime.actionHistory,
          intakeSubmissions: sessionRecord.runtime.intakeSubmissions,
          fallback: sessionRecord.runtime.fallback,
          messages
        }
      : null,
    derivedEvents: {
      userMessages: messages.filter((message) => message.role === "user"),
      assistantMessages: messages.filter((message) => message.role === "assistant" || message.role === "system"),
      statuses: filterMessageEvents(messages, "status"),
      questionForms: filterMessageEvents(messages, "question"),
      intakeSubmissions: filterMessageEvents(messages, "intake_submission"),
      confirmations: filterMessageEvents(messages, "confirmation"),
      warnings: filterMessageEvents(messages, "warning"),
      debugLogs: messages.flatMap((message) => {
        const debugLog = getMessageMetadataDebugLog(message);
        return debugLog
          ? [{
              messageId: message.id,
              role: message.role,
              createdAt: message.createdAt,
              debugLog
            }]
          : [];
      })
    },
    projectBundle: bundle
      ? {
          project: bundle.project,
          sessions: bundle.sessions.filter((record) => record.id === sessionId),
          approvalRequests: bundle.approvalRequests.filter((approval) => approval.sessionId === sessionId || approval.projectId === sessionId),
          generationTasks: bundle.generationTasks.filter((task) => task.sessionId === sessionId || task.projectId === sessionId),
          mediaAssets: bundle.mediaAssets.filter((asset) => asset.sessionId === sessionId || asset.projectId === sessionId),
          canvasGraph: bundle.canvasGraph,
          events: bundle.events.filter((event) => event.sessionId === sessionId || event.projectId === sessionId),
          updatedAt: bundle.updatedAt
        }
      : null,
    workspaceEventLog
  };

  const redacted = redactReplaySecretsWithReport(replay);
  if (isRecord(redacted.value) && isRecord(redacted.value.pmReview) && isRecord(redacted.value.pmReview.diagnostics)) {
    redacted.value.pmReview.diagnostics.redactionApplied = redacted.redactionCount > 0;
  }
  return redacted.value;
}
