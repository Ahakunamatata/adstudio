import type { CanvasRuntimeAction } from "@/features/canvas/types";
import { applyCanvasAction } from "@/features/canvas/actions";
import { validateCanvasActionBatch } from "@/features/agent-runtime/canvas-action-validator";
import type { CanvasSnapshot } from "@/features/agent-runtime/agent-snapshot";
import { createAgentArtifactSnapshot } from "@/features/agent-runtime/artifacts";
import {
  createEmptyAgentProjectBundle,
  deriveCanvasSnapshot,
  type AgentEventLogType,
  type AgentProjectBundle,
  type AgentProjectPatch,
  type AgentProjectStore,
  type ApprovalRequestRecord,
  type CanvasGraphRecord,
  type CreateAgentEventInput
} from "@/lib/agent-project-store";
import type { AgentCanvasState, AgentSession } from "@/lib/domain/schemas";
import type { AgentRuntimeState } from "@/features/workbench/agent-types";

const m4AllowedCanvasActionTypes = new Set<CanvasRuntimeAction["type"]>([
  "createNode",
  "updateNodeContent",
  "updateNodeSettings",
  "connectNodes",
  "markNodeStale",
  "lockNode"
]);

type StableJsonValue = null | boolean | number | string | StableJsonValue[] | { [key: string]: StableJsonValue };

export type CanvasApprovalBuildResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  approval?: ApprovalRequestRecord;
  actionHash: string;
  idempotencyKey: string;
  affectedNodeIds: string[];
};

export type ApprovalExecutionResult = {
  ok: boolean;
  approval?: ApprovalRequestRecord;
  bundle?: AgentProjectBundle;
  canvasGraph?: CanvasGraphRecord;
  actions: CanvasRuntimeAction[];
  eventIds: string[];
  idempotent?: boolean;
  blocker?: string;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): StableJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) return value.map(stableJson);

  if (!isRecord(value)) return null;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key])])
  );
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableJson(value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createLocalId(prefix: string, value: string) {
  return `${prefix}-${hashString(value)}`;
}

export function createCanvasActionHash(actions: CanvasRuntimeAction[]) {
  return `canvas:${hashString(stableStringify(actions))}`;
}

export function getAffectedNodeIds(actions: CanvasRuntimeAction[]) {
  const nodeIds = new Set<string>();

  actions.forEach((action) => {
    if (action.type === "createNode") {
      if (action.input.id) nodeIds.add(action.input.id);
      if (action.input.sourceNodeId) nodeIds.add(action.input.sourceNodeId);
      return;
    }

    if (action.type === "connectNodes") {
      nodeIds.add(action.source);
      nodeIds.add(action.target);
      return;
    }

    if ("nodeId" in action) nodeIds.add(action.nodeId);
  });

  return Array.from(nodeIds).filter(Boolean);
}

function validateM4ActionBoundary(actions: CanvasRuntimeAction[]) {
  const errors: string[] = [];

  actions.forEach((action, index) => {
    const prefix = `Action ${index + 1} (${action.type})`;

    if (!m4AllowedCanvasActionTypes.has(action.type)) {
      errors.push(`${prefix}: M4 只允许非扣费画布结构动作。`);
    }

    if (action.type === "createNode") {
      if (!action.input.id?.trim()) {
        errors.push(`${prefix}: createNode 必须携带稳定 id，用于刷新恢复和幂等执行。`);
      }
      if (action.input.locked) {
        errors.push(`${prefix}: 创建节点时不能顺手锁定；锁定必须作为单独 lockNode 动作明确确认。`);
      }
    }
  });

  return errors;
}

export function validateM4CanvasApprovalActions(actions: CanvasRuntimeAction[], canvas?: CanvasSnapshot) {
  const boundaryErrors = validateM4ActionBoundary(actions);
  const canvasValidation = validateCanvasActionBatch(actions, canvas);

  return {
    valid: boundaryErrors.length === 0 && canvasValidation.valid,
    errors: [...boundaryErrors, ...canvasValidation.errors],
    warnings: canvasValidation.warnings
  };
}

export function createCanvasActionApprovalRequest(input: {
  projectId: string;
  sessionId?: string;
  title: string;
  summary: string;
  actions: CanvasRuntimeAction[];
  canvas?: CanvasSnapshot;
  approvalId?: string;
  now?: string;
  requestedBy?: string;
}): CanvasApprovalBuildResult {
  const now = input.now ?? new Date().toISOString();
  const actions = input.actions;
  const actionHash = createCanvasActionHash(actions);
  const idempotencyKey = `m4:${input.projectId}:${actionHash}`;
  const affectedNodeIds = getAffectedNodeIds(actions);
  const validation = validateM4CanvasApprovalActions(actions, input.canvas);

  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      actionHash,
      idempotencyKey,
      affectedNodeIds
    };
  }

  const approval: ApprovalRequestRecord = {
    schemaVersion: 1,
    id: input.approvalId?.trim() || createLocalId("approval-m4", `${input.projectId}:${input.sessionId ?? ""}:${actionHash}`),
    projectId: input.projectId,
    sessionId: input.sessionId,
    kind: "action_batch",
    title: input.title,
    summary: input.summary,
    status: "pending",
    requestedActions: actions,
    actionHash,
    idempotencyKey,
    affectedNodeIds,
    affectedArtifactIds: [],
    estimatedCredits: 0,
    requestedBy: input.requestedBy ?? "agent",
    requestedAt: now
  };

  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    approval,
    actionHash,
    idempotencyKey,
    affectedNodeIds
  };
}

export function createCanvasGraphFromSession(projectId: string, canvasState?: AgentCanvasState, now = new Date().toISOString()): CanvasGraphRecord {
  return {
    schemaVersion: 1,
    projectId,
    nodes: canvasState?.nodes ?? [],
    edges: canvasState?.edges ?? [],
    graphVersion: `graph-${hashString(`${projectId}:${now}:${canvasState?.nodes.length ?? 0}:${canvasState?.edges.length ?? 0}`)}`,
    updatedAt: now
  };
}

export function createApprovalRequestProjectPatch(input: {
  session: AgentSession;
  runtime?: AgentRuntimeState;
  approval: ApprovalRequestRecord;
  canvasState?: AgentCanvasState;
}): AgentProjectPatch {
  const now = input.approval.requestedAt;
  const session = input.session;

  return {
    project: {
      schemaVersion: 1,
      id: session.id,
      title: session.projectTitle || "未命名项目",
      productName: session.product || undefined,
      mode: session.mode,
      lifecycle: session.lifecycle === "empty" ? "intake" : session.lifecycle,
      activeSessionId: session.id,
      createdAt: now,
      updatedAt: now
    },
    sessions: [
      {
        schemaVersion: 1,
        id: session.id,
        projectId: session.id,
        session,
        runtimeSummary: input.runtime
          ? {
              stage: input.runtime.stage,
              messageCount: input.runtime.messages.length,
              pendingApprovalId: input.approval.id,
              artifactSummaryCount: createAgentArtifactSnapshot(input.runtime.artifacts).summaries.length
            }
          : undefined,
        createdAt: now,
        updatedAt: now
      }
    ],
    approvalRequests: [input.approval],
    canvasGraph: createCanvasGraphFromSession(session.id, input.canvasState, now),
    events: [
      {
        projectId: session.id,
        sessionId: session.id,
        actorType: "agent",
        eventType: "approval.requested",
        objectType: "approval_request",
        objectId: input.approval.id,
        payload: {
          status: input.approval.status,
          actionHash: input.approval.actionHash,
          idempotencyKey: input.approval.idempotencyKey,
          affectedNodeIds: input.approval.affectedNodeIds,
          estimatedCredits: 0
        },
        createdAt: now
      }
    ],
    updatedAt: now
  };
}

function getApprovalBlocker(
  approval: ApprovalRequestRecord,
  input: { actionHash: string; idempotencyKey: string; now: string }
) {
  if (approval.actionHash !== input.actionHash) return "确认内容已过期：actionHash 与当前请求不一致。";
  if (approval.idempotencyKey !== input.idempotencyKey) return "确认内容已过期：idempotencyKey 与当前请求不一致。";
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.parse(input.now)) return "确认已过期，请让 Agent 重新给方案。";
  if (approval.status === "rejected") return "该方案已被拒绝，不能执行。";
  if (approval.status === "executing") return "该方案正在执行中，请等待当前执行完成。";
  if (approval.status === "execution_failed") return "该方案之前执行失败，请重新生成方案。";
  if (approval.status !== "pending" && approval.status !== "approved" && approval.status !== "executed") {
    return `Approval 状态 ${approval.status} 不能执行。`;
  }
  return "";
}

function applyCanvasActionsToGraph(graph: CanvasGraphRecord, actions: CanvasRuntimeAction[], now = new Date().toISOString()): CanvasGraphRecord {
  let nodes = graph.nodes;
  let edges = graph.edges;

  actions.forEach((action) => {
    const result = applyCanvasAction(nodes, edges, action);
    nodes = result.nodes;
    edges = result.edges;
  });

  return {
    ...graph,
    nodes,
    edges,
    graphVersion: `graph-${hashString(`${graph.projectId}:${now}:${stableStringify(actions)}`)}`,
    updatedAt: now
  };
}

function getCanvasEventType(action: CanvasRuntimeAction): AgentEventLogType {
  if (action.type === "createNode") return "canvas.node.created";
  if (action.type === "lockNode") return "canvas.node.locked";
  if (action.type === "markNodeStale") return "canvas.downstream_stale_marked";
  return "canvas.node.updated";
}

function getActionObjectId(action: CanvasRuntimeAction) {
  if (action.type === "createNode") return action.input.id;
  if (action.type === "connectNodes") return `${action.source}->${action.target}`;
  if ("nodeId" in action) return action.nodeId;
  return undefined;
}

function createCanvasExecutionEvents(approval: ApprovalRequestRecord, actions: CanvasRuntimeAction[], now: string): CreateAgentEventInput[] {
  return actions.map((action, index) => ({
    projectId: approval.projectId,
    sessionId: approval.sessionId,
    actorType: "system",
    eventType: getCanvasEventType(action),
    objectType: action.type === "connectNodes" ? "canvas_edge" : "canvas_node",
    objectId: getActionObjectId(action),
    correlationId: approval.id,
    requestId: approval.idempotencyKey,
    payload: {
      approvalRequestId: approval.id,
      actionIndex: index,
      actionType: action.type,
      actionHash: approval.actionHash,
      idempotencyKey: approval.idempotencyKey,
      estimatedCredits: 0
    },
    createdAt: now
  }));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function executeApprovalActionBatch(
  store: AgentProjectStore,
  input: {
    projectId: string;
    approvalRequestId: string;
    actionHash: string;
    idempotencyKey: string;
    actorId?: string;
    now?: string;
  }
): Promise<ApprovalExecutionResult> {
  const now = input.now ?? new Date().toISOString();
  const bundle = await store.loadProject(input.projectId);
  const baseBundle = bundle ?? createEmptyAgentProjectBundle({ projectId: input.projectId, now });
  const approval = baseBundle.approvalRequests.find((record) => record.id === input.approvalRequestId);

  if (!approval) {
    return {
      ok: false,
      actions: [],
      eventIds: [],
      blocker: `Approval request not found: ${input.approvalRequestId}.`
    };
  }

  const approvalBlocker = getApprovalBlocker(approval, {
    actionHash: input.actionHash,
    idempotencyKey: input.idempotencyKey,
    now
  });
  if (approvalBlocker) {
    return {
      ok: false,
      approval,
      bundle: baseBundle,
      canvasGraph: baseBundle.canvasGraph,
      actions: approval.requestedActions,
      eventIds: approval.executionResult?.eventIds ?? [],
      blocker: approvalBlocker
    };
  }

  if (approval.status === "executed") {
    return {
      ok: true,
      approval,
      bundle: baseBundle,
      canvasGraph: baseBundle.canvasGraph,
      actions: approval.requestedActions,
      eventIds: approval.executionResult?.eventIds ?? [],
      idempotent: true
    };
  }

  const validation = validateM4CanvasApprovalActions(
    approval.requestedActions,
    deriveCanvasSnapshot(baseBundle.canvasGraph)
  );
  if (!validation.valid) {
    return {
      ok: false,
      approval,
      bundle: baseBundle,
      canvasGraph: baseBundle.canvasGraph,
      actions: approval.requestedActions,
      eventIds: [],
      blocker: validation.errors.join(" ")
    };
  }

  try {
    let currentApproval = approval;
    if (currentApproval.status === "pending") {
      currentApproval = await store.updateApprovalStatus({
        projectId: input.projectId,
        approvalRequestId: approval.id,
        status: "approved",
        respondedBy: input.actorId ?? "user",
        respondedAt: now,
        actualCredits: 0
      });
    }

    if (currentApproval.status === "approved") {
      currentApproval = await store.updateApprovalStatus({
        projectId: input.projectId,
        approvalRequestId: approval.id,
        status: "executing"
      });
    }

    const executingBundle = await store.loadProject(input.projectId);
    const executionBase = executingBundle ?? baseBundle;
    const nextGraph = applyCanvasActionsToGraph(executionBase.canvasGraph, currentApproval.requestedActions, now);
    const executionEvents = createCanvasExecutionEvents(currentApproval, currentApproval.requestedActions, now);
    const patchedBundle = await store.saveProjectPatch(input.projectId, {
      canvasGraph: nextGraph,
      events: executionEvents,
      updatedAt: now
    });
    const eventIds = patchedBundle.events.slice(-executionEvents.length).map((event) => event.id);
    const executedApproval = await store.updateApprovalStatus({
      projectId: input.projectId,
      approvalRequestId: approval.id,
      status: "executed",
      executedAt: now,
      actualCredits: 0,
      executionResult: {
        ok: true,
        eventIds
      }
    });
    const finalBundle = await store.loadProject(input.projectId);

    return {
      ok: true,
      approval: executedApproval,
      bundle: finalBundle ?? patchedBundle,
      canvasGraph: finalBundle?.canvasGraph ?? nextGraph,
      actions: currentApproval.requestedActions,
      eventIds
    };
  } catch (error) {
    const latestBundle = await store.loadProject(input.projectId);
    const latestApproval = latestBundle?.approvalRequests.find((record) => record.id === approval.id);
    if (latestApproval?.status === "executing") {
      await store.updateApprovalStatus({
        projectId: input.projectId,
        approvalRequestId: approval.id,
        status: "execution_failed",
        executedAt: now,
        actualCredits: 0,
        executionResult: {
          ok: false,
          eventIds: [],
          error: getErrorMessage(error)
        }
      });
    }

    return {
      ok: false,
      approval: latestApproval ?? approval,
      bundle: latestBundle ?? baseBundle,
      canvasGraph: latestBundle?.canvasGraph ?? baseBundle.canvasGraph,
      actions: approval.requestedActions,
      eventIds: [],
      error: getErrorMessage(error)
    };
  }
}

export async function rejectApprovalRequest(
  store: AgentProjectStore,
  input: {
    projectId: string;
    approvalRequestId: string;
    actorId?: string;
    now?: string;
  }
) {
  const bundle = await store.loadProject(input.projectId);
  const approval = bundle?.approvalRequests.find((record) => record.id === input.approvalRequestId);
  if (!approval) throw new Error(`Approval request not found: ${input.approvalRequestId}.`);
  if (approval.status === "rejected") return approval;
  if (approval.status !== "pending") {
    throw new Error(`Approval status ${approval.status} cannot be rejected.`);
  }

  return store.updateApprovalStatus({
    projectId: input.projectId,
    approvalRequestId: input.approvalRequestId,
    status: "rejected",
    respondedBy: input.actorId ?? "user",
    respondedAt: input.now ?? new Date().toISOString(),
    actualCredits: 0
  });
}
