import { z } from "zod";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { AgentEvent } from "./agent-events";
import type { CanvasSnapshot } from "./agent-snapshot";
import { mergeAgentArtifacts, type ArtifactStorePatch, type WorkspaceArtifactStore } from "./artifact-store";
import {
  anchorRegistrySchema,
  clipTableSchema,
  creativePlanSchema,
  createAgentArtifactSnapshot,
  promptPackSchema,
  referenceAnalysisSchema,
  repairPlanSchema,
  scriptDocSchema,
  workflowPlanSchema,
  type AgentArtifacts,
  type ArtifactSummary
} from "./artifacts";
import { validateCanvasActionBatch } from "./canvas-action-validator";
import {
  agentQuestionFieldSchema,
  agentQuestionFormSchema,
  canvasRuntimeActionDraftSchema
} from "./llm/agent-output-schema";
import { createCanvasActionHash, getAffectedNodeIds } from "./approval-flow";

const guardedToolNames = ["askUser", "saveArtifact", "proposeActionBatch", "inspectCanvas"] as const;

export const guardedAgentToolNameSchema = z.enum(guardedToolNames);
export const agentToolResultStatusSchema = z.enum(["ok", "blocker", "needs_approval", "error"]);

export const agentBlockerSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(true),
  fieldRefs: z.array(z.string()).optional(),
  suggestedQuestion: agentQuestionFormSchema.optional()
});

const agentConfirmationEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  bullets: z.array(z.string()),
  confirmLabel: z.string(),
  secondaryLabel: z.string().optional(),
  executable: z.boolean().optional()
});

const agentEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("status"),
    label: z.enum(["thinking", "planning", "waiting_user", "executing", "done", "error"]),
    detail: z.string().optional()
  }),
  z.object({ kind: z.literal("question"), form: agentQuestionFormSchema }),
  z.object({
    kind: z.literal("confirmation"),
    confirmation: agentConfirmationEventSchema
  }),
  z.object({
    kind: z.literal("canvas_action"),
    action: canvasRuntimeActionDraftSchema,
    status: z.enum(["pending", "running", "done", "failed"])
  }),
  z.object({ kind: z.literal("node_result"), nodeId: z.string(), summary: z.string() }),
  z.object({ kind: z.literal("warning"), text: z.string() })
]);

const agentToolResultBaseSchema = z.object({
  toolName: guardedAgentToolNameSchema,
  status: agentToolResultStatusSchema,
  ok: z.boolean(),
  data: z.unknown().optional(),
  blocker: agentBlockerSchema.optional(),
  events: z.array(agentEventSchema),
  suggestedNextActions: z.array(z.string()).optional()
});

export const agentToolResultSchema = agentToolResultBaseSchema.superRefine((result, context) => {
  if (result.status === "ok" && !result.ok) {
    context.addIssue({
      code: "custom",
      path: ["ok"],
      message: "ok must be true when status is ok."
    });
  }

  if (result.status !== "ok" && result.ok) {
    context.addIssue({
      code: "custom",
      path: ["ok"],
      message: "ok must be false unless status is ok."
    });
  }

  if (result.status === "blocker" && !result.blocker) {
    context.addIssue({
      code: "custom",
      path: ["blocker"],
      message: "blocker result must include blocker details."
    });
  }
});

export const askUserToolInputSchema = z.object({
  question: z.string().trim().min(1),
  reason: z.string().trim().optional(),
  fields: z.array(agentQuestionFieldSchema).min(1).optional(),
  submitLabel: z.string().trim().optional(),
  blockerCode: z.string().trim().optional()
});

export const askUserToolDataSchema = z.object({
  question: agentQuestionFormSchema
});

export const saveArtifactToolInputSchema = z.discriminatedUnion("artifactKind", [
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("referenceAnalysis"),
    artifact: referenceAnalysisSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("creativePlan"),
    artifact: creativePlanSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("anchorRegistry"),
    artifact: anchorRegistrySchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("scriptDoc"),
    artifact: scriptDocSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("clipTable"),
    artifact: clipTableSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("promptPack"),
    artifact: promptPackSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("workflowPlan"),
    artifact: workflowPlanSchema,
    overwriteConfirmed: z.boolean().optional()
  }),
  z.object({
    sessionId: z.string().trim().min(1),
    artifactKind: z.literal("repairPlan"),
    artifact: repairPlanSchema,
    overwriteConfirmed: z.boolean().optional()
  })
]);

export const saveArtifactToolDataSchema = z.object({
  artifactKind: z.enum([
    "referenceAnalysis",
    "creativePlan",
    "anchorRegistry",
    "scriptDoc",
    "clipTable",
    "promptPack",
    "workflowPlan",
    "repairPlan"
  ]),
  artifactId: z.string(),
  summaryCount: z.number().int().nonnegative(),
  persisted: z.boolean()
});

const proposalActionSchema = canvasRuntimeActionDraftSchema;

export const proposeActionBatchToolInputSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  actions: z.array(proposalActionSchema).min(1),
  confirmLabel: z.string().trim().optional(),
  secondaryLabel: z.string().trim().optional()
});

export const proposeActionBatchToolDataSchema = z.object({
  proposalId: z.string(),
  title: z.string(),
  summary: z.string(),
  actions: z.array(proposalActionSchema),
  actionHash: z.string(),
  idempotencyKey: z.string(),
  affectedNodeIds: z.array(z.string()),
  warnings: z.array(z.string()),
  executable: z.literal(false)
});

export const inspectCanvasToolInputSchema = z.object({
  nodeIds: z.array(z.string().trim().min(1)).optional(),
  includeEdges: z.boolean().optional().default(true),
  includeLocked: z.boolean().optional().default(true),
  includeStale: z.boolean().optional().default(true)
});

export const inspectCanvasToolDataSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodes: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    businessType: z.string(),
    title: z.string(),
    status: z.string(),
    locked: z.boolean(),
    parentNodeIds: z.array(z.string()),
    staleReason: z.string().optional()
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional()
  })).optional(),
  lockedNodeIds: z.array(z.string()).optional(),
  staleNodeIds: z.array(z.string()).optional()
});

export type GuardedAgentToolName = z.infer<typeof guardedAgentToolNameSchema>;
export type AgentToolResultStatus = z.infer<typeof agentToolResultStatusSchema>;
export type AgentBlocker = z.infer<typeof agentBlockerSchema>;
export type AgentToolResult<TData = unknown> = Omit<z.infer<typeof agentToolResultBaseSchema>, "data" | "events" | "blocker"> & {
  data?: TData;
  events: AgentEvent[];
  blocker?: AgentBlocker;
};
export type AskUserToolInput = z.input<typeof askUserToolInputSchema>;
export type SaveArtifactToolInput = z.infer<typeof saveArtifactToolInputSchema>;
export type ProposeActionBatchToolInput = z.infer<typeof proposeActionBatchToolInputSchema>;
export type InspectCanvasToolInput = z.input<typeof inspectCanvasToolInputSchema>;

type ToolContext = {
  canvas?: CanvasSnapshot;
  artifactStore?: WorkspaceArtifactStore;
};

type StoredArtifact = NonNullable<AgentArtifacts[ArtifactSummary["kind"]]>;

function createStableId(prefix: string, value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${normalized || Date.now().toString(36)}`;
}

function createToolResult<TData>(result: AgentToolResult<TData>): AgentToolResult<TData> {
  return agentToolResultSchema.parse(result) as AgentToolResult<TData>;
}

function createErrorResult(toolName: GuardedAgentToolName, error: unknown): AgentToolResult {
  const detail = error instanceof z.ZodError
    ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
    : error instanceof Error
      ? error.message
      : "Unknown tool error.";

  return createToolResult({
    toolName,
    status: "error",
    ok: false,
    blocker: {
      code: "tool.error",
      message: detail,
      recoverable: true
    },
    events: [
      {
        kind: "status",
        label: "error",
        detail: "工具输入或执行失败"
      },
      {
        kind: "warning",
        text: detail
      }
    ]
  });
}

function isConfirmedArtifact(artifact: StoredArtifact | undefined) {
  return artifact?.status === "confirmed" || artifact?.userConfirmation?.state === "confirmed";
}

function getStoredArtifact(artifacts: AgentArtifacts, kind: ArtifactSummary["kind"]): StoredArtifact | undefined {
  return artifacts[kind];
}

function createArtifactPatch(input: SaveArtifactToolInput): ArtifactStorePatch {
  switch (input.artifactKind) {
    case "referenceAnalysis":
      return { referenceAnalysis: input.artifact };
    case "creativePlan":
      return { creativePlan: input.artifact };
    case "anchorRegistry":
      return { anchorRegistry: input.artifact };
    case "scriptDoc":
      return { scriptDoc: input.artifact };
    case "clipTable":
      return { clipTable: input.artifact };
    case "promptPack":
      return { promptPack: input.artifact };
    case "workflowPlan":
      return { workflowPlan: input.artifact };
    case "repairPlan":
      return { repairPlan: input.artifact };
  }
}

function hasBlockedProposalAction(actions: CanvasRuntimeAction[]) {
  return actions.find((action) =>
    action.type === "runNodeGeneration" ||
    action.type === "appendNodeVersion" ||
    action.type === "failNodeGeneration" ||
    action.type === "setPrimaryVersion"
  );
}

export function executeAskUserTool(input: unknown): AgentToolResult {
  const parsed = askUserToolInputSchema.safeParse(input);
  if (!parsed.success) return createErrorResult("askUser", parsed.error);

  const form = agentQuestionFormSchema.parse({
    title: parsed.data.question,
    description: parsed.data.reason,
    fields: parsed.data.fields,
    submitLabel: parsed.data.submitLabel
  });

  return createToolResult({
    toolName: "askUser",
    status: "blocker",
    ok: false,
    data: {
      question: form
    },
    blocker: {
      code: parsed.data.blockerCode ?? "user_input_required",
      message: parsed.data.reason ?? parsed.data.question,
      recoverable: true,
      suggestedQuestion: form
    },
    events: [
      {
        kind: "status",
        label: "waiting_user",
        detail: "需要用户补充信息"
      },
      {
        kind: "question",
        form
      }
    ],
    suggestedNextActions: ["等待用户回答后再继续规划。"]
  });
}

export async function executeSaveArtifactTool(
  input: unknown,
  context: Pick<ToolContext, "artifactStore">
): Promise<AgentToolResult> {
  const parsed = saveArtifactToolInputSchema.safeParse(input);
  if (!parsed.success) return createErrorResult("saveArtifact", parsed.error);

  if (!context.artifactStore) {
    return createToolResult({
      toolName: "saveArtifact",
      status: "blocker",
      ok: false,
      blocker: {
        code: "artifact_store_missing",
        message: "saveArtifact requires the workspace-backed ArtifactStore.",
        recoverable: true
      },
      events: [
        {
          kind: "warning",
          text: "缺少 workspace-backed ArtifactStore，已阻止 artifact 写入。"
        }
      ]
    });
  }

  try {
    const current = await context.artifactStore.load(parsed.data.sessionId);
    const existing = getStoredArtifact(current, parsed.data.artifactKind);
    if (isConfirmedArtifact(existing) && !parsed.data.overwriteConfirmed) {
      return createToolResult({
        toolName: "saveArtifact",
        status: "needs_approval",
        ok: false,
        data: {
          artifactKind: parsed.data.artifactKind,
          artifactId: parsed.data.artifact.id,
          summaryCount: createAgentArtifactSnapshot(current).summaries.length,
          persisted: false
        },
        blocker: {
          code: "confirmed_artifact_overwrite_requires_approval",
          message: `Artifact ${parsed.data.artifactKind} 已确认，不能静默覆盖。`,
          recoverable: true
        },
        events: [
          {
            kind: "confirmation",
            confirmation: {
              id: createStableId("artifact-overwrite", `${parsed.data.artifactKind}-${parsed.data.artifact.id}`),
              title: "确认覆盖已确认 artifact",
              summary: `Artifact ${parsed.data.artifactKind} 已确认。覆盖前需要用户确认。`,
              bullets: ["本轮未写入 ArtifactStore。", "确认后再以 overwriteConfirmed=true 重新保存。"],
              confirmLabel: "确认覆盖",
              secondaryLabel: "先调整",
              executable: false
            }
          }
        ],
        suggestedNextActions: ["向用户说明覆盖风险并请求确认。"]
      });
    }

    const nextArtifacts = mergeAgentArtifacts(current, createArtifactPatch(parsed.data));
    const savedArtifacts = await context.artifactStore.save(parsed.data.sessionId, nextArtifacts);
    const snapshot = createAgentArtifactSnapshot(savedArtifacts);

    return createToolResult({
      toolName: "saveArtifact",
      status: "ok",
      ok: true,
      data: {
        artifactKind: parsed.data.artifactKind,
        artifactId: parsed.data.artifact.id,
        summaryCount: snapshot.summaries.length,
        persisted: true
      },
      events: [
        {
          kind: "status",
          label: "done",
          detail: "Artifact 已写入 workspace"
        },
        {
          kind: "text",
          text: `已保存 ${parsed.data.artifactKind}：${parsed.data.artifact.id}`
        }
      ],
      suggestedNextActions: ["后续决策只读取 snapshot.artifacts summary，需要全文时按 artifact id 读取 ArtifactStore。"]
    });
  } catch (error) {
    return createErrorResult("saveArtifact", error);
  }
}

export function executeProposeActionBatchTool(
  input: unknown,
  context: Pick<ToolContext, "canvas">
): AgentToolResult {
  const parsed = proposeActionBatchToolInputSchema.safeParse(input);
  if (!parsed.success) return createErrorResult("proposeActionBatch", parsed.error);

  const actions = parsed.data.actions as CanvasRuntimeAction[];
  const blockedAction = hasBlockedProposalAction(actions);
  if (blockedAction) {
    return createToolResult({
      toolName: "proposeActionBatch",
      status: "blocker",
      ok: false,
      blocker: {
        code: "proposal_action_not_allowed_in_m3",
        message: `M3 proposal 不允许包含 ${blockedAction.type}，避免真实生成、版本写入或成本动作。`,
        recoverable: true
      },
      events: [
        {
          kind: "warning",
          text: `已阻止包含 ${blockedAction.type} 的 proposal。`
        }
      ],
      suggestedNextActions: ["改为只提出 create/update/connect/lock/markStale/openNodeDetail 这类待确认画布方案。"]
    });
  }

  const validation = validateCanvasActionBatch(actions, context.canvas);
  if (!validation.valid) {
    return createToolResult({
      toolName: "proposeActionBatch",
      status: "blocker",
      ok: false,
      blocker: {
        code: "canvas_action_validation_failed",
        message: validation.errors.join(" "),
        recoverable: true
      },
      events: validation.errors.map((error) => ({
        kind: "warning",
        text: error
      })),
      suggestedNextActions: ["基于 CanvasSnapshot 重新选择真实存在且未锁定的 nodeId。"]
    });
  }

  const proposalId = parsed.data.id?.trim() || createStableId("proposal", parsed.data.title);
  const actionHash = createCanvasActionHash(actions);
  const idempotencyKey = `proposal:${proposalId}:${actionHash}`;
  const affectedNodeIds = getAffectedNodeIds(actions);
  const data = {
    proposalId,
    title: parsed.data.title,
    summary: parsed.data.summary,
    actions: parsed.data.actions,
    actionHash,
    idempotencyKey,
    affectedNodeIds,
    warnings: validation.warnings,
    executable: false as const
  };

  return createToolResult({
    toolName: "proposeActionBatch",
    status: "needs_approval",
    ok: false,
    data,
    events: [
      {
        kind: "status",
        label: "waiting_user",
        detail: "画布变更仅作为待确认 proposal 返回"
      },
      {
        kind: "confirmation",
        confirmation: {
          id: proposalId,
          title: parsed.data.title,
          summary: parsed.data.summary,
          bullets: [
            `${parsed.data.actions.length} 个待确认画布动作。`,
            "本工具不会直接执行 canvas reducer。",
            ...validation.warnings.slice(0, 3)
          ],
          confirmLabel: parsed.data.confirmLabel ?? "确认方案",
          secondaryLabel: parsed.data.secondaryLabel ?? "先调整",
          executable: false
        }
      }
    ],
    suggestedNextActions: ["等待用户确认；确认前不要执行 canvasActions。"]
  });
}

export function executeInspectCanvasTool(
  input: unknown,
  context: Pick<ToolContext, "canvas">
): AgentToolResult {
  const parsed = inspectCanvasToolInputSchema.safeParse(input);
  if (!parsed.success) return createErrorResult("inspectCanvas", parsed.error);

  if (!context.canvas) {
    return createToolResult({
      toolName: "inspectCanvas",
      status: "blocker",
      ok: false,
      blocker: {
        code: "canvas_snapshot_missing",
        message: "inspectCanvas can only read an existing CanvasSnapshot.",
        recoverable: true
      },
      events: [
        {
          kind: "warning",
          text: "缺少 CanvasSnapshot，已阻止 inspectCanvas 返回推测节点。"
        }
      ]
    });
  }

  const requestedNodeIds = parsed.data.nodeIds ?? [];
  const knownNodeIds = new Set(context.canvas.nodes.map((node) => node.id));
  const missingNodeIds = requestedNodeIds.filter((nodeId) => !knownNodeIds.has(nodeId));
  if (missingNodeIds.length) {
    return createToolResult({
      toolName: "inspectCanvas",
      status: "blocker",
      ok: false,
      blocker: {
        code: "canvas_node_not_found",
        message: `CanvasSnapshot 中不存在节点：${missingNodeIds.join("、")}`,
        recoverable: true,
        fieldRefs: missingNodeIds
      },
      events: [
        {
          kind: "warning",
          text: `inspectCanvas 未返回未知节点：${missingNodeIds.join("、")}`
        }
      ],
      suggestedNextActions: ["只能使用 CanvasSnapshot.nodes 中已有的 nodeId。"]
    });
  }

  const selectedNodeIdSet = requestedNodeIds.length ? new Set(requestedNodeIds) : null;
  const nodes = context.canvas.nodes
    .filter((node) => !selectedNodeIdSet || selectedNodeIdSet.has(node.id))
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      businessType: node.businessType,
      title: node.title,
      status: node.status,
      locked: node.locked,
      parentNodeIds: node.parentNodeIds,
      staleReason: node.staleReason
    }));
  const edges = parsed.data.includeEdges
    ? context.canvas.edges.filter(
        (edge) => !selectedNodeIdSet || selectedNodeIdSet.has(edge.source) || selectedNodeIdSet.has(edge.target)
      )
    : undefined;
  const data = {
    nodeCount: nodes.length,
    edgeCount: edges?.length ?? 0,
    nodes,
    edges,
    lockedNodeIds: parsed.data.includeLocked ? context.canvas.lockedNodeIds.filter((nodeId) => !selectedNodeIdSet || selectedNodeIdSet.has(nodeId)) : undefined,
    staleNodeIds: parsed.data.includeStale ? context.canvas.staleNodeIds.filter((nodeId) => !selectedNodeIdSet || selectedNodeIdSet.has(nodeId)) : undefined
  };

  return createToolResult({
    toolName: "inspectCanvas",
    status: "ok",
    ok: true,
    data,
    events: [
      {
        kind: "status",
        label: "done",
        detail: `读取 ${nodes.length} 个 CanvasSnapshot 节点`
      }
    ]
  });
}

export const guardedAgentToolSchemas = [
  {
    name: "askUser",
    description: "Ask the user for missing production boundaries by returning a structured question blocker.",
    inputSchema: askUserToolInputSchema,
    outputSchema: agentToolResultSchema,
    execute: executeAskUserTool
  },
  {
    name: "saveArtifact",
    description: "Persist one validated Agent artifact into the workspace-backed ArtifactStore and rely on artifact.saved event logging.",
    inputSchema: saveArtifactToolInputSchema,
    outputSchema: agentToolResultSchema,
    execute: executeSaveArtifactTool
  },
  {
    name: "proposeActionBatch",
    description: "Return a user-confirmed canvas action proposal without executing canvas mutations.",
    inputSchema: proposeActionBatchToolInputSchema,
    outputSchema: agentToolResultSchema,
    execute: executeProposeActionBatchTool
  },
  {
    name: "inspectCanvas",
    description: "Read only the supplied CanvasSnapshot summary and block unknown node ids.",
    inputSchema: inspectCanvasToolInputSchema,
    outputSchema: agentToolResultSchema,
    execute: executeInspectCanvasTool
  }
] as const;
