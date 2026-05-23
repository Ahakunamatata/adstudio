import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMode, AgentSession, AppRoute } from "@/lib/domain/schemas";
import { createWorkspaceAgentProjectStore, normalizeAgentProjectBundles } from "@/lib/agent-project-store";
import {
  normalizeAgentWorkspaceArtifactRecords,
  normalizeAgentWorkspaceEventLog,
  removeAgentWorkspaceSessionCollections,
  type AgentSessionRecord,
  type StoredAgentWorkspace
} from "@/lib/agent-workspace-model";

const workspaceFilePath = path.join(process.cwd(), ".next", "cache", "ad-studio-agent-workspace.json");

const defaultWorkspace: StoredAgentWorkspace = {
  route: "home",
  selectedProduct: "",
  setupMode: "clone",
  activeSessionId: null,
  sessions: [],
  artifacts: [],
  eventLog: [],
  projectBundles: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAppRoute(value: unknown): value is AppRoute {
  return (
    value === "home" ||
    value === "agent" ||
    value === "agent-setup" ||
    value === "workbench" ||
    value === "video" ||
    value === "image" ||
    value === "templates" ||
    value === "assets"
  );
}

function isAgentMode(value: unknown): value is AgentMode {
  return value === "clone" || value === "create";
}

function parseAgentSessionRecord(value: unknown): AgentSessionRecord | null {
  if (!isRecord(value) || !isRecord(value.session)) return null;
  const session = value.session as Partial<AgentSession>;
  const id = typeof value.id === "string" ? value.id : typeof session.id === "string" ? session.id : "";
  if (!id) return null;

  const mode = isAgentMode(value.mode) ? value.mode : isAgentMode(session.mode) ? session.mode : "clone";
  return {
    id,
    title: typeof value.title === "string" ? value.title : typeof session.projectTitle === "string" ? session.projectTitle : "未命名项目",
    product: typeof value.product === "string" ? value.product : typeof session.product === "string" ? session.product : "",
    mode,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    session: {
      ...(value.session as AgentSession),
      id,
      mode
    },
    runtime: value.runtime
  };
}

function parseAgentWorkspace(value: unknown): StoredAgentWorkspace {
  if (!isRecord(value)) return defaultWorkspace;
  const sessions = Array.isArray(value.sessions) ? value.sessions.map(parseAgentSessionRecord).filter((item): item is AgentSessionRecord => Boolean(item)) : [];
  const activeSessionId = typeof value.activeSessionId === "string" && sessions.some((record) => record.id === value.activeSessionId)
    ? value.activeSessionId
    : sessions[0]?.id ?? null;

  return {
    route: isAppRoute(value.route) ? value.route : defaultWorkspace.route,
    selectedProduct: typeof value.selectedProduct === "string" ? value.selectedProduct : "",
    setupMode: isAgentMode(value.setupMode) ? value.setupMode : "clone",
    activeSessionId,
    sessions,
    artifacts: normalizeAgentWorkspaceArtifactRecords(value.artifacts),
    eventLog: normalizeAgentWorkspaceEventLog(value.eventLog),
    projectBundles: normalizeAgentProjectBundles(value.projectBundles)
  };
}

async function readStoredWorkspaceFile(): Promise<StoredAgentWorkspace> {
  try {
    return parseAgentWorkspace(JSON.parse(await readFile(workspaceFilePath, "utf8")));
  } catch {
    return defaultWorkspace;
  }
}

async function writeStoredWorkspaceFile(workspace: StoredAgentWorkspace) {
  await mkdir(path.dirname(workspaceFilePath), { recursive: true });
  await writeFile(workspaceFilePath, JSON.stringify(workspace, null, 2));
}

export async function getLocalAgentWorkspace() {
  return readStoredWorkspaceFile();
}

export async function saveLocalAgentWorkspace(value: unknown) {
  const workspace = parseAgentWorkspace(value);
  await writeStoredWorkspaceFile(workspace);
  return workspace;
}

export async function deleteLocalAgentWorkspaceSession(sessionId: string) {
  const workspace = await readStoredWorkspaceFile();
  const sessions = workspace.sessions.filter((record) => record.id !== sessionId);
  const collections = removeAgentWorkspaceSessionCollections(workspace, sessionId);
  const nextWorkspace: StoredAgentWorkspace = {
    ...workspace,
    activeSessionId: workspace.activeSessionId === sessionId ? sessions[0]?.id ?? null : workspace.activeSessionId,
    sessions,
    ...collections,
    projectBundles: (workspace.projectBundles ?? []).flatMap((bundle) => {
      const hadSession = bundle.sessions.some((record) => record.id === sessionId) || bundle.project.activeSessionId === sessionId;
      if (!hadSession) return [bundle];
      const nextSessions = bundle.sessions.filter((record) => record.id !== sessionId);
      if (!nextSessions.length) return [];
      return [
        {
          ...bundle,
          project: {
            ...bundle.project,
            activeSessionId: bundle.project.activeSessionId === sessionId ? nextSessions[0]?.id : bundle.project.activeSessionId
          },
          sessions: nextSessions,
          artifacts: bundle.artifacts.filter((record) => record.sessionId !== sessionId),
          approvalRequests: bundle.approvalRequests.filter((record) => record.sessionId !== sessionId),
          generationTasks: bundle.generationTasks.filter((record) => record.sessionId !== sessionId),
          mediaAssets: bundle.mediaAssets.filter((record) => record.sessionId !== sessionId),
          events: bundle.events.filter((event) => event.sessionId !== sessionId)
        }
      ];
    })
  };
  await writeStoredWorkspaceFile(nextWorkspace);
  return nextWorkspace;
}

export function createLocalAgentProjectStore() {
  return createWorkspaceAgentProjectStore({
    readWorkspace: readStoredWorkspaceFile,
    writeWorkspace: async (workspace) => writeStoredWorkspaceFile(parseAgentWorkspace(workspace))
  });
}
