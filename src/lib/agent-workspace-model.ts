import { agentArtifactsSchema, createAgentArtifactSnapshot, type AgentArtifacts } from "@/features/agent-runtime/artifacts";
import type { AgentMode, AgentSession, AppRoute } from "@/lib/domain/schemas";
import type { AgentProjectBundle } from "@/lib/agent-project-store";

export type AgentSessionRecord = {
  id: string;
  title: string;
  product: string;
  mode: AgentMode;
  updatedAt: string;
  session: AgentSession;
  runtime?: unknown;
};

export type AgentWorkspaceArtifactSource =
  | "workspace"
  | "workspace-api"
  | "workspace-localStorage"
  | "legacy-local-artifact-store"
  | "runtime-localStorage"
  | "memory";

export type AgentWorkspaceArtifactRecord = {
  schemaVersion: 1;
  projectId: string;
  sessionId: string;
  artifacts: AgentArtifacts;
  updatedAt: string;
  source: AgentWorkspaceArtifactSource;
};

export type AgentWorkspaceEventKind = "artifact.saved" | "artifact.loaded" | "artifact.restore_failed";

export type AgentWorkspaceEvent = {
  id: string;
  kind: AgentWorkspaceEventKind;
  projectId: string;
  sessionId: string;
  createdAt: string;
  message: string;
  source: AgentWorkspaceArtifactSource;
  artifactSummaryCount?: number;
  error?: string;
};

export type StoredAgentWorkspace = {
  route: AppRoute;
  selectedProduct: string;
  setupMode: AgentMode;
  activeSessionId: string | null;
  sessions: AgentSessionRecord[];
  artifacts: AgentWorkspaceArtifactRecord[];
  eventLog: AgentWorkspaceEvent[];
  projectBundles?: AgentProjectBundle[];
};

export type AgentWorkspaceCollections = Pick<StoredAgentWorkspace, "artifacts" | "eventLog">;

const maxWorkspaceEventLogEntries = 200;
const artifactSources = new Set<AgentWorkspaceArtifactSource>([
  "workspace",
  "workspace-api",
  "workspace-localStorage",
  "legacy-local-artifact-store",
  "runtime-localStorage",
  "memory"
]);
const eventKinds = new Set<AgentWorkspaceEventKind>(["artifact.saved", "artifact.loaded", "artifact.restore_failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isArtifactSource(value: unknown): value is AgentWorkspaceArtifactSource {
  return typeof value === "string" && artifactSources.has(value as AgentWorkspaceArtifactSource);
}

function isAgentMode(value: unknown): value is AgentMode {
  return value === "clone" || value === "create";
}

function isEventKind(value: unknown): value is AgentWorkspaceEventKind {
  return typeof value === "string" && eventKinds.has(value as AgentWorkspaceEventKind);
}

function timestampOrNow(value: unknown) {
  return typeof value === "string" && value.trim() ? value : new Date().toISOString();
}

function compareUpdatedAt(left: string | undefined, right: string | undefined) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return leftTime - rightTime;
}

export function getAgentWorkspaceProjectId(sessionId: string) {
  return sessionId;
}

export function getAgentArtifactSummaryCount(artifacts: AgentArtifacts) {
  return createAgentArtifactSnapshot(artifacts).summaries.length;
}

export function isAgentArtifactsEmpty(artifacts: AgentArtifacts | null | undefined) {
  return getAgentArtifactSummaryCount(agentArtifactsSchema.parse(artifacts ?? { schemaVersion: 1 })) === 0;
}

export function normalizeAgentWorkspaceSessionRecord(value: unknown): AgentSessionRecord | null {
  if (!isRecord(value) || !isRecord(value.session)) return null;
  const session = value.session as Partial<AgentSession>;
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id
    : typeof session.id === "string" && session.id.trim()
      ? session.id
      : "";
  if (!id) return null;

  const mode = isAgentMode(value.mode) ? value.mode : isAgentMode(session.mode) ? session.mode : "clone";
  return {
    id,
    title: typeof value.title === "string" ? value.title : typeof session.projectTitle === "string" ? session.projectTitle : "未命名项目",
    product: typeof value.product === "string" ? value.product : typeof session.product === "string" ? session.product : "",
    mode,
    updatedAt: timestampOrNow(value.updatedAt),
    session: {
      ...(value.session as AgentSession),
      id,
      mode
    },
    runtime: value.runtime
  };
}

export function mergeAgentWorkspaceSessionRecords(...groups: AgentSessionRecord[][]): AgentSessionRecord[] {
  const records = new Map<string, AgentSessionRecord>();

  for (const group of groups) {
    for (const record of group) {
      const normalizedRecord = normalizeAgentWorkspaceSessionRecord(record);
      if (!normalizedRecord) continue;

      const existing = records.get(normalizedRecord.id);
      if (!existing || compareUpdatedAt(existing.updatedAt, normalizedRecord.updatedAt) <= 0) {
        records.set(normalizedRecord.id, normalizedRecord);
      }
    }
  }

  return Array.from(records.values()).sort((left, right) => compareUpdatedAt(right.updatedAt, left.updatedAt));
}

export function normalizeAgentWorkspaceSessionRecords(value: unknown): AgentSessionRecord[] {
  if (!Array.isArray(value)) return [];
  return mergeAgentWorkspaceSessionRecords(
    value
      .map(normalizeAgentWorkspaceSessionRecord)
      .filter((record): record is AgentSessionRecord => Boolean(record))
  );
}

export function normalizeAgentWorkspaceArtifactRecord(value: unknown): AgentWorkspaceArtifactRecord | null {
  if (!isRecord(value)) return null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId : "";
  if (!sessionId) return null;

  const parsedArtifacts = agentArtifactsSchema.safeParse(value.artifacts);
  if (!parsedArtifacts.success) return null;

  return {
    schemaVersion: 1,
    projectId: typeof value.projectId === "string" && value.projectId.trim() ? value.projectId : getAgentWorkspaceProjectId(sessionId),
    sessionId,
    artifacts: parsedArtifacts.data,
    updatedAt: timestampOrNow(value.updatedAt ?? parsedArtifacts.data.updatedAt),
    source: isArtifactSource(value.source) ? value.source : "workspace"
  };
}

export function normalizeAgentWorkspaceArtifactRecords(value: unknown): AgentWorkspaceArtifactRecord[] {
  if (!Array.isArray(value)) return [];
  return mergeAgentWorkspaceArtifactRecords(
    value
      .map(normalizeAgentWorkspaceArtifactRecord)
      .filter((record): record is AgentWorkspaceArtifactRecord => Boolean(record))
  );
}

export function normalizeAgentWorkspaceEvent(value: unknown): AgentWorkspaceEvent | null {
  if (!isRecord(value)) return null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId : "";
  const kind = isEventKind(value.kind) ? value.kind : null;
  if (!sessionId || !kind) return null;

  const artifactSummaryCount = typeof value.artifactSummaryCount === "number" && Number.isFinite(value.artifactSummaryCount)
    ? value.artifactSummaryCount
    : undefined;

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    projectId: typeof value.projectId === "string" && value.projectId.trim() ? value.projectId : getAgentWorkspaceProjectId(sessionId),
    sessionId,
    createdAt: timestampOrNow(value.createdAt),
    message: typeof value.message === "string" ? value.message : kind,
    source: isArtifactSource(value.source) ? value.source : "workspace",
    artifactSummaryCount,
    error: typeof value.error === "string" ? value.error.slice(0, 500) : undefined
  };
}

export function normalizeAgentWorkspaceEventLog(value: unknown): AgentWorkspaceEvent[] {
  if (!Array.isArray(value)) return [];
  const events = value
    .map(normalizeAgentWorkspaceEvent)
    .filter((event): event is AgentWorkspaceEvent => Boolean(event));
  return mergeAgentWorkspaceEventLog(events);
}

export function mergeAgentWorkspaceArtifactRecords(...groups: AgentWorkspaceArtifactRecord[][]): AgentWorkspaceArtifactRecord[] {
  const records = new Map<string, AgentWorkspaceArtifactRecord>();

  for (const group of groups) {
    for (const record of group) {
      const existing = records.get(record.sessionId);
      if (!existing || compareUpdatedAt(existing.updatedAt, record.updatedAt) <= 0) {
        records.set(record.sessionId, record);
      }
    }
  }

  return Array.from(records.values()).sort((left, right) => compareUpdatedAt(right.updatedAt, left.updatedAt));
}

export function mergeAgentWorkspaceEventLog(...groups: AgentWorkspaceEvent[][]): AgentWorkspaceEvent[] {
  const events = new Map<string, AgentWorkspaceEvent>();

  for (const group of groups) {
    for (const event of group) {
      events.set(event.id, event);
    }
  }

  return Array.from(events.values())
    .sort((left, right) => compareUpdatedAt(left.createdAt, right.createdAt))
    .slice(-maxWorkspaceEventLogEntries);
}

export function mergeAgentWorkspaceCollections(...groups: AgentWorkspaceCollections[]): AgentWorkspaceCollections {
  return {
    artifacts: mergeAgentWorkspaceArtifactRecords(...groups.map((group) => group.artifacts)),
    eventLog: mergeAgentWorkspaceEventLog(...groups.map((group) => group.eventLog))
  };
}

export function removeAgentWorkspaceSessionCollections(collections: AgentWorkspaceCollections, sessionId: string): AgentWorkspaceCollections {
  return {
    artifacts: collections.artifacts.filter((record) => record.sessionId !== sessionId),
    eventLog: collections.eventLog.filter((event) => event.sessionId !== sessionId)
  };
}

export function upsertAgentWorkspaceArtifactRecord(
  records: AgentWorkspaceArtifactRecord[],
  record: AgentWorkspaceArtifactRecord
) {
  return mergeAgentWorkspaceArtifactRecords(records.filter((item) => item.sessionId !== record.sessionId), [record]);
}

export function appendAgentWorkspaceEventLog(events: AgentWorkspaceEvent[], event: AgentWorkspaceEvent) {
  return mergeAgentWorkspaceEventLog(events, [event]);
}

export function createAgentWorkspaceEvent(input: {
  kind: AgentWorkspaceEventKind;
  sessionId: string;
  message: string;
  source: AgentWorkspaceArtifactSource;
  artifacts?: AgentArtifacts;
  error?: unknown;
}): AgentWorkspaceEvent {
  const createdAt = new Date().toISOString();
  const error = input.error instanceof Error ? input.error.message : typeof input.error === "string" ? input.error : undefined;
  return {
    id: `${input.kind}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    projectId: getAgentWorkspaceProjectId(input.sessionId),
    sessionId: input.sessionId,
    createdAt,
    message: input.message,
    source: input.source,
    artifactSummaryCount: input.artifacts ? getAgentArtifactSummaryCount(input.artifacts) : undefined,
    error: error?.slice(0, 500)
  };
}
