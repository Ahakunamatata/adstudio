import { createMemoryArtifactStore, type WorkspaceArtifactStore } from "./artifact-store";
import { sampleAgentArtifacts } from "./artifacts.typecheck";
import {
  agentToolResultSchema,
  executeAskUserTool,
  executeInspectCanvasTool,
  executeProposeActionBatchTool,
  executeSaveArtifactTool,
  guardedAgentToolSchemas,
  type AgentToolResult,
  type GuardedAgentToolName
} from "./guarded-tools";
import type { CanvasSnapshot } from "./agent-snapshot";

const sampleCanvasSnapshot = {
  nodes: [
    {
      id: "node-script",
      kind: "script",
      businessType: "ad_script",
      title: "脚本",
      status: "completed",
      locked: false,
      parentNodeIds: [],
      staleReason: undefined
    },
    {
      id: "node-storyboard",
      kind: "image",
      businessType: "storyboard_frame",
      title: "C1 分镜",
      status: "stale",
      locked: true,
      parentNodeIds: ["node-script"],
      staleReason: "脚本已更新"
    }
  ],
  edges: [
    {
      id: "edge-node-script-node-storyboard",
      source: "node-script",
      target: "node-storyboard",
      label: "upstream"
    }
  ],
  lockedNodeIds: ["node-storyboard"],
  staleNodeIds: ["node-storyboard"]
} satisfies CanvasSnapshot;

const memoryWorkspaceStore: WorkspaceArtifactStore = {
  ...createMemoryArtifactStore(),
  async recordRestoreFailure() {
    return undefined;
  }
};

export const guardedToolNames = guardedAgentToolSchemas.map((tool) => tool.name) satisfies GuardedAgentToolName[];

export const askUserToolResult = executeAskUserTool({
  question: "请选择参考程度",
  reason: "缺少参考边界会阻塞脚本方案。",
  fields: [
    {
      label: "参考程度",
      type: "radio",
      required: true,
      options: [
        {
          label: "严格复刻剧情结构"
        }
      ]
    }
  ]
}) satisfies AgentToolResult;

export const inspectCanvasUnknownNodeResult = executeInspectCanvasTool(
  {
    nodeIds: ["missing-node"]
  },
  {
    canvas: sampleCanvasSnapshot
  }
) satisfies AgentToolResult;

export const proposalToolResult = executeProposeActionBatchTool(
  {
    title: "创建脚本节点方案",
    summary: "只生成待确认 proposal，不直接修改画布。",
    actions: [
      {
        type: "updateNodeContent",
        nodeId: "node-script",
        output: "新版脚本草案"
      }
    ]
  },
  {
    canvas: sampleCanvasSnapshot
  }
) satisfies AgentToolResult;

export async function typecheckSaveArtifactToolRoundTrip() {
  const result = await executeSaveArtifactTool(
    {
      sessionId: "session-guarded-tool",
      artifactKind: "creativePlan",
      artifact: sampleAgentArtifacts.creativePlan
    },
    {
      artifactStore: memoryWorkspaceStore
    }
  );
  const parsed = agentToolResultSchema.parse(result);
  const restored = await memoryWorkspaceStore.load("session-guarded-tool");
  return {
    parsed,
    restoredCreativePlanId: restored.creativePlan?.id
  };
}
