import {
  applyAgentProjectPatch,
  createAgentEventRecord,
  normalizeAgentProjectBundle,
  updateAgentProjectBundleApprovalStatus,
  type AgentProjectBundle,
  type AgentProjectPatch,
  type AgentProjectStore,
  type CreateAgentEventInput,
  type UpdateApprovalStatusInput
} from "@/lib/agent-project-store";

type FetchLike = typeof fetch;

type SupabaseProjectStoreEnv = Record<string, string | undefined> & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  AD_STUDIO_AGENT_PROJECT_STORE?: string;
  AD_STUDIO_AGENT_PROJECT_STORE_REQUIRED?: string;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shouldUseSupabaseStore(env: SupabaseProjectStoreEnv) {
  const mode = env.AD_STUDIO_AGENT_PROJECT_STORE?.trim().toLowerCase();
  if (mode === "json" || mode === "local" || mode === "off" || mode === "disabled") return false;
  if (mode === "supabase" || mode === "db" || mode === "postgres") return true;
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function isSupabaseProjectStoreRequired(env: SupabaseProjectStoreEnv = process.env) {
  const value = env.AD_STUDIO_AGENT_PROJECT_STORE_REQUIRED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function createFullBundlePatch(bundle: AgentProjectBundle): AgentProjectPatch {
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

async function responseMessage(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return `${response.status} ${response.statusText}`;
  try {
    const data = JSON.parse(text) as unknown;
    if (isRecord(data)) {
      const message = data.message ?? data.error ?? data.details;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    return text.trim();
  }
  return text.trim();
}

export function createSupabaseAgentProjectStore(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: FetchLike;
}): AgentProjectStore {
  const supabaseUrl = trimTrailingSlash(options.supabaseUrl);
  const serviceRoleKey = options.serviceRoleKey;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Supabase project store RPC failed (${name}): ${await responseMessage(response)}`);
    }
    return response.json() as Promise<T>;
  }

  async function upsertBundle(bundle: AgentProjectBundle) {
    const rawBundle = await rpc<unknown>("ad_studio_upsert_agent_project_bundle", { p_bundle: bundle });
    const normalized = normalizeAgentProjectBundle(rawBundle, bundle.project.id);
    if (!normalized) throw new Error("Supabase project store returned an invalid project bundle.");
    return normalized;
  }

  return {
    async loadProject(projectId) {
      const rawBundle = await rpc<unknown>("ad_studio_get_agent_project_bundle", { p_project_id: projectId });
      if (!rawBundle) return null;
      return normalizeAgentProjectBundle(rawBundle, projectId);
    },
    async saveProjectPatch(projectId, patch) {
      const current = await this.loadProject(projectId);
      return upsertBundle(applyAgentProjectPatch(projectId, current, patch));
    },
    async archiveProject(projectId) {
      const current = await this.loadProject(projectId);
      if (!current) return;
      const now = new Date().toISOString();
      await upsertBundle(applyAgentProjectPatch(projectId, current, {
        project: {
          ...current.project,
          lifecycle: "archived",
          archivedAt: now,
          updatedAt: now
        },
        updatedAt: now,
        events: [
          {
            projectId,
            actorType: "system",
            eventType: "project.archived",
            objectType: "project",
            objectId: projectId,
            payload: {}
          }
        ]
      }));
    },
    async updateApprovalStatus(input: UpdateApprovalStatusInput) {
      const current = await this.loadProject(input.projectId);
      if (!current) throw new Error(`Agent project not found: ${input.projectId}.`);
      const bundle = await upsertBundle(updateAgentProjectBundleApprovalStatus(current, input));
      const approval = bundle.approvalRequests.find((record) => record.id === input.approvalRequestId);
      if (!approval) throw new Error(`Approval request not found after update: ${input.approvalRequestId}.`);
      return approval;
    },
    async appendEvent(event: CreateAgentEventInput) {
      const current = await this.loadProject(event.projectId);
      if (!current) throw new Error(`Agent project not found: ${event.projectId}.`);
      const nextEvent = createAgentEventRecord(event, event.projectId, 0);
      const rawEvent = await rpc<unknown>("ad_studio_append_agent_event", { p_event: nextEvent });
      const bundle = await this.loadProject(event.projectId);
      const normalizedEvent = bundle?.events.find((record) => record.id === (isRecord(rawEvent) ? rawEvent.id : nextEvent.id));
      if (!normalizedEvent) throw new Error("Supabase project store returned an invalid event append result.");
      return normalizedEvent;
    }
  };
}

export function createSupabaseAgentProjectStoreFromEnv(env: SupabaseProjectStoreEnv = process.env): AgentProjectStore | undefined {
  if (!shouldUseSupabaseStore(env)) return undefined;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    if (isSupabaseProjectStoreRequired(env)) {
      throw new Error("Supabase project store requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    return undefined;
  }
  return createSupabaseAgentProjectStore({ supabaseUrl, serviceRoleKey });
}

export function createFallbackAgentProjectStore(primary: AgentProjectStore | undefined, fallback: AgentProjectStore, options?: {
  required?: boolean;
}): AgentProjectStore {
  const required = options?.required === true;

  async function runPrimary<T>(operation: (store: AgentProjectStore) => Promise<T>) {
    if (!primary) return undefined;
    try {
      return await operation(primary);
    } catch (error) {
      if (required) throw error;
      return undefined;
    }
  }

  async function seedPrimaryFromFallback(projectId: string) {
    if (!primary) return;
    const primaryBundle = await runPrimary((store) => store.loadProject(projectId));
    if (primaryBundle) return;
    const fallbackBundle = await fallback.loadProject(projectId);
    if (!fallbackBundle) return;
    await runPrimary((store) => store.saveProjectPatch(projectId, createFullBundlePatch(fallbackBundle)));
  }

  return {
    async loadProject(projectId) {
      const primaryBundle = await runPrimary((store) => store.loadProject(projectId));
      if (primaryBundle) return primaryBundle;
      return fallback.loadProject(projectId);
    },
    async saveProjectPatch(projectId, patch) {
      await seedPrimaryFromFallback(projectId).catch((error) => {
        if (required) throw error;
      });
      const primaryBundle = await runPrimary((store) => store.saveProjectPatch(projectId, patch));
      if (primaryBundle) return primaryBundle;
      return fallback.saveProjectPatch(projectId, patch);
    },
    async archiveProject(projectId) {
      const archived = await runPrimary((store) => store.archiveProject(projectId));
      if (archived !== undefined) return;
      return fallback.archiveProject(projectId);
    },
    async updateApprovalStatus(input) {
      await seedPrimaryFromFallback(input.projectId).catch((error) => {
        if (required) throw error;
      });
      const approval = await runPrimary((store) => store.updateApprovalStatus(input));
      if (approval) return approval;
      return fallback.updateApprovalStatus(input);
    },
    async appendEvent(event) {
      await seedPrimaryFromFallback(event.projectId).catch((error) => {
        if (required) throw error;
      });
      const appended = await runPrimary((store) => store.appendEvent(event));
      if (appended) return appended;
      return fallback.appendEvent(event);
    }
  };
}

export function getAgentProjectStoreErrorMessage(error: unknown) {
  return getErrorMessage(error);
}
