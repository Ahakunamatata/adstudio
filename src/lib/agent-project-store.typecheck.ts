import { sampleAgentArtifacts } from "@/features/agent-runtime/artifacts.typecheck";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import {
  createEmptyAgentProjectBundle,
  createMemoryAgentProjectStore,
  deriveCanvasSnapshot,
  type ApprovalRequestStatus,
  type AgentProjectPatch,
  type AgentProjectStore,
  type CreateAgentEventInput
} from "./agent-project-store";

const sampleProjectId = "project-m35-typecheck";
const sampleSessionId = "session-m35-typecheck";
const sampleActions = [
  {
    type: "updateNodeContent",
    nodeId: "node-script",
    output: "更新后的脚本草案"
  }
] satisfies CanvasRuntimeAction[];

const allowedApprovalStatuses = [
  "pending",
  "approved",
  "rejected",
  "executing",
  "executed",
  "execution_failed"
] satisfies ApprovalRequestStatus[];

const sampleEventInput = {
  projectId: sampleProjectId,
  sessionId: sampleSessionId,
  actorType: "system",
  eventType: "approval.requested",
  objectType: "approval_request",
  objectId: "approval-m35",
  payload: {
    status: allowedApprovalStatuses[0]
  }
} satisfies CreateAgentEventInput;

const samplePatch = {
  artifacts: [
    {
      schemaVersion: 1,
      id: "artifact-creative-plan-v1",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      artifactType: "creativePlan",
      artifactKey: "creativePlan",
      status: sampleAgentArtifacts.creativePlan.status,
      source: sampleAgentArtifacts.creativePlan.source,
      version: 1,
      body: sampleAgentArtifacts.creativePlan,
      summary: {
        kind: "creativePlan",
        id: sampleAgentArtifacts.creativePlan.id,
        source: sampleAgentArtifacts.creativePlan.source,
        status: sampleAgentArtifacts.creativePlan.status,
        title: sampleAgentArtifacts.creativePlan.title,
        summary: sampleAgentArtifacts.creativePlan.objective,
        factRefs: [],
        modelSuggestionRefs: [sampleAgentArtifacts.creativePlan.id],
        needsUserConfirmation: true
      },
      evidenceRefs: [],
      linkedNodeIds: ["node-script"],
      linkedTaskIds: [],
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z"
    }
  ],
  approvalRequests: [
    {
      schemaVersion: 1,
      id: "approval-m35",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      kind: "action_batch",
      title: "更新脚本节点",
      summary: "只记录 durable approval，不执行画布动作。",
      status: "pending",
      requestedActions: sampleActions,
      actionHash: "hash:update-node-script",
      idempotencyKey: "idem:update-node-script",
      affectedNodeIds: ["node-script"],
      affectedArtifactIds: ["artifact-creative-plan-v1"],
      requestedAt: "2026-05-22T00:00:00.000Z"
    },
    {
      schemaVersion: 1,
      id: "approval-m35-rejected",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      kind: "repair_plan",
      title: "拒绝的返工方案",
      summary: "覆盖 rejected 状态，不执行动作。",
      status: "pending",
      requestedActions: [],
      actionHash: "hash:reject-repair",
      idempotencyKey: "idem:reject-repair",
      affectedNodeIds: [],
      affectedArtifactIds: [],
      requestedAt: "2026-05-22T00:00:00.000Z"
    },
    {
      schemaVersion: 1,
      id: "approval-m35-failed",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      kind: "generation",
      title: "失败的执行确认",
      summary: "覆盖 execution_failed 状态，仍不调用 provider。",
      status: "pending",
      requestedActions: sampleActions,
      actionHash: "hash:failed-generation",
      idempotencyKey: "idem:failed-generation",
      affectedNodeIds: ["node-script"],
      affectedArtifactIds: ["artifact-creative-plan-v1"],
      requestedAt: "2026-05-22T00:00:00.000Z"
    }
  ],
  canvasGraph: {
    schemaVersion: 1,
    projectId: sampleProjectId,
    nodes: [
      {
        id: "node-script",
        kind: "script",
        businessType: "ad_script",
        type: "script",
        title: "脚本",
        status: "draft",
        model: "human",
        time: "0s",
        cost: "0",
        input: "",
        output: "脚本草案",
        version: 1,
        locked: false,
        group: "script",
        position: { x: 0, y: 0 },
        parentNodeIds: [],
        versions: [],
        primaryVersionId: "",
        previewClass: "preview-script"
      }
    ],
    edges: [],
    graphVersion: "graph-v1",
    updatedAt: "2026-05-22T00:00:00.000Z"
  },
  generationTasks: [
    {
      schemaVersion: 1,
      id: "task-m35-dry-run",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      nodeId: "node-script",
      artifactId: "artifact-creative-plan-v1",
      approvalRequestId: "approval-m35",
      kind: "video",
      surface: "agent",
      provider: "dry_run",
      modelId: "dry-run-video",
      modelName: "Dry Run Video",
      modeKey: "text-to-video",
      prompt: "dry run only",
      params: {},
      slots: [],
      status: "queued",
      progress: 0,
      credits: 0,
      idempotencyKey: "idem:task-m35",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z"
    }
  ],
  mediaAssets: [
    {
      schemaVersion: 1,
      id: "asset-m35",
      projectId: sampleProjectId,
      sessionId: sampleSessionId,
      kind: "image",
      role: "reference_asset",
      source: "external_url",
      storage: {
        provider: "external",
        publicUrl: "https://example.com/reference.png"
      },
      recoverable: true,
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z"
    }
  ],
  events: [sampleEventInput]
} satisfies AgentProjectPatch;

export async function typecheckAgentProjectStoreRoundTrip(store: AgentProjectStore = createMemoryAgentProjectStore()) {
  const emptyBundle = createEmptyAgentProjectBundle({
    projectId: sampleProjectId,
    title: "M3.5 后端事实源 MVP",
    mode: "clone",
    now: "2026-05-22T00:00:00.000Z"
  });

  await store.saveProjectPatch(sampleProjectId, emptyBundle);
  const patchedBundle = await store.saveProjectPatch(sampleProjectId, samplePatch);
  const approved = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: "approval-m35",
    status: "approved",
    respondedAt: "2026-05-22T00:01:00.000Z"
  });
  const executing = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: approved.id,
    status: "executing"
  });
  const executed = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: executing.id,
    status: "executed",
    executedAt: "2026-05-22T00:02:00.000Z",
    executionResult: {
      ok: true,
      eventIds: [],
      taskIds: ["task-m35-dry-run"]
    }
  });
  const rejected = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: "approval-m35-rejected",
    status: "rejected",
    respondedAt: "2026-05-22T00:03:00.000Z"
  });
  const failedApproved = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: "approval-m35-failed",
    status: "approved",
    respondedAt: "2026-05-22T00:04:00.000Z"
  });
  const failedExecuting = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: failedApproved.id,
    status: "executing"
  });
  const executionFailed = await store.updateApprovalStatus({
    projectId: sampleProjectId,
    approvalRequestId: failedExecuting.id,
    status: "execution_failed",
    executedAt: "2026-05-22T00:05:00.000Z",
    executionResult: {
      ok: false,
      eventIds: [],
      error: "dry-run execution failed"
    }
  });
  const event = await store.appendEvent({
    ...sampleEventInput,
    eventType: "approval.executed",
    objectId: executed.id,
    payload: {
      status: executed.status
    }
  });
  const snapshot = deriveCanvasSnapshot(patchedBundle.canvasGraph);
  const restoredBundle = await store.loadProject(sampleProjectId);

  return {
    restoredProjectId: restoredBundle?.project.id,
    eventSequence: event.sequence,
    snapshotNodeCount: snapshot.nodes.length,
    finalApprovalStatus: executed.status,
    rejectedApprovalStatus: rejected.status,
    failedApprovalStatus: executionFailed.status
  };
}
