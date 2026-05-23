"use client";

import {
  createWorkspaceAgentProjectStore,
  normalizeAgentProjectBundles,
  type AgentProjectBundle
} from "@/lib/agent-project-store";
import type { StoredAgentWorkspace } from "@/lib/agent-workspace-model";

const workspaceStorageKey = "ad-studio:agent-workspace:v2";

function createEmptyWorkspace(): StoredAgentWorkspace {
  return {
    route: "workbench",
    selectedProduct: "",
    setupMode: "clone",
    activeSessionId: null,
    sessions: [],
    artifacts: [],
    eventLog: [],
    projectBundles: []
  };
}

function readWorkspace(): StoredAgentWorkspace {
  if (typeof window === "undefined") return createEmptyWorkspace();

  try {
    const rawWorkspace = window.localStorage.getItem(workspaceStorageKey);
    const parsed = rawWorkspace ? JSON.parse(rawWorkspace) as Partial<StoredAgentWorkspace> : {};
    return {
      ...createEmptyWorkspace(),
      ...parsed,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog : [],
      projectBundles: normalizeAgentProjectBundles(parsed.projectBundles)
    };
  } catch {
    return createEmptyWorkspace();
  }
}

function writeWorkspace(workspace: StoredAgentWorkspace) {
  if (typeof window === "undefined") return;
  const current = readWorkspace();
  const nextWorkspace: StoredAgentWorkspace = {
    ...current,
    ...workspace,
    projectBundles: normalizeAgentProjectBundles(workspace.projectBundles)
  };
  window.localStorage.setItem(workspaceStorageKey, JSON.stringify(nextWorkspace));
}

export function upsertBrowserAgentProjectBundle(bundle: AgentProjectBundle) {
  const workspace = readWorkspace();
  writeWorkspace({
    ...workspace,
    projectBundles: normalizeAgentProjectBundles([
      ...(workspace.projectBundles ?? []).filter((item) => item.project.id !== bundle.project.id),
      bundle
    ])
  });
}

export async function syncBrowserAgentWorkspaceToServer() {
  const workspace = readWorkspace();
  await fetch("/api/agent/workspace", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(workspace)
  });
}

export function createBrowserAgentProjectStore() {
  return createWorkspaceAgentProjectStore({
    readWorkspace: async () => readWorkspace(),
    writeWorkspace: async (workspace) => writeWorkspace(workspace as StoredAgentWorkspace)
  });
}

export function readBrowserAgentProjectBundles(): AgentProjectBundle[] {
  return readWorkspace().projectBundles ?? [];
}
