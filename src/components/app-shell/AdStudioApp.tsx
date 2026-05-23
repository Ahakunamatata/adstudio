"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AgentMode, AgentSession, AgentUploadedAsset, AppRoute, CanvasNode } from "@/lib/domain/schemas";
import type { AgentRuntimeState } from "@/features/workbench/agent-types";
import { getRouteFromPath, getRoutePath } from "@/lib/routes/routes";
import {
  mergeAgentWorkspaceCollections,
  normalizeAgentWorkspaceArtifactRecords,
  normalizeAgentWorkspaceEventLog,
  removeAgentWorkspaceSessionCollections,
  type AgentSessionRecord,
  type AgentWorkspaceCollections,
  type StoredAgentWorkspace
} from "@/lib/agent-workspace-model";
import { normalizeAgentProjectBundles, type AgentProjectBundle } from "@/lib/agent-project-store";
import {
  createInitialGenerationState,
  createMockGenerationSlotInput,
  defaultCreativeGoal,
  generationDefaults,
  getDefaultGenerationParamValues,
  getGenerationModel,
  templateMap
} from "@/lib/mock-data";
import { AgentSetupView } from "@/features/agent/AgentSetupView";
import { AgentView } from "@/features/agent/AgentView";
import { createAgentSession, createDemoAgentSession, normalizeAgentSession } from "@/features/agent/agent-session";
import { AssetsView } from "@/features/assets/AssetsView";
import { GenerationView } from "@/features/generation/GenerationView";
import type { GenerationDraft, GenerationKind, GenerationModeKey, GenerationSlotKey, GenerationState, GenerationTask, SingleGenerationState } from "@/features/generation/types";
import { HomeView } from "@/features/home/HomeView";
import { TemplatesView } from "@/features/templates/TemplatesView";
import { AgentWorkbenchView } from "@/features/workbench/AgentWorkbenchView";
import { AppShell } from "./AppShell";

type GenerationStateUpdater = SingleGenerationState | ((current: SingleGenerationState) => SingleGenerationState);

type AdStudioAppProps = {
  initialRoute?: AppRoute;
};

const generationStateStorageKey = "ad-studio:generation-state:v1";
const agentWorkspaceStorageKey = "ad-studio:agent-workspace:v2";
const legacyAgentWorkspaceStorageKey = "ad-studio:agent-workspace:v1";
const agentWorkspaceApiPath = "/api/agent/workspace";
const agentRuntimeStoragePrefix = "ad-studio:agent-runtime:chat-only:v1:";
const agentStartupPromptStoragePrefix = "ad-studio:agent-startup-prompt:v1:";
const legacyAgentArtifactStoragePrefix = "ad-studio:agent-artifacts:v1:";
const generationKinds = ["video", "image"] as const;

type LegacyStoredAgentWorkspace = {
  route: AppRoute;
  selectedProduct: string;
  setupMode: AgentMode;
  agentSession: AgentSession;
};

const templateSlotAliases: Partial<Record<string, GenerationSlotKey>> = {
  app_ui: "product_image",
  avatar_style: "reference_image",
  gameplay: "reference_video",
  old_way: "reference_video",
  new_way: "reference_video",
  product_image: "product_image",
  proof: "reference_image",
  style: "style_reference"
};

function getTemplateModelId(kind: GenerationKind, recommendedModel: string) {
  const catalog = generationDefaults[kind];
  return (
    catalog.models.find((model) => model.displayName === recommendedModel)?.id ??
    catalog.models.find((model) => recommendedModel.includes(model.displayName))?.id ??
    catalog.models.find((model) => model.defaultForKind)?.id ??
    catalog.models[0].id
  );
}

function getTemplateMode(kind: GenerationKind, slotKeys: GenerationSlotKey[]): GenerationModeKey {
  if (kind === "image") {
    return slotKeys.length ? "image-reference" : "text-to-image";
  }
  if (slotKeys.includes("reference_video") || slotKeys.includes("reference_image")) return "reference";
  if (slotKeys.includes("start_frame") || slotKeys.includes("end_frame")) return "first-last-frame";
  if (slotKeys.includes("product_image")) return "image-to-video";
  return "text-to-video";
}

function mapTemplateSlots(kind: GenerationKind, requiredSlots: string[]) {
  const supportedSlotKeys = new Set(generationDefaults[kind].slots.map((slot) => slot.key));
  const seen = new Set<GenerationSlotKey>();
  return requiredSlots.flatMap((slotId, index) => {
    const slotKey = (templateSlotAliases[slotId] ?? slotId) as GenerationSlotKey;
    if (seen.has(slotKey) || !supportedSlotKeys.has(slotKey)) return [];
    seen.add(slotKey);
    const slot = createMockGenerationSlotInput(kind, slotKey, index);
    return slot ? [slot] : [];
  });
}

function loadStoredGenerationState() {
  if (typeof window === "undefined") return null;

  try {
    const rawState = window.localStorage.getItem(generationStateStorageKey);
    if (!rawState) return null;
    const parsedState = JSON.parse(rawState) as Partial<GenerationState>;
    if (!parsedState.video || !parsedState.image) return null;
    return sanitizeGenerationState(parsedState as GenerationState);
  } catch {
    return null;
  }
}

function sanitizeAgentSessionForStorage(session: AgentSession): AgentSession {
  const normalizedSession = normalizeAgentSession(session);
  return {
    ...normalizedSession,
    uploadedAssets: normalizedSession.uploadedAssets.map((asset) => ({
      ...asset,
      previewUrl: asset.previewUrl?.startsWith("blob:") ? undefined : asset.previewUrl
    }))
  };
}

function hasTaskStartingUploadedAssets(session: AgentSession) {
  return session.uploadedAssets.some((asset) => asset.role === "competitor_asset" || asset.role === "reference_asset");
}

function hasMeaningfulCanvasState(session: AgentSession) {
  return Boolean((session.canvasState?.nodes.length ?? 0) > 0 || (session.canvasState?.edges.length ?? 0) > 0);
}

function hasMeaningfulProjectTitle(session: AgentSession) {
  const title = session.projectTitle?.trim();
  return Boolean(title && title !== "未命名项目");
}

function isPureBlankAgentSession(session: AgentSession) {
  return Boolean(
    session.projectKind === "blank" &&
    session.lifecycle === "empty" &&
    !hasMeaningfulProjectTitle(session) &&
    !session.product.trim() &&
    !session.competitor.trim() &&
    !session.creativeGoal.trim() &&
    !session.originalPrompt.trim() &&
    !session.uploadedAssets.length &&
    !hasMeaningfulCanvasState(session)
  );
}

function hasHistoryContent(session: AgentSession) {
  const creativeGoal = session.creativeGoal.trim();
  const hasTaskContent = Boolean(
    session.originalPrompt.trim() ||
    session.competitor.trim() ||
    (creativeGoal && creativeGoal !== defaultCreativeGoal) ||
    hasTaskStartingUploadedAssets(session)
  );

  return Boolean(
    session.projectKind === "demo" ||
    (hasMeaningfulProjectTitle(session) && hasTaskContent) ||
    hasTaskContent ||
    hasMeaningfulCanvasState(session)
  );
}

function getAgentSessionTitle(session: AgentSession) {
  return session.projectTitle?.trim() || "未命名项目";
}

function sanitizeAgentRuntimeForStorage(runtime: unknown) {
  return runtime;
}

function createAgentSessionRecord(
  session: AgentSession,
  updatedAt = new Date().toISOString(),
  runtime?: unknown
): AgentSessionRecord {
  const sanitizedSession = sanitizeAgentSessionForStorage(session);
  return {
    id: sanitizedSession.id,
    title: getAgentSessionTitle(sanitizedSession),
    product: sanitizedSession.product,
    mode: sanitizedSession.mode,
    updatedAt,
    session: sanitizedSession,
    runtime: sanitizeAgentRuntimeForStorage(runtime)
  };
}

function normalizeAgentSessionRecord(record: Partial<AgentSessionRecord> | null | undefined): AgentSessionRecord | null {
  if (!record?.session?.id) return null;
  return createAgentSessionRecord(record.session, record.updatedAt ?? new Date().toISOString(), record.runtime);
}

function compactAgentSessionRecords(records: AgentSessionRecord[], keepBlankSessionId?: string | null) {
  const compacted = new Map<string, AgentSessionRecord>();

  for (const record of records) {
    const normalizedRecord = normalizeAgentSessionRecord(record);
    if (!normalizedRecord) continue;
    const shouldKeepBlank = normalizedRecord.id === keepBlankSessionId && isPureBlankAgentSession(normalizedRecord.session);
    if (!shouldKeepBlank && !hasHistoryContent(normalizedRecord.session)) continue;

    const existing = compacted.get(normalizedRecord.id);
    if (!existing || Date.parse(normalizedRecord.updatedAt) > Date.parse(existing.updatedAt)) {
      compacted.set(normalizedRecord.id, normalizedRecord);
    }
  }

  return Array.from(compacted.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function upsertAgentSessionRecord(records: AgentSessionRecord[], session: AgentSession, runtime?: AgentRuntimeState) {
  const existingRecord = records.find((record) => record.id === session.id);
  const nextRecord = createAgentSessionRecord(session, new Date().toISOString(), runtime ?? existingRecord?.runtime);
  const remainingRecords = records.filter((record) => record.id !== session.id);
  const keepBlankSessionId = isPureBlankAgentSession(nextRecord.session) ? nextRecord.id : null;
  if (!keepBlankSessionId && !hasHistoryContent(nextRecord.session)) return compactAgentSessionRecords(remainingRecords);
  return compactAgentSessionRecords([nextRecord, ...remainingRecords], keepBlankSessionId);
}

function normalizeStoredAgentWorkspace(parsed: Partial<StoredAgentWorkspace> | null | undefined): StoredAgentWorkspace | null {
  if (!parsed?.route || typeof parsed.selectedProduct !== "string" || !parsed.setupMode || !Array.isArray(parsed.sessions)) return null;
  const sessions = compactAgentSessionRecords(
    parsed.sessions
      .map((record) => normalizeAgentSessionRecord(record))
      .filter((record): record is AgentSessionRecord => Boolean(record)),
    parsed.activeSessionId
  );
  return {
    route: parsed.route,
    selectedProduct: parsed.selectedProduct,
    setupMode: parsed.setupMode,
    activeSessionId: parsed.activeSessionId && sessions.some((record) => record.id === parsed.activeSessionId) ? parsed.activeSessionId : sessions[0]?.id ?? null,
    sessions,
    artifacts: normalizeAgentWorkspaceArtifactRecords(parsed.artifacts),
    eventLog: normalizeAgentWorkspaceEventLog(parsed.eventLog),
    projectBundles: normalizeAgentProjectBundles(parsed.projectBundles)
  };
}

function mergeStoredAgentWorkspaces(localWorkspace: StoredAgentWorkspace | null, sharedWorkspace: StoredAgentWorkspace | null): StoredAgentWorkspace | null {
  if (!localWorkspace && !sharedWorkspace) return null;
  const baseWorkspace = sharedWorkspace?.sessions.length
    ? sharedWorkspace
    : localWorkspace?.sessions.length
      ? localWorkspace
      : sharedWorkspace ?? localWorkspace;
  if (!baseWorkspace) return null;

  const collections = mergeAgentWorkspaceCollections(
    localWorkspace ?? { artifacts: [], eventLog: [] },
    sharedWorkspace ?? { artifacts: [], eventLog: [] }
  );

  return {
    ...baseWorkspace,
    ...collections,
    projectBundles: normalizeAgentProjectBundles([
      ...(localWorkspace?.projectBundles ?? []),
      ...(sharedWorkspace?.projectBundles ?? [])
    ])
  };
}

function loadStoredAgentWorkspace(): StoredAgentWorkspace | null {
  if (typeof window === "undefined") return null;

  try {
    const rawState = window.localStorage.getItem(agentWorkspaceStorageKey);
    if (rawState) {
      return normalizeStoredAgentWorkspace(JSON.parse(rawState) as Partial<StoredAgentWorkspace>);
    }

    const legacyRawState = window.localStorage.getItem(legacyAgentWorkspaceStorageKey);
    if (!legacyRawState) return null;
    const parsedLegacy = JSON.parse(legacyRawState) as Partial<LegacyStoredAgentWorkspace>;
    if (!parsedLegacy.route || !parsedLegacy.selectedProduct || !parsedLegacy.setupMode || !parsedLegacy.agentSession?.id) return null;
    const migratedRecord = createAgentSessionRecord(parsedLegacy.agentSession);
    const sessions = compactAgentSessionRecords([migratedRecord]);
    return {
      route: parsedLegacy.route,
      selectedProduct: parsedLegacy.selectedProduct,
      setupMode: parsedLegacy.setupMode,
      activeSessionId: sessions[0]?.id ?? null,
      sessions,
      artifacts: [],
      eventLog: []
    };
  } catch {
    return null;
  }
}

async function loadSharedAgentWorkspace(): Promise<StoredAgentWorkspace | null> {
  try {
    const response = await fetch(agentWorkspaceApiPath, { cache: "no-store" });
    if (!response.ok) return null;
    return normalizeStoredAgentWorkspace(await response.json() as Partial<StoredAgentWorkspace>);
  } catch {
    return null;
  }
}

function readStoredAgentWorkspaceCollections(): AgentWorkspaceCollections {
  if (typeof window === "undefined") return { artifacts: [], eventLog: [] };

  try {
    const rawState = window.localStorage.getItem(agentWorkspaceStorageKey);
    if (!rawState) return { artifacts: [], eventLog: [] };
    const parsed = JSON.parse(rawState) as Partial<StoredAgentWorkspace>;
    return {
      artifacts: normalizeAgentWorkspaceArtifactRecords(parsed.artifacts),
      eventLog: normalizeAgentWorkspaceEventLog(parsed.eventLog)
    };
  } catch {
    return { artifacts: [], eventLog: [] };
  }
}

function readStoredAgentProjectBundles(): AgentProjectBundle[] {
  if (typeof window === "undefined") return [];

  try {
    const rawState = window.localStorage.getItem(agentWorkspaceStorageKey);
    if (!rawState) return [];
    const parsed = JSON.parse(rawState) as Partial<StoredAgentWorkspace>;
    return normalizeAgentProjectBundles(parsed.projectBundles);
  } catch {
    return [];
  }
}

function getPersistableAgentWorkspace(state: StoredAgentWorkspace): StoredAgentWorkspace {
  const sessions = compactAgentSessionRecords(state.sessions, state.activeSessionId);
  const collections = {
    artifacts: normalizeAgentWorkspaceArtifactRecords(state.artifacts),
    eventLog: normalizeAgentWorkspaceEventLog(state.eventLog)
  };
  const projectBundles = normalizeAgentProjectBundles(state.projectBundles);

  return {
    ...state,
    activeSessionId: sessions.some((record) => record.id === state.activeSessionId) ? state.activeSessionId : sessions[0]?.id ?? null,
    sessions: sessions.map((record) => ({
      ...record,
      session: sanitizeAgentSessionForStorage(record.session),
      runtime: sanitizeAgentRuntimeForStorage(record.runtime)
    })),
    ...collections,
    projectBundles
  };
}

function storeAgentWorkspace(state: StoredAgentWorkspace) {
  try {
    window.localStorage.setItem(agentWorkspaceStorageKey, JSON.stringify(getPersistableAgentWorkspace(state)));
  } catch {
    // Ignore storage failures; the in-memory Agent session remains usable.
  }
}

async function storeSharedAgentWorkspace(state: StoredAgentWorkspace) {
  try {
    await fetch(agentWorkspaceApiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(getPersistableAgentWorkspace(state))
    });
  } catch {
    // Keep browser-local persistence usable if the local API is unavailable.
  }
}

async function deleteSharedAgentWorkspaceSession(sessionId: string) {
  try {
    await fetch(`${agentWorkspaceApiPath}?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {
    // The local state deletion still succeeds; the next successful save will resync.
  }
}

function removeStoredAgentRuntime(sessionId: string) {
  try {
    window.localStorage.removeItem(`${agentRuntimeStoragePrefix}${sessionId}`);
    window.sessionStorage.removeItem(`${agentStartupPromptStoragePrefix}${sessionId}`);
    window.localStorage.removeItem(`${legacyAgentArtifactStoragePrefix}${sessionId}`);
  } catch {
    // Ignore storage failures; the session list deletion still succeeds in memory.
  }
}

function storeAgentStartupPrompt(sessionId: string, prompt: string) {
  try {
    window.sessionStorage.setItem(`${agentStartupPromptStoragePrefix}${sessionId}`, prompt);
  } catch {
    // The in-memory startup prompt still covers same-page navigation.
  }
}

function removeStoredAgentWorkspaceSessionCollections(sessionId: string) {
  try {
    const workspace = loadStoredAgentWorkspace();
    if (!workspace) return;
    const collections = removeAgentWorkspaceSessionCollections(workspace, sessionId);
    window.localStorage.setItem(
      agentWorkspaceStorageKey,
      JSON.stringify({
        ...workspace,
        ...collections,
        projectBundles: (workspace.projectBundles ?? []).filter((bundle) => {
          const hadSession = bundle.sessions.some((record) => record.id === sessionId) || bundle.project.activeSessionId === sessionId;
          return !hadSession;
        })
      })
    );
  } catch {
    // Keep session deletion usable even if cache cleanup fails.
  }
}

function storeGenerationState(state: GenerationState) {
  try {
    window.localStorage.setItem(generationStateStorageKey, JSON.stringify(state));
  } catch {
    // Ignore storage failures so generation remains usable in private or quota-limited sessions.
  }
}

function generationTaskKey(task: GenerationTask) {
  return task.providerTaskId ? `provider:${task.providerTaskId}` : `local:${task.id}`;
}

function isViduTask(task: GenerationTask) {
  return Boolean(task.providerTaskId) || task.modelId.startsWith("vidu");
}

function sanitizeGenerationState(state: GenerationState): GenerationState {
  return {
    ...state,
    video: {
      ...state.video,
      history: state.video.history.filter(isViduTask)
    },
    image: {
      ...state.image,
      history: state.image.history.filter(isViduTask)
    }
  };
}

function mergeGenerationTasks(currentTasks: GenerationTask[], incomingTasks: GenerationTask[]) {
  const merged = new Map<string, GenerationTask>();
  for (const task of currentTasks) {
    merged.set(generationTaskKey(task), task);
  }
  for (const task of incomingTasks) {
    const existing = merged.get(generationTaskKey(task));
    merged.set(generationTaskKey(task), existing ? { ...existing, ...task, output: { ...existing.output, ...task.output } } : task);
  }
  return Array.from(merged.values());
}

function mergeGenerationStateHistory(current: GenerationState, incoming: Partial<Record<GenerationKind, GenerationTask[]>>) {
  let nextState = current;
  for (const kind of generationKinds) {
    const incomingTasks = incoming[kind];
    if (!incomingTasks?.length) continue;
    nextState = {
      ...nextState,
      [kind]: {
        ...nextState[kind],
        history: mergeGenerationTasks(nextState[kind].history, incomingTasks)
      }
    };
  }
  return nextState;
}

function getPersistableViduHistory(state: GenerationState) {
  return {
    video: state.video.history.filter(isViduTask),
    image: state.image.history.filter(isViduTask)
  };
}

export function AdStudioApp({ initialRoute = "home" }: AdStudioAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [setupMode, setSetupMode] = useState<AgentMode>("clone");
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<string | null>(null);
  const [agentSessionRecords, setAgentSessionRecords] = useState<AgentSessionRecord[]>([]);
  const [agentSession, setAgentSession] = useState<AgentSession>(
    () => createAgentSession("clone", "", "", [], "blank", "agent-initial-session")
  );
  const [agentStartupPrompts, setAgentStartupPrompts] = useState<Record<string, string>>({});
  const [agentWorkspaceHydrated, setAgentWorkspaceHydrated] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationState>(() => createInitialGenerationState());
  const [generationAutoSubmit, setGenerationAutoSubmit] = useState<{ kind: GenerationKind; token: number } | null>(null);
  const [drawerNode, setDrawerNode] = useState<CanvasNode | null>(null);
  const [toastText, setToastText] = useState("已套用模板");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const generationStateHydrated = useRef(false);
  const generationAutoSubmitToken = useRef(0);
  const agentWorkspaceCollectionsRef = useRef<AgentWorkspaceCollections>({ artifacts: [], eventLog: [] });
  const agentProjectBundlesRef = useRef<AgentProjectBundle[]>([]);
  const agentWorkspaceTouchedBeforeHydrationRef = useRef(false);

  function showToast(text: string) {
    setToastText(text);
    setToastVisible(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), 1800);
  }

  function getCurrentWorkspaceCollections() {
    const collections = mergeAgentWorkspaceCollections(agentWorkspaceCollectionsRef.current, readStoredAgentWorkspaceCollections());
    agentWorkspaceCollectionsRef.current = collections;
    return collections;
  }

  function goRoute(nextRoute: AppRoute) {
    setRoute(nextRoute);
    const nextPath = getRoutePath(nextRoute);
    if (pathname !== nextPath) {
      router.push(nextPath, { scroll: false });
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function activateAgentSession(session: AgentSession) {
    const startedBeforeHydration = !agentWorkspaceHydrated;
    if (startedBeforeHydration) agentWorkspaceTouchedBeforeHydrationRef.current = true;
    setSetupMode(session.mode);
    setSelectedProduct(session.product);
    setActiveAgentSessionId(session.id);
    setAgentSession(session);
    setAgentSessionRecords((current) => upsertAgentSessionRecord(current, session));
    goRoute("workbench");
    if (startedBeforeHydration) {
      window.setTimeout(() => goRoute("workbench"), 0);
    }
  }

  function updateActiveAgentSession(session: AgentSession, runtime?: AgentRuntimeState) {
    setSetupMode(session.mode);
    setSelectedProduct(session.product);
    setActiveAgentSessionId(session.id);
    setAgentSession(session);
    setAgentSessionRecords((current) => upsertAgentSessionRecord(current, session, runtime));
  }

  function startAgent(mode: AgentMode, prompt = "", uploadedAssets?: AgentUploadedAsset[]) {
    const productName = uploadedAssets?.find((asset) => asset.role === "product_pack")?.name ?? "";
    const session = createAgentSession(mode, productName, "", uploadedAssets ?? []);
    const startupPrompt = prompt.trim();
    if (startupPrompt) {
      storeAgentStartupPrompt(session.id, startupPrompt);
      setAgentStartupPrompts((current) => ({
        ...current,
        [session.id]: startupPrompt
      }));
    }
    activateAgentSession(session);
  }

  function openDemoAgentProject() {
    activateAgentSession(createDemoAgentSession());
  }

  function startBlankAgentSession() {
    activateAgentSession(createAgentSession(setupMode, "", "", []));
  }

  function consumeAgentStartupPrompt(sessionId: string) {
    setAgentStartupPrompts((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  function resumeAgentSession(sessionId: string) {
    const record = agentSessionRecords.find((item) => item.id === sessionId);
    if (!record) return;
    activateAgentSession(record.session);
  }

  function deleteAgentSession(sessionId: string) {
    removeStoredAgentRuntime(sessionId);
    removeStoredAgentWorkspaceSessionCollections(sessionId);
    agentWorkspaceCollectionsRef.current = removeAgentWorkspaceSessionCollections(agentWorkspaceCollectionsRef.current, sessionId);
    void deleteSharedAgentWorkspaceSession(sessionId);
    setAgentSessionRecords((current) => current.filter((record) => record.id !== sessionId));
    setActiveAgentSessionId((current) => (current === sessionId ? null : current));
  }

  function startGeneration(kind: GenerationKind, draft: GenerationDraft) {
    generationAutoSubmitToken.current += 1;
    setGenerationState((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        ...draft,
        paramValues: {
          ...current[kind].paramValues,
          ...draft.paramValues
        }
      }
    }));
    setGenerationAutoSubmit({ kind, token: generationAutoSubmitToken.current });
    goRoute(kind);
  }

  function handleGenerationAutoSubmitHandled(kind: GenerationKind, token: number) {
    setGenerationAutoSubmit((current) => (current?.kind === kind && current.token === token ? null : current));
  }

  function startWorkbench(session: AgentSession) {
    activateAgentSession(session);
  }

  function applyTemplate(templateId: string) {
    const template = templateMap[templateId];
    if (!template) return;
    const modelId = getTemplateModelId(template.route, template.recommendedModel);
    const model = getGenerationModel(template.route, modelId);
    const slots = mapTemplateSlots(template.route, template.requiredSlots);
    const modeKey = getTemplateMode(template.route, slots.map((slot) => slot.slotKey));
    setGenerationState((current) => ({
      ...current,
      [template.route]: {
        ...current[template.route],
        prompt: template.prompt,
        modelId,
        modeKey: model.modeKeys.includes(modeKey) ? modeKey : model.defaultModeKey,
        paramValues: {
          ...getDefaultGenerationParamValues(model),
          ratio: template.defaultRatio,
          ...(template.defaultDuration ? { duration: template.defaultDuration } : {})
        },
        slots
      }
    }));
    goRoute(template.route);
    showToast(template.toast);
  }

  function updateGeneration(kind: GenerationKind, nextState: GenerationStateUpdater) {
    setGenerationState((current) => ({
      ...current,
      [kind]: typeof nextState === "function" ? nextState(current[kind]) : nextState
    }));
  }

  useEffect(() => {
    let cancelled = false;
    const restoreTimer = window.setTimeout(() => {
      void (async () => {
        const storedWorkspace = mergeStoredAgentWorkspaces(loadStoredAgentWorkspace(), await loadSharedAgentWorkspace());
        if (cancelled) return;
        if (agentWorkspaceTouchedBeforeHydrationRef.current) {
          setAgentWorkspaceHydrated(true);
          return;
        }
        if (storedWorkspace) {
          agentWorkspaceCollectionsRef.current = {
            artifacts: storedWorkspace.artifacts,
            eventLog: storedWorkspace.eventLog
          };
          agentProjectBundlesRef.current = normalizeAgentProjectBundles(storedWorkspace.projectBundles);
          const storedSession =
            storedWorkspace.sessions.find((record) => record.id === storedWorkspace.activeSessionId)?.session ??
            storedWorkspace.sessions[0]?.session ??
            null;
          setRoute(getRouteFromPath(window.location.pathname) ?? storedWorkspace.route);
          setSelectedProduct(storedWorkspace.selectedProduct ?? storedSession?.product ?? "");
          setSetupMode(storedWorkspace.setupMode);
          setActiveAgentSessionId(storedSession?.id ?? null);
          setAgentSessionRecords(storedWorkspace.sessions);
          if (storedSession) setAgentSession(storedSession);
        }
        setAgentWorkspaceHydrated(true);
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => {
    if (!agentWorkspaceHydrated) return;
    const collections = getCurrentWorkspaceCollections();
    const projectBundles = normalizeAgentProjectBundles([
      ...agentProjectBundlesRef.current,
      ...readStoredAgentProjectBundles()
    ]);
    agentProjectBundlesRef.current = projectBundles;
    const workspace = {
      route,
      selectedProduct,
      setupMode,
      activeSessionId: activeAgentSessionId,
      sessions: agentSessionRecords,
      ...collections,
      projectBundles
    };
    storeAgentWorkspace(workspace);
    void storeSharedAgentWorkspace(workspace);
  }, [activeAgentSessionId, agentSessionRecords, agentWorkspaceHydrated, route, selectedProduct, setupMode]);

  useEffect(() => {
    const storedGenerationState = loadStoredGenerationState();
    if (!storedGenerationState) {
      generationStateHydrated.current = true;
      return undefined;
    }

    const restoreTimer = window.setTimeout(() => {
      generationStateHydrated.current = true;
      setGenerationState(storedGenerationState);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!generationStateHydrated.current) return;
    storeGenerationState(generationState);

    const viduHistory = getPersistableViduHistory(generationState);
    if (!viduHistory.video.length && !viduHistory.image.length) return;

    const controller = new AbortController();
    void fetch("/api/vidu/history", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(viduHistory),
      signal: controller.signal
    }).catch(() => undefined);

    return () => controller.abort();
  }, [generationState]);

  useEffect(() => {
    let cancelled = false;
    const historyTimer = window.setTimeout(() => {
      void fetch("/api/vidu/history", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((history: Partial<Record<GenerationKind, GenerationTask[]>> | null) => {
          if (cancelled || !history) return;
          setGenerationState((current) => mergeGenerationStateHistory(current, history));
        })
        .catch(() => undefined);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(historyTimer);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <AppShell
      route={route}
      drawerNode={drawerNode}
      toastText={toastText}
      toastVisible={toastVisible}
      onRouteChange={goRoute}
      onCloseDrawer={() => setDrawerNode(null)}
    >
      <HomeView
        active={route === "home"}
        ready={agentWorkspaceHydrated}
        onRouteChange={goRoute}
        onStartAgent={startAgent}
        onStartGeneration={startGeneration}
        onUseTemplate={applyTemplate}
        onOpenDemoAgent={openDemoAgentProject}
      />
      <AgentView
        active={route === "agent"}
        ready={agentWorkspaceHydrated}
        sessionHistory={agentSessionRecords}
        onRouteChange={goRoute}
        onStartAgent={startAgent}
        onResumeSession={resumeAgentSession}
        onDeleteSession={deleteAgentSession}
      />
      <AgentSetupView
        active={route === "agent-setup"}
        mode={setupMode}
        selectedProduct={selectedProduct}
        onProductChange={setSelectedProduct}
        onCancel={() => goRoute("agent")}
        onStartWorkbench={startWorkbench}
      />
      <AgentWorkbenchView
        key={agentSession.id}
        active={route === "workbench"}
        session={agentSession}
        startupPrompt={agentStartupPrompts[agentSession.id] ?? ""}
        activeSessionId={activeAgentSessionId}
        sessionHistory={agentSessionRecords}
        onSessionChange={updateActiveAgentSession}
        onNewSession={startBlankAgentSession}
        onResumeSession={resumeAgentSession}
        onStartupPromptConsumed={consumeAgentStartupPrompt}
        onNodeOpen={setDrawerNode}
      />
      <GenerationView
        active={route === "video"}
        kind="video"
        state={generationState.video}
        autoSubmitToken={generationAutoSubmit?.kind === "video" ? generationAutoSubmit.token : null}
        onStateChange={updateGeneration}
        onRouteChange={goRoute}
        onToast={showToast}
        onAutoSubmitHandled={handleGenerationAutoSubmitHandled}
      />
      <GenerationView
        active={route === "image"}
        kind="image"
        state={generationState.image}
        autoSubmitToken={generationAutoSubmit?.kind === "image" ? generationAutoSubmit.token : null}
        onStateChange={updateGeneration}
        onRouteChange={goRoute}
        onToast={showToast}
        onAutoSubmitHandled={handleGenerationAutoSubmitHandled}
      />
      <TemplatesView active={route === "templates"} onUseTemplate={applyTemplate} />
      <AssetsView active={route === "assets"} onStartAgent={startAgent} />
    </AppShell>
  );
}
