import type { CanvasRuntimeAction } from "@/features/canvas/types";
import {
  createApprovalRequestProjectPatch,
  createCanvasActionApprovalRequest,
  executeApprovalActionBatch,
  rejectApprovalRequest
} from "@/features/agent-runtime/approval-flow";
import { createEmptyCanvasSnapshot } from "@/features/agent-runtime/agent-snapshot";
import { createInitialLlmAgentRuntime } from "@/features/workbench/agent-orchestrator";
import { createAgentSession } from "@/features/agent/agent-session";
import { createMemoryAgentProjectStore } from "@/lib/agent-project-store";

const sampleSession = createAgentSession("clone", "location tracker", "", []);
const sampleRuntime = createInitialLlmAgentRuntime(sampleSession);
const safeActions = [
  {
    type: "createNode",
    input: {
      id: "m4-product",
      kind: "text",
      businessType: "product_pack",
      title: "产品资料包"
    }
  },
  {
    type: "createNode",
    input: {
      id: "m4-plan",
      kind: "plan",
      businessType: "clone_strategy",
      title: "创意方案"
    }
  },
  {
    type: "connectNodes",
    source: "m4-product",
    target: "m4-plan"
  }
] satisfies CanvasRuntimeAction[];

export async function typecheckM4ApprovalFlow() {
  const store = createMemoryAgentProjectStore();
  const proposal = createCanvasActionApprovalRequest({
    projectId: sampleSession.id,
    sessionId: sampleSession.id,
    title: "确认搭建画布",
    summary: "只创建非扣费结构。",
    actions: safeActions,
    canvas: createEmptyCanvasSnapshot(),
    now: "2026-05-22T00:00:00.000Z"
  });

  if (!proposal.approval) throw new Error("expected approval");

  await store.saveProjectPatch(sampleSession.id, createApprovalRequestProjectPatch({
    session: sampleSession,
    runtime: sampleRuntime,
    approval: proposal.approval,
    canvasState: { nodes: [], edges: [] }
  }));

  const executed = await executeApprovalActionBatch(store, {
    projectId: sampleSession.id,
    approvalRequestId: proposal.approval.id,
    actionHash: proposal.actionHash,
    idempotencyKey: proposal.idempotencyKey,
    now: "2026-05-22T00:01:00.000Z"
  });
  const idempotent = await executeApprovalActionBatch(store, {
    projectId: sampleSession.id,
    approvalRequestId: proposal.approval.id,
    actionHash: proposal.actionHash,
    idempotencyKey: proposal.idempotencyKey,
    now: "2026-05-22T00:02:00.000Z"
  });

  const unknownNodeProposal = createCanvasActionApprovalRequest({
    projectId: sampleSession.id,
    sessionId: sampleSession.id,
    title: "未知节点",
    summary: "应被 blocker。",
    actions: [{ type: "updateNodeContent", nodeId: "missing-node", output: "bad" }],
    canvas: createEmptyCanvasSnapshot()
  });

  const staleHash = await executeApprovalActionBatch(store, {
    projectId: sampleSession.id,
    approvalRequestId: proposal.approval.id,
    actionHash: "canvas:stale",
    idempotencyKey: proposal.idempotencyKey
  });

  const executingStore = createMemoryAgentProjectStore();
  const executingProposal = createCanvasActionApprovalRequest({
    projectId: "executing-project",
    sessionId: "executing-project",
    title: "执行中方案",
    summary: "重复执行应被阻止。",
    actions: safeActions,
    canvas: createEmptyCanvasSnapshot()
  });
  if (!executingProposal.approval) throw new Error("expected executing approval");
  await executingStore.saveProjectPatch("executing-project", createApprovalRequestProjectPatch({
    session: { ...sampleSession, id: "executing-project" },
    runtime: sampleRuntime,
    approval: executingProposal.approval,
    canvasState: { nodes: [], edges: [] }
  }));
  await executingStore.updateApprovalStatus({
    projectId: "executing-project",
    approvalRequestId: executingProposal.approval.id,
    status: "approved"
  });
  await executingStore.updateApprovalStatus({
    projectId: "executing-project",
    approvalRequestId: executingProposal.approval.id,
    status: "executing"
  });
  const executingBlocked = await executeApprovalActionBatch(executingStore, {
    projectId: "executing-project",
    approvalRequestId: executingProposal.approval.id,
    actionHash: executingProposal.actionHash,
    idempotencyKey: executingProposal.idempotencyKey
  });

  const generationProposal = createCanvasActionApprovalRequest({
    projectId: sampleSession.id,
    sessionId: sampleSession.id,
    title: "禁止生成",
    summary: "应阻止生成动作。",
    actions: [{ type: "runNodeGeneration", nodeId: "m4-plan" }],
    canvas: createEmptyCanvasSnapshot()
  });

  const rejectStore = createMemoryAgentProjectStore();
  const rejectProposal = createCanvasActionApprovalRequest({
    projectId: "reject-project",
    sessionId: "reject-project",
    title: "拒绝方案",
    summary: "拒绝不改画布。",
    actions: safeActions,
    canvas: createEmptyCanvasSnapshot()
  });
  if (!rejectProposal.approval) throw new Error("expected reject approval");
  await rejectStore.saveProjectPatch("reject-project", {
    ...createApprovalRequestProjectPatch({
      session: { ...sampleSession, id: "reject-project" },
      runtime: sampleRuntime,
      approval: rejectProposal.approval,
      canvasState: { nodes: [], edges: [] }
    })
  });
  const rejected = await rejectApprovalRequest(rejectStore, {
    projectId: "reject-project",
    approvalRequestId: rejectProposal.approval.id
  });

  return {
    executed: executed.ok,
    idempotent: idempotent.idempotent,
    nodeCount: idempotent.canvasGraph?.nodes.length,
    unknownBlocked: !unknownNodeProposal.ok,
    staleHashBlocked: Boolean(staleHash.blocker),
    executingBlocked: Boolean(executingBlocked.blocker),
    generationBlocked: !generationProposal.ok,
    rejected: rejected.status
  };
}
