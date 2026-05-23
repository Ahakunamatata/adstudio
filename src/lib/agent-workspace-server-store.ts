import {
  normalizeAgentProjectBundle,
  type AgentProjectBundle,
  type AgentProjectPatch
} from "@/lib/agent-project-store";
import { createServerAgentProjectStore } from "@/lib/agent-project-server-store";
import {
  deleteLocalAgentWorkspaceSession,
  getLocalAgentWorkspace,
  saveLocalAgentWorkspace
} from "@/lib/agent-workspace-store";
import type { StoredAgentWorkspace } from "@/lib/agent-workspace-model";

function bundleToPatch(bundle: AgentProjectBundle): AgentProjectPatch {
  return {
    project: bundle.project,
    sessions: bundle.sessions,
    artifacts: bundle.artifacts,
    approvalRequests: bundle.approvalRequests,
    canvasGraph: bundle.canvasGraph,
    generationTasks: bundle.generationTasks,
    mediaAssets: bundle.mediaAssets,
    events: bundle.events,
    updatedAt: bundle.updatedAt
  };
}

function getWorkspaceProjectIds(workspace: StoredAgentWorkspace) {
  return Array.from(new Set([
    ...(workspace.projectBundles ?? []).map((bundle) => bundle.project.id),
    ...(workspace.activeSessionId ? [workspace.activeSessionId] : []),
    ...workspace.sessions.map((record) => record.id)
  ].filter(Boolean)));
}

async function hydrateWorkspaceBundles(workspace: StoredAgentWorkspace) {
  const store = createServerAgentProjectStore();
  const bundles = new Map((workspace.projectBundles ?? []).map((bundle) => [bundle.project.id, bundle]));

  for (const projectId of getWorkspaceProjectIds(workspace)) {
    const bundle = await store.loadProject(projectId).catch(() => null);
    if (bundle) bundles.set(projectId, bundle);
  }

  return {
    ...workspace,
    projectBundles: Array.from(bundles.values())
  };
}

async function persistWorkspaceBundles(workspace: StoredAgentWorkspace) {
  const store = createServerAgentProjectStore();
  const bundles: AgentProjectBundle[] = [];

  for (const candidate of workspace.projectBundles ?? []) {
    const bundle = normalizeAgentProjectBundle(candidate);
    if (!bundle) continue;
    const savedBundle = await store.saveProjectPatch(bundle.project.id, bundleToPatch(bundle));
    bundles.push(savedBundle);
  }

  return {
    ...workspace,
    projectBundles: bundles.length ? bundles : workspace.projectBundles ?? []
  };
}

export async function getServerAgentWorkspace() {
  return hydrateWorkspaceBundles(await getLocalAgentWorkspace());
}

export async function saveServerAgentWorkspace(value: unknown) {
  const localWorkspace = await saveLocalAgentWorkspace(value);
  return persistWorkspaceBundles(localWorkspace);
}

export async function deleteServerAgentWorkspaceSession(sessionId: string) {
  const workspace = await deleteLocalAgentWorkspaceSession(sessionId);
  await createServerAgentProjectStore().archiveProject(sessionId).catch(() => undefined);
  return hydrateWorkspaceBundles(workspace);
}

export async function getServerAgentSessionReplayWorkspace(sessionId: string) {
  const workspace = await getLocalAgentWorkspace();
  const hydrated = await hydrateWorkspaceBundles(workspace);
  if (hydrated.projectBundles?.some((bundle) =>
    bundle.project.id === sessionId ||
    bundle.project.activeSessionId === sessionId ||
    bundle.sessions.some((record) => record.id === sessionId)
  )) {
    return hydrated;
  }

  const bundle = await createServerAgentProjectStore().loadProject(sessionId).catch(() => null);
  if (!bundle) return hydrated;
  return {
    ...hydrated,
    projectBundles: [...(hydrated.projectBundles ?? []), bundle]
  };
}
