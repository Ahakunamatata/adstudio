import type { ControlledGenerationRequest } from "@/features/agent-runtime/generation-executor";
import type { ApprovalRequestRecord } from "@/lib/agent-project-store";

type StableJsonValue = null | boolean | number | string | StableJsonValue[] | { [key: string]: StableJsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): StableJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createGenerationActionHash(generation: ControlledGenerationRequest) {
  return `generation:vidu-workbench:${hashString(JSON.stringify(stableJson(generation)))}`;
}

export function createGenerationIdempotencyKey(projectId: string, actionHash: string) {
  return `m54:${projectId}:${actionHash}`;
}

export function createGenerationApprovalRequest(input: {
  projectId: string;
  sessionId?: string;
  title: string;
  summary: string;
  generation: ControlledGenerationRequest;
  approvalId?: string;
  estimatedCredits?: number;
  now?: string;
  requestedBy?: string;
}): ApprovalRequestRecord {
  const now = input.now ?? new Date().toISOString();
  const actionHash = createGenerationActionHash(input.generation);
  const idempotencyKey = createGenerationIdempotencyKey(input.projectId, actionHash);
  const approvalId = input.approvalId?.trim() || `approval-m54-${hashString(`${input.projectId}:${actionHash}`)}`;

  return {
    schemaVersion: 1,
    id: approvalId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    kind: "generation",
    title: input.title,
    summary: input.summary,
    status: "pending",
    requestedActions: [],
    actionHash,
    idempotencyKey,
    affectedNodeIds: input.generation.nodeId ? [input.generation.nodeId] : [],
    affectedArtifactIds: input.generation.artifactId ? [input.generation.artifactId] : [],
    estimatedCredits: input.estimatedCredits ?? 0,
    requestedBy: input.requestedBy ?? "agent",
    requestedAt: now
  };
}
