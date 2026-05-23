import {
  agentArtifactsSchema,
  createAgentArtifactSnapshot,
  createEmptyAgentArtifacts,
  type AgentArtifacts
} from "./artifacts";
import {
  appendAgentWorkspaceEventLog,
  createAgentWorkspaceEvent,
  getAgentWorkspaceProjectId,
  mergeAgentWorkspaceArtifactRecords,
  mergeAgentWorkspaceSessionRecords,
  normalizeAgentWorkspaceArtifactRecords,
  normalizeAgentWorkspaceEventLog,
  normalizeAgentWorkspaceSessionRecords,
  upsertAgentWorkspaceArtifactRecord,
  type AgentWorkspaceArtifactSource,
  type AgentSessionRecord,
  type StoredAgentWorkspace
} from "@/lib/agent-workspace-model";

export type ArtifactStorePatch = Partial<Omit<AgentArtifacts, "schemaVersion">>;

export type ArtifactStore = {
  load: (sessionId: string) => Promise<AgentArtifacts>;
  save: (sessionId: string, artifacts: AgentArtifacts) => Promise<AgentArtifacts>;
  patch: (sessionId: string, patch: ArtifactStorePatch) => Promise<AgentArtifacts>;
  clear: (sessionId: string) => Promise<void>;
};

export type WorkspaceArtifactStore = ArtifactStore & {
  recordRestoreFailure: (sessionId: string, error: unknown, source?: AgentWorkspaceArtifactSource) => Promise<void>;
};

type BrowserWorkspaceArtifactStoreOptions = {
  workspaceStorageKey?: string;
  workspaceApiPath?: string;
  legacyStorageKeyPrefix?: string;
};

export function mergeAgentArtifacts(current: AgentArtifacts | null | undefined, patch: ArtifactStorePatch): AgentArtifacts {
  return agentArtifactsSchema.parse({
    ...createEmptyAgentArtifacts(),
    ...current,
    ...patch,
    schemaVersion: 1,
    updatedAt: patch.updatedAt ?? new Date().toISOString()
  });
}

export function createMemoryArtifactStore(initialEntries?: Iterable<[string, AgentArtifacts]>): ArtifactStore {
  const records = new Map(initialEntries);

  return {
    async load(sessionId) {
      return records.get(sessionId) ?? createEmptyAgentArtifacts();
    },
    async save(sessionId, artifacts) {
      const parsed = agentArtifactsSchema.parse(artifacts);
      records.set(sessionId, parsed);
      return parsed;
    },
    async patch(sessionId, patch) {
      const nextArtifacts = mergeAgentArtifacts(records.get(sessionId), patch);
      records.set(sessionId, nextArtifacts);
      return nextArtifacts;
    },
    async clear(sessionId) {
      records.delete(sessionId);
    }
  };
}

export function createBrowserLocalArtifactStore(storageKeyPrefix = "ad-studio:agent-artifacts:v1:"): ArtifactStore {
  const fallbackStore = createMemoryArtifactStore();

  function getStorageKey(sessionId: string) {
    return `${storageKeyPrefix}${sessionId}`;
  }

  function canUseLocalStorage() {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  }

  return {
    async load(sessionId) {
      if (!canUseLocalStorage()) return fallbackStore.load(sessionId);
      try {
        const raw = window.localStorage.getItem(getStorageKey(sessionId));
        return raw ? agentArtifactsSchema.parse(JSON.parse(raw)) : createEmptyAgentArtifacts();
      } catch {
        return createEmptyAgentArtifacts();
      }
    },
    async save(sessionId, artifacts) {
      const parsed = agentArtifactsSchema.parse(artifacts);
      if (!canUseLocalStorage()) return fallbackStore.save(sessionId, parsed);
      try {
        window.localStorage.setItem(getStorageKey(sessionId), JSON.stringify(parsed));
      } catch {
        await fallbackStore.save(sessionId, parsed);
      }
      return parsed;
    },
    async patch(sessionId, patch) {
      const current = await this.load(sessionId);
      const nextArtifacts = mergeAgentArtifacts(current, patch);
      return this.save(sessionId, nextArtifacts);
    },
    async clear(sessionId) {
      if (!canUseLocalStorage()) {
        await fallbackStore.clear(sessionId);
        return;
      }
      try {
        window.localStorage.removeItem(getStorageKey(sessionId));
      } catch {
        await fallbackStore.clear(sessionId);
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceDraft(value: unknown): Partial<StoredAgentWorkspace> & Pick<StoredAgentWorkspace, "artifacts" | "eventLog"> {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    sessions: normalizeAgentWorkspaceSessionRecords(source.sessions),
    artifacts: normalizeAgentWorkspaceArtifactRecords(source.artifacts),
    eventLog: normalizeAgentWorkspaceEventLog(source.eventLog)
  } as Partial<StoredAgentWorkspace> & Pick<StoredAgentWorkspace, "artifacts" | "eventLog">;
}

function getWorkspaceArtifactRecord(value: unknown, sessionId: string) {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) return null;
  return value.artifacts.find((item) => isRecord(item) && item.sessionId === sessionId) ?? null;
}

function getArtifactParseError(value: unknown, sessionId: string) {
  const record = getWorkspaceArtifactRecord(value, sessionId);
  if (!record || !isRecord(record)) return null;
  const parsedArtifacts = agentArtifactsSchema.safeParse(record.artifacts);
  return parsedArtifacts.success ? null : parsedArtifacts.error;
}

function chooseWorkspaceArtifacts(sessionId: string, ...workspaces: Array<ReturnType<typeof normalizeWorkspaceDraft> | null>) {
  const records = mergeAgentWorkspaceArtifactRecords(
    ...workspaces
      .filter((workspace): workspace is ReturnType<typeof normalizeWorkspaceDraft> => Boolean(workspace))
      .map((workspace) => workspace.artifacts.filter((record) => record.sessionId === sessionId))
  );
  return records[0]?.artifacts ?? null;
}

function hasWorkspaceSessions(workspace: ReturnType<typeof normalizeWorkspaceDraft>) {
  return Array.isArray(workspace.sessions) && workspace.sessions.length > 0;
}

function getSessionUpdatedTime(record: AgentSessionRecord | null | undefined) {
  const time = record?.updatedAt ? Date.parse(record.updatedAt) : 0;
  return Number.isFinite(time) ? time : 0;
}

function getLatestWorkspaceSessionTime(workspace: ReturnType<typeof normalizeWorkspaceDraft>) {
  return Math.max(0, ...(workspace.sessions ?? []).map(getSessionUpdatedTime));
}

function getActiveWorkspaceSession(workspace: ReturnType<typeof normalizeWorkspaceDraft>) {
  const activeSessionId = typeof workspace.activeSessionId === "string" ? workspace.activeSessionId : "";
  if (!activeSessionId) return null;
  return (workspace.sessions ?? []).find((record) => record.id === activeSessionId) ?? null;
}

function chooseWorkspaceEnvelope(
  localWorkspace: ReturnType<typeof normalizeWorkspaceDraft>,
  sharedWorkspace: ReturnType<typeof normalizeWorkspaceDraft>
) {
  if (hasWorkspaceSessions(localWorkspace) && hasWorkspaceSessions(sharedWorkspace)) {
    return getLatestWorkspaceSessionTime(sharedWorkspace) > getLatestWorkspaceSessionTime(localWorkspace)
      ? sharedWorkspace
      : localWorkspace;
  }
  if (hasWorkspaceSessions(localWorkspace)) return localWorkspace;
  if (hasWorkspaceSessions(sharedWorkspace)) return sharedWorkspace;
  return {
    ...localWorkspace,
    ...sharedWorkspace
  };
}

function chooseWorkspaceActiveSessionId(
  localWorkspace: ReturnType<typeof normalizeWorkspaceDraft>,
  sharedWorkspace: ReturnType<typeof normalizeWorkspaceDraft>,
  sessions: AgentSessionRecord[]
) {
  const localActiveSession = getActiveWorkspaceSession(localWorkspace);
  const sharedActiveSession = getActiveWorkspaceSession(sharedWorkspace);
  const activeSession = getSessionUpdatedTime(sharedActiveSession) > getSessionUpdatedTime(localActiveSession)
    ? sharedActiveSession
    : localActiveSession;
  if (activeSession && sessions.some((record) => record.id === activeSession.id)) return activeSession.id;
  return sessions[0]?.id ?? null;
}

function withUpdatedAt(artifacts: AgentArtifacts): AgentArtifacts {
  return agentArtifactsSchema.parse({
    ...artifacts,
    updatedAt: artifacts.updatedAt ?? new Date().toISOString()
  });
}

export function createBrowserWorkspaceArtifactStore(options: BrowserWorkspaceArtifactStoreOptions = {}): WorkspaceArtifactStore {
  const workspaceStorageKey = options.workspaceStorageKey ?? "ad-studio:agent-workspace:v2";
  const workspaceApiPath = options.workspaceApiPath ?? "/api/agent/workspace";
  const legacyStorageKeyPrefix = options.legacyStorageKeyPrefix ?? "ad-studio:agent-artifacts:v1:";
  const fallbackStore = createMemoryArtifactStore();

  function canUseLocalStorage() {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  }

  function canUseFetch() {
    return typeof fetch === "function";
  }

  function readLocalWorkspaceRaw() {
    if (!canUseLocalStorage()) return null;
    try {
      const rawWorkspace = window.localStorage.getItem(workspaceStorageKey);
      return rawWorkspace ? JSON.parse(rawWorkspace) : null;
    } catch {
      return null;
    }
  }

  function writeLocalWorkspace(workspace: ReturnType<typeof normalizeWorkspaceDraft>) {
    if (!canUseLocalStorage()) return;
    try {
      window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
    } catch {
      // The API or memory fallback still keeps the current session usable.
    }
  }

  async function readSharedWorkspaceRaw() {
    if (!canUseFetch()) return null;
    try {
      const response = await fetch(workspaceApiPath, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async function writeSharedWorkspace(workspace: ReturnType<typeof normalizeWorkspaceDraft>) {
    if (!canUseFetch()) return;
    try {
      await fetch(workspaceApiPath, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(workspace)
      });
    } catch {
      // Browser-local project state remains the MVP cache if the local API is unavailable.
    }
  }

  async function mutateWorkspace(
    mutator: (workspace: ReturnType<typeof normalizeWorkspaceDraft>) => ReturnType<typeof normalizeWorkspaceDraft>
  ) {
    const localWorkspace = normalizeWorkspaceDraft(readLocalWorkspaceRaw());
    const sharedWorkspace = normalizeWorkspaceDraft(await readSharedWorkspaceRaw());
    const workspaceEnvelope = chooseWorkspaceEnvelope(localWorkspace, sharedWorkspace);
    const sessions = mergeAgentWorkspaceSessionRecords(localWorkspace.sessions ?? [], sharedWorkspace.sessions ?? []);
    const activeSessionId = chooseWorkspaceActiveSessionId(localWorkspace, sharedWorkspace, sessions);
    const activeSession = activeSessionId ? sessions.find((record) => record.id === activeSessionId) ?? null : null;
    const baseWorkspace = {
      ...workspaceEnvelope,
      activeSessionId,
      sessions,
      selectedProduct: activeSession?.product ?? workspaceEnvelope.selectedProduct,
      setupMode: activeSession?.mode ?? workspaceEnvelope.setupMode,
      artifacts: mergeAgentWorkspaceArtifactRecords(localWorkspace.artifacts, sharedWorkspace.artifacts),
      eventLog: normalizeAgentWorkspaceEventLog([...localWorkspace.eventLog, ...sharedWorkspace.eventLog])
    };
    const nextWorkspace = mutator(baseWorkspace);
    writeLocalWorkspace(nextWorkspace);
    await writeSharedWorkspace(nextWorkspace);
    return nextWorkspace;
  }

  async function appendEvent(
    sessionId: string,
    input: {
      kind: "artifact.saved" | "artifact.loaded" | "artifact.restore_failed";
      message: string;
      source: AgentWorkspaceArtifactSource;
      artifacts?: AgentArtifacts;
      error?: unknown;
    }
  ) {
    const event = createAgentWorkspaceEvent({
      sessionId,
      kind: input.kind,
      message: input.message,
      source: input.source,
      artifacts: input.artifacts,
      error: input.error
    });

    await mutateWorkspace((workspace) => ({
      ...workspace,
      eventLog: appendAgentWorkspaceEventLog(workspace.eventLog, event)
    }));
  }

  function loadLegacyArtifacts(sessionId: string) {
    if (!canUseLocalStorage()) return { artifacts: null, error: null };
    try {
      const rawArtifacts = window.localStorage.getItem(`${legacyStorageKeyPrefix}${sessionId}`);
      if (!rawArtifacts) return { artifacts: null, error: null };
      const parsedArtifacts = agentArtifactsSchema.safeParse(JSON.parse(rawArtifacts));
      if (!parsedArtifacts.success) return { artifacts: null, error: parsedArtifacts.error };
      return { artifacts: parsedArtifacts.data, error: null };
    } catch (error) {
      return { artifacts: null, error };
    }
  }

  async function saveArtifacts(sessionId: string, artifacts: AgentArtifacts, source: AgentWorkspaceArtifactSource) {
    const parsed = withUpdatedAt(artifacts);
    const updatedAt = parsed.updatedAt ?? new Date().toISOString();
    await fallbackStore.save(sessionId, parsed);
    await mutateWorkspace((workspace) => ({
      ...workspace,
      artifacts: upsertAgentWorkspaceArtifactRecord(workspace.artifacts, {
        schemaVersion: 1,
        projectId: getAgentWorkspaceProjectId(sessionId),
        sessionId,
        artifacts: parsed,
        updatedAt,
        source
      }),
      eventLog: appendAgentWorkspaceEventLog(
        workspace.eventLog,
        createAgentWorkspaceEvent({
          kind: "artifact.saved",
          sessionId,
          source,
          artifacts: parsed,
          message: createAgentArtifactSnapshot(parsed).available
            ? "Agent artifacts saved to project workspace."
            : "Empty Agent artifact state saved to project workspace."
        })
      )
    }));
    return parsed;
  }

  return {
    async load(sessionId) {
      const localRaw = readLocalWorkspaceRaw();
      const sharedRaw = await readSharedWorkspaceRaw();
      const localError = getArtifactParseError(localRaw, sessionId);
      const sharedError = getArtifactParseError(sharedRaw, sessionId);

      if (localError) {
        await appendEvent(sessionId, {
          kind: "artifact.restore_failed",
          source: "workspace-localStorage",
          message: "Failed to restore Agent artifacts from browser workspace cache.",
          error: localError
        });
      }

      if (sharedError) {
        await appendEvent(sessionId, {
          kind: "artifact.restore_failed",
          source: "workspace-api",
          message: "Failed to restore Agent artifacts from project workspace store.",
          error: sharedError
        });
      }

      const workspaceArtifacts = chooseWorkspaceArtifacts(
        sessionId,
        normalizeWorkspaceDraft(localRaw),
        normalizeWorkspaceDraft(sharedRaw)
      );

      if (workspaceArtifacts) {
        await fallbackStore.save(sessionId, workspaceArtifacts);
        await appendEvent(sessionId, {
          kind: "artifact.loaded",
          source: "workspace",
          artifacts: workspaceArtifacts,
          message: "Agent artifacts loaded from project workspace."
        });
        return workspaceArtifacts;
      }

      const legacyArtifacts = loadLegacyArtifacts(sessionId);
      if (legacyArtifacts.error) {
        await appendEvent(sessionId, {
          kind: "artifact.restore_failed",
          source: "legacy-local-artifact-store",
          message: "Failed to migrate Agent artifacts from legacy local artifact store.",
          error: legacyArtifacts.error
        });
      }

      if (legacyArtifacts.artifacts) {
        const migrated = await saveArtifacts(sessionId, legacyArtifacts.artifacts, "legacy-local-artifact-store");
        if (canUseLocalStorage()) {
          try {
            window.localStorage.removeItem(`${legacyStorageKeyPrefix}${sessionId}`);
          } catch {
            // Leaving a legacy copy behind is acceptable; workspace is now the restore path.
          }
        }
        await appendEvent(sessionId, {
          kind: "artifact.loaded",
          source: "legacy-local-artifact-store",
          artifacts: migrated,
          message: "Agent artifacts migrated from legacy local artifact store."
        });
        return migrated;
      }

      const emptyArtifacts = await fallbackStore.load(sessionId);
      await appendEvent(sessionId, {
        kind: "artifact.loaded",
        source: "workspace",
        artifacts: emptyArtifacts,
        message: "No persisted Agent artifacts found; using empty artifact state."
      });
      return emptyArtifacts;
    },
    async save(sessionId, artifacts) {
      return saveArtifacts(sessionId, artifacts, "workspace");
    },
    async patch(sessionId, patch) {
      const current = await this.load(sessionId);
      const nextArtifacts = mergeAgentArtifacts(current, patch);
      return this.save(sessionId, nextArtifacts);
    },
    async clear(sessionId) {
      await fallbackStore.clear(sessionId);
      await mutateWorkspace((workspace) => ({
        ...workspace,
        artifacts: workspace.artifacts.filter((record) => record.sessionId !== sessionId),
        eventLog: appendAgentWorkspaceEventLog(
          workspace.eventLog,
          createAgentWorkspaceEvent({
            kind: "artifact.saved",
            sessionId,
            source: "workspace",
            artifacts: createEmptyAgentArtifacts(),
            message: "Agent artifacts cleared from project workspace."
          })
        )
      }));
    },
    async recordRestoreFailure(sessionId, error, source = "workspace") {
      await appendEvent(sessionId, {
        kind: "artifact.restore_failed",
        source,
        message: "Agent artifact restore failed; falling back to empty or in-memory artifact state.",
        error
      });
    }
  };
}
