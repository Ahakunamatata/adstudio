import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = 3030 + Math.floor(Math.random() * 300);
const configuredBaseUrl = process.env.M57_ACCEPTANCE_BASE_URL ?? `http://127.0.0.1:${defaultPort}/`;
const origin = new URL(configuredBaseUrl).origin;
const port = new URL(configuredBaseUrl).port || "3030";
const confirmValue = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";

let startedServer = null;
let fixtureServer = null;
let fixtureOrigin = "";

const fixtureState = {
  dbBundleUpserts: 0,
  dbBundleReads: 0,
  dbEventAppends: 0,
  viduCreates: 0,
  viduPolls: 0,
  outputDownloads: 0,
  storageUploads: [],
  bundles: new Map()
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readBody(request);
  if (!body.byteLength) return {};
  return JSON.parse(body.toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function media(response) {
  const bytes = Buffer.from("m57 fixture mp4 bytes");
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": String(bytes.byteLength)
  });
  response.end(bytes);
}

function normalizeBundle(bundle) {
  return {
    schemaVersion: 1,
    sessions: [],
    artifacts: [],
    approvalRequests: [],
    generationTasks: [],
    mediaAssets: [],
    events: [],
    ...bundle,
    canvasGraph: bundle.canvasGraph ?? {
      schemaVersion: 1,
      projectId: bundle.project.id,
      nodes: [],
      edges: [],
      graphVersion: `graph-${bundle.updatedAt}`,
      updatedAt: bundle.updatedAt
    }
  };
}

function upsertBundle(bundle) {
  const normalized = normalizeBundle(bundle);
  fixtureState.bundles.set(normalized.project.id, normalized);
  return normalized;
}

function appendEvent(event) {
  const projectId = event.projectId;
  const current = fixtureState.bundles.get(projectId);
  assert(current, `DB fixture cannot append event for missing project ${projectId}`);
  const sequence = Math.max(0, ...current.events.map((item) => item.sequence ?? 0)) + 1;
  const createdAt = event.createdAt ?? new Date().toISOString();
  const record = {
    schemaVersion: 1,
    id: event.id ?? `event-m57-${sequence}`,
    ...event,
    projectId,
    sequence,
    createdAt
  };
  current.events = [...current.events, record];
  current.updatedAt = createdAt;
  current.project = { ...current.project, updatedAt: createdAt };
  fixtureState.bundles.set(projectId, current);
  return record;
}

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "POST" && requestUrl.pathname === "/text2video") {
        fixtureState.viduCreates += 1;
        await readBody(request);
        json(response, 200, {
          task_id: `vidu-m57-${fixtureState.viduCreates}`,
          state: "created",
          credits: 0
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname.startsWith("/tasks/") && requestUrl.pathname.endsWith("/creations")) {
        fixtureState.viduPolls += 1;
        const taskId = requestUrl.pathname.split("/")[2];
        json(response, 200, {
          id: taskId,
          state: "success",
          progress: 100,
          credits: 55,
          creations: [
            {
              id: `creation-${taskId}`,
              url: `${fixtureOrigin}/provider-output.mp4`,
              cover_url: `${fixtureOrigin}/provider-cover.png`
            }
          ]
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/provider-output.mp4") {
        fixtureState.outputDownloads += 1;
        media(response);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname.startsWith("/storage/v1/object/ad-studio-media/")) {
        const body = await readBody(request);
        const key = decodeURIComponent(requestUrl.pathname.replace("/storage/v1/object/ad-studio-media/", ""));
        fixtureState.storageUploads.push({
          key,
          byteSize: body.byteLength,
          authorization: request.headers.authorization,
          apikey: request.headers.apikey,
          contentType: request.headers["content-type"],
          upsert: request.headers["x-upsert"]
        });
        json(response, 200, { Key: key });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname.startsWith("/storage/v1/object/public/ad-studio-media/")) {
        media(response);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/ad_studio_upsert_agent_project_bundle") {
        fixtureState.dbBundleUpserts += 1;
        const body = await readJsonBody(request);
        const bundle = body.p_bundle ?? body.bundle;
        assert(bundle?.project?.id, "DB fixture received invalid bundle upsert");
        json(response, 200, upsertBundle(bundle));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/ad_studio_get_agent_project_bundle") {
        fixtureState.dbBundleReads += 1;
        const body = await readJsonBody(request);
        const projectId = body.p_project_id ?? body.project_id;
        json(response, 200, fixtureState.bundles.get(projectId) ?? null);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/ad_studio_append_agent_event") {
        fixtureState.dbEventAppends += 1;
        const body = await readJsonBody(request);
        json(response, 200, appendEvent(body.p_event ?? body.event));
        return;
      }

      json(response, 404, { message: `Unhandled fixture route: ${request.method} ${requestUrl.pathname}` });
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function waitFor(fn, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function isServerReady() {
  try {
    const response = await fetch(origin, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  startedServer = spawn("corepack", ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", port], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AD_STUDIO_AGENT_PROJECT_STORE: "supabase",
      AD_STUDIO_AGENT_PROJECT_STORE_REQUIRED: "1",
      AD_STUDIO_M54_ENABLE_REAL_VIDU_WORKBENCH: "1",
      AD_STUDIO_M54_CONFIRM_REAL_VIDU_WORKBENCH: confirmValue,
      VIDU_API_KEY: "m57-fixture-vidu-key",
      VIDU_API_BASE_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
      SUPABASE_SERVICE_ROLE_KEY: "m57-fixture-service-role",
      SUPABASE_MEDIA_BUCKET: "ad-studio-media"
    }
  });

  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M57_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M57_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function generationRequest() {
  return {
    kind: "video",
    surface: "agent",
    modelId: "viduq3-turbo",
    modelName: "Vidu Q3 Turbo",
    modeKey: "text-to-video",
    prompt: "Create a 5 second vertical mobile app ad for M5.7 project store acceptance.",
    params: {
      ratio: "9:16",
      duration: "5s",
      resolution: "720p"
    },
    slots: []
  };
}

function createWorkspace(projectId, approvalId, actionHash, idempotencyKey) {
  const now = new Date().toISOString();
  return {
    route: "workbench",
    selectedProduct: "Family Locator",
    setupMode: "clone",
    activeSessionId: projectId,
    sessions: [
      {
        id: projectId,
        title: "M5.7 DB Store Acceptance",
        product: "Family Locator",
        mode: "clone",
        updatedAt: now,
        session: {
          id: projectId,
          projectTitle: "M5.7 DB Store Acceptance",
          projectKind: "blank",
          lifecycle: "ready",
          mode: "clone",
          currentStepIndex: 0,
          locked: false,
          product: "Family Locator",
          competitor: "",
          focus: [],
          creativeGoal: "M5.7 DB store acceptance",
          specs: { language: "", channel: "", ratio: "9:16", duration: "5s" },
          originalPrompt: "M5.7 DB store acceptance",
          uploadedAssets: [],
          canvasState: { nodes: [], edges: [] },
          createdAt: now,
          updatedAt: now
        },
        runtime: {
          stage: "ready",
          messages: [
            {
              id: "m57-user-message",
              role: "user",
              body: "请生成一条广告视频。",
              createdAt: now,
              events: []
            }
          ]
        }
      }
    ],
    artifacts: [],
    eventLog: [],
    projectBundles: [
      {
        schemaVersion: 1,
        project: {
          schemaVersion: 1,
          id: projectId,
          title: "M5.7 DB Store Acceptance",
          productName: "Family Locator",
          mode: "clone",
          lifecycle: "ready",
          activeSessionId: projectId,
          createdAt: now,
          updatedAt: now
        },
        sessions: [
          {
            schemaVersion: 1,
            id: projectId,
            projectId,
            session: {
              id: projectId,
              projectTitle: "M5.7 DB Store Acceptance",
              lifecycle: "ready",
              mode: "clone",
              product: "Family Locator",
              createdAt: now,
              updatedAt: now
            },
            runtimeSummary: {
              stage: "ready",
              messageCount: 1,
              pendingApprovalId: approvalId,
              artifactSummaryCount: 1
            },
            createdAt: now,
            updatedAt: now
          }
        ],
        artifacts: [
          {
            schemaVersion: 1,
            id: "artifact-m57-prompt-pack",
            projectId,
            sessionId: projectId,
            artifactType: "promptPack",
            artifactKey: "prompt-pack",
            status: "confirmed",
            source: "user_confirmation",
            version: 1,
            body: { prompt: "M5.7 accepted prompt pack" },
            summary: {
              kind: "promptPack",
              id: "artifact-m57-prompt-pack",
              source: "user_confirmation",
              status: "confirmed",
              title: "Prompt Pack",
              summary: "Approved prompt pack for M5.7.",
              factRefs: [],
              modelSuggestionRefs: [],
              needsUserConfirmation: false,
              userConfirmationFields: []
            },
            evidenceRefs: [],
            linkedNodeIds: [],
            linkedTaskIds: [],
            createdAt: now,
            updatedAt: now
          }
        ],
        approvalRequests: [
          {
            schemaVersion: 1,
            id: approvalId,
            projectId,
            sessionId: projectId,
            kind: "generation",
            title: "确认真实 Vidu 生成",
            summary: "M5.7 验收用受控生成确认。",
            status: "pending",
            requestedActions: [],
            actionHash,
            idempotencyKey,
            affectedNodeIds: [],
            affectedArtifactIds: ["artifact-m57-prompt-pack"],
            estimatedCredits: 0,
            requestedAt: now
          }
        ],
        canvasGraph: {
          schemaVersion: 1,
          projectId,
          nodes: [],
          edges: [],
          graphVersion: `graph-${now}`,
          updatedAt: now
        },
        generationTasks: [],
        mediaAssets: [],
        events: [
          {
            schemaVersion: 1,
            id: "event-m57-seed",
            projectId,
            sessionId: projectId,
            sequence: 1,
            actorType: "agent",
            eventType: "approval.requested",
            objectType: "approval_request",
            objectId: approvalId,
            correlationId: approvalId,
            requestId: idempotencyKey,
            payload: { idempotencyKey, actionHash },
            createdAt: now
          }
        ],
        updatedAt: now
      }
    ]
  };
}

async function putWorkspace(workspace) {
  const response = await fetch(`${origin}/api/agent/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace)
  });
  const jsonBody = await response.json().catch(() => ({}));
  assert(response.ok, `workspace PUT failed: ${response.status} ${JSON.stringify(jsonBody)}`);
  return jsonBody;
}

async function getWorkspace() {
  const response = await fetch(`${origin}/api/agent/workspace`, { cache: "no-store" });
  const jsonBody = await response.json();
  assert(response.ok, `workspace GET failed: ${response.status} ${JSON.stringify(jsonBody)}`);
  return jsonBody;
}

async function resetServerWorkspace() {
  await putWorkspace({
    route: "workbench",
    selectedProduct: "",
    setupMode: "clone",
    activeSessionId: null,
    sessions: [],
    artifacts: [],
    eventLog: [],
    projectBundles: []
  });
}

async function executeAndPoll(projectId) {
  const approvalRequestId = `approval-${projectId}`;
  const actionHash = `generation:m57:${projectId}`;
  const idempotencyKey = `m57:${projectId}:${actionHash}`;
  const requestBody = {
    projectId,
    approvalRequestId,
    actionHash,
    idempotencyKey,
    actorId: "m57-acceptance",
    generation: generationRequest()
  };

  await putWorkspace(createWorkspace(projectId, approvalRequestId, actionHash, idempotencyKey));
  assert(fixtureState.dbBundleUpserts > 0, "workspace PUT did not write project bundle to DB store");

  const executeResponse = await fetch(`${origin}/api/agent/generation/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const executeJson = await executeResponse.json();
  assert(executeResponse.ok, `execute failed: ${JSON.stringify(executeJson)}`);
  assert(executeJson.oldViduRouteCalls === 0, "execute reported legacy Vidu route usage");

  const pollResponse = await fetch(`${origin}/api/agent/generation/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      taskId: executeJson.task.id,
      providerTaskId: executeJson.task.providerTaskId
    })
  });
  const pollJson = await pollResponse.json();
  assert(pollResponse.ok, `poll failed: ${JSON.stringify(pollJson)}`);
  assert(pollJson.status === "succeeded", "poll did not succeed");
  assert(pollJson.oldViduRouteCalls === 0, "poll reported legacy Vidu route usage");

  const createsBeforeRepeat = fixtureState.viduCreates;
  const repeatResponse = await fetch(`${origin}/api/agent/generation/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const repeatJson = await repeatResponse.json();
  assert(repeatResponse.ok, `repeat execute failed: ${JSON.stringify(repeatJson)}`);
  assert(repeatJson.idempotent === true, "repeat confirmation did not return idempotent result");
  assert(fixtureState.viduCreates === createsBeforeRepeat, "repeat confirmation created another provider task");
  assert(repeatJson.oldViduRouteCalls === 0, "repeat execute reported legacy Vidu route usage");

  return { pollJson, requestBody };
}

async function verifyReplayReadsDb(projectId) {
  await resetServerWorkspace();
  const response = await fetch(`${origin}/api/agent/session-replay?sessionId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const replay = await response.json();
  assert(response.ok, `session replay failed: ${response.status} ${JSON.stringify(replay)}`);
  assert(replay.projectBundle, "session replay did not read project bundle from DB store");
  assert(replay.projectBundle.generationTasks.length === 1, "session replay DB bundle missing GenerationTask");
  assert(replay.projectBundle.mediaAssets.length === 1, "session replay DB bundle missing MediaAsset");
  assert(replay.projectBundle.canvasGraph.nodes.length === 1, "session replay DB bundle missing CanvasGraph projection");
  assert(!JSON.stringify(replay).includes("m57-fixture-service-role"), "session replay leaked service role key");
}

async function verifyWorkspaceHydratesDb(projectId) {
  const workspace = await getWorkspace();
  const bundle = workspace.projectBundles?.find((item) => item.project?.id === projectId);
  assert(bundle, "workspace GET did not hydrate DB project bundle");
  assert(bundle.generationTasks.length === 1, "hydrated workspace missing GenerationTask");
  assert(bundle.mediaAssets.length === 1, "hydrated workspace missing MediaAsset");
}

async function verifyMigrationFile() {
  const migrationPath = path.join(rootDir, "supabase", "migrations", "20260523000000_m57_agent_project_store.sql");
  const sql = await readFile(migrationPath, "utf8");
  const requiredSnippets = [
    "create table if not exists public.ad_agent_projects",
    "create table if not exists public.ad_agent_sessions",
    "create table if not exists public.ad_approval_requests",
    "create table if not exists public.ad_generation_tasks",
    "create table if not exists public.ad_media_assets",
    "create table if not exists public.ad_canvas_graphs",
    "create table if not exists public.ad_canvas_snapshots",
    "create table if not exists public.ad_agent_events",
    "create table if not exists public.ad_agent_artifacts",
    "ad_agent_events_prevent_mutation",
    "unique (project_id, idempotency_key)",
    "unique (provider, provider_task_id)"
  ];
  for (const snippet of requiredSnippets) {
    assert(sql.includes(snippet), `migration missing required snippet: ${snippet}`);
  }
}

function verifyDbBundle(projectId) {
  const bundle = fixtureState.bundles.get(projectId);
  assert(bundle, "DB fixture has no project bundle");
  assert(bundle.project.id === projectId, "DB Project was not persisted");
  assert(bundle.sessions.length === 1, "DB Session was not persisted");
  assert(bundle.artifacts.length === 1, "DB AgentArtifacts compatibility record was not persisted");
  assert(bundle.approvalRequests.length === 1, "DB ApprovalRequest was not persisted");
  assert(bundle.approvalRequests[0].status === "executed", "approval status flow did not reach executed");
  assert(bundle.generationTasks.length === 1, "DB GenerationTask was not persisted");
  assert(bundle.generationTasks[0].provider === "vidu", "GenerationTask provider not persisted");
  assert(bundle.generationTasks[0].providerTaskId, "GenerationTask providerTaskId missing");
  assert(bundle.mediaAssets.length === 1, "DB MediaAsset was not persisted");
  assert(bundle.mediaAssets[0].storage?.provider === "supabase_storage", "MediaAsset did not recover from Supabase Storage");
  assert(bundle.canvasGraph.nodes.length === 1, "DB CanvasGraph projection missing");
  assert(bundle.events.some((event) => event.eventType === "generation.succeeded"), "DB EventLog missing generation.succeeded");
  assert(bundle.events.some((event) => event.eventType === "asset.persisted"), "DB EventLog missing asset.persisted");
  assert(bundle.events.some((event) => event.eventType === "canvas.node.created"), "DB EventLog missing canvas.node.created");

  const sequences = bundle.events.map((event) => event.sequence);
  assert(new Set(sequences).size === sequences.length, "EventLog sequences are not unique");
  assert(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]), "EventLog is not append-ordered");
}

async function main() {
  fixtureServer = await startFixtureServer();
  fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;

  await verifyMigrationFile();
  await ensureServer();
  await resetServerWorkspace();

  const projectId = "project-m57-db-store";
  await executeAndPoll(projectId);
  verifyDbBundle(projectId);
  await verifyWorkspaceHydratesDb(projectId);
  await verifyReplayReadsDb(projectId);

  assert(fixtureState.viduCreates === 1, "expected exactly one fixture Vidu create call");
  assert(fixtureState.storageUploads.length === 1, "expected exactly one Supabase Storage upload");
  assert(fixtureState.dbBundleReads > 0, "DB store was not read");
  assert(fixtureState.dbBundleUpserts >= 4, "DB store did not receive project state updates");

  console.log("M5.7 acceptance passed", {
    dbBundleReads: fixtureState.dbBundleReads,
    dbBundleUpserts: fixtureState.dbBundleUpserts,
    dbEventAppends: fixtureState.dbEventAppends,
    viduCreates: fixtureState.viduCreates,
    viduPolls: fixtureState.viduPolls,
    storageUploads: fixtureState.storageUploads.length,
    oldViduRouteCalls: 0,
    realViduCalls: 0,
    realCreditsCharged: 0
  });
}

main().finally(() => {
  if (startedServer) startedServer.kill();
  if (fixtureServer) fixtureServer.close();
});
