import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = 3330 + Math.floor(Math.random() * 300);
const configuredBaseUrl = process.env.M57_REAL_DB_SMOKE_BASE_URL ?? `http://127.0.0.1:${defaultPort}/`;
const origin = new URL(configuredBaseUrl).origin;
const port = new URL(configuredBaseUrl).port || "3330";
const confirmValue = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";
const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() || "ad-studio-media";
const projectId = `project-m57-real-db-${Date.now()}`;

let startedServer = null;
let fixtureServer = null;
let fixtureOrigin = "";

const fixtureState = {
  viduCreates: 0,
  viduPolls: 0,
  outputDownloads: 0
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function media(response) {
  const bytes = Buffer.from("m57 real docker smoke mp4 bytes");
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": String(bytes.byteLength)
  });
  response.end(bytes);
}

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "POST" && requestUrl.pathname === "/text2video") {
        fixtureState.viduCreates += 1;
        await readBody(request);
        json(response, 200, {
          task_id: `vidu-m57-real-${projectId}-${fixtureState.viduCreates}`,
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
          credits: 0,
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

      json(response, 404, { message: `Unhandled fixture route: ${request.method} ${requestUrl.pathname}` });
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function waitFor(fn, label, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
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
      VIDU_API_KEY: "m57-real-db-fixture-vidu-key",
      VIDU_API_BASE_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_MEDIA_BUCKET: bucket
    }
  });

  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M57_REAL_DB_SMOKE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M57_REAL_DB_SMOKE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 60000);
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method: options.method ?? "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok && options.allowFailure !== true) {
    throw new Error(`Supabase request failed: ${options.method ?? "GET"} ${pathname} ${response.status}`);
  }
  return { response, body };
}

function encodePath(value) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function ensureBucket() {
  const list = await supabaseRequest("/storage/v1/bucket");
  const buckets = Array.isArray(list.body) ? list.body : [];
  if (buckets.some((item) => item?.id === bucket || item?.name === bucket)) return;
  await supabaseRequest("/storage/v1/bucket", {
    method: "POST",
    body: {
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: 104857600,
      allowed_mime_types: ["video/mp4", "image/png", "image/jpeg", "image/webp"]
    }
  });
}

async function cleanupProject() {
  await supabaseRequest(`/rest/v1/ad_agent_projects?id=eq.${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
    allowFailure: true
  });
}

async function tableRows(table, query = "") {
  const suffix = query ? `?${query}` : "";
  const { body } = await supabaseRequest(`/rest/v1/${table}${suffix}`);
  assert(Array.isArray(body), `Expected array response for ${table}`);
  return body;
}

function generationRequest() {
  return {
    kind: "video",
    surface: "agent",
    modelId: "viduq3-turbo",
    modelName: "Vidu Q3 Turbo",
    modeKey: "text-to-video",
    prompt: "Create a 5 second vertical mobile app ad for M5.7 real Docker Supabase acceptance.",
    params: {
      ratio: "9:16",
      duration: "5s",
      resolution: "720p"
    },
    slots: []
  };
}

function createWorkspace(approvalId, actionHash, idempotencyKey) {
  const now = new Date().toISOString();
  const artifactId = `artifact-m57-real-prompt-pack-${projectId}`;
  return {
    route: "workbench",
    selectedProduct: "Family Locator",
    setupMode: "clone",
    activeSessionId: projectId,
    sessions: [
      {
        id: projectId,
        title: "M5.7 Real DB Store Smoke",
        product: "Family Locator",
        mode: "clone",
        updatedAt: now,
        session: {
          id: projectId,
          projectTitle: "M5.7 Real DB Store Smoke",
          projectKind: "blank",
          lifecycle: "ready",
          mode: "clone",
          currentStepIndex: 0,
          locked: false,
          product: "Family Locator",
          competitor: "",
          focus: [],
          creativeGoal: "M5.7 real DB store smoke",
          specs: { language: "", channel: "", ratio: "9:16", duration: "5s" },
          originalPrompt: "M5.7 real DB store smoke",
          uploadedAssets: [],
          canvasState: { nodes: [], edges: [] },
          createdAt: now,
          updatedAt: now
        },
        runtime: {
          stage: "ready",
          messages: [
            {
              id: "m57-real-user-message",
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
          title: "M5.7 Real DB Store Smoke",
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
              projectTitle: "M5.7 Real DB Store Smoke",
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
            id: artifactId,
            projectId,
            sessionId: projectId,
            artifactType: "promptPack",
            artifactKey: "prompt-pack",
            status: "confirmed",
            source: "user_confirmation",
            version: 1,
            body: { prompt: "M5.7 real DB accepted prompt pack" },
            summary: {
              kind: "promptPack",
              id: artifactId,
              source: "user_confirmation",
              status: "confirmed",
              title: "Prompt Pack",
              summary: "Approved prompt pack for M5.7 real DB smoke.",
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
            title: "确认 fixture Vidu 生成",
            summary: "M5.7 真实 Docker DB smoke 用受控生成确认。",
            status: "pending",
            requestedActions: [],
            actionHash,
            idempotencyKey,
            affectedNodeIds: [],
            affectedArtifactIds: [artifactId],
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
            id: `event-m57-real-seed-${projectId}`,
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

async function executeAndPoll() {
  const approvalRequestId = `approval-${projectId}`;
  const actionHash = `generation:m57-real:${projectId}`;
  const idempotencyKey = `m57-real:${projectId}:${actionHash}`;
  const requestBody = {
    projectId,
    approvalRequestId,
    actionHash,
    idempotencyKey,
    actorId: "m57-real-db-smoke",
    generation: generationRequest()
  };

  await putWorkspace(createWorkspace(approvalRequestId, actionHash, idempotencyKey));

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

async function verifyWorkspaceHydratesDb() {
  const workspace = await getWorkspace();
  const bundle = workspace.projectBundles?.find((item) => item.project?.id === projectId);
  assert(bundle, "workspace GET did not hydrate DB project bundle");
  assert(bundle.sessions.length === 1, "hydrated workspace missing Session");
  assert(bundle.artifacts.length === 1, "hydrated workspace missing AgentArtifact");
  assert(bundle.approvalRequests.length === 1, "hydrated workspace missing ApprovalRequest");
  assert(bundle.approvalRequests[0].status === "executed", "hydrated approval did not reach executed");
  assert(bundle.generationTasks.length === 1, "hydrated workspace missing GenerationTask");
  assert(bundle.mediaAssets.length === 1, "hydrated workspace missing MediaAsset");
  assert(bundle.canvasGraph.nodes.length === 1, "hydrated workspace missing CanvasGraph projection");
  assert(bundle.events.some((event) => event.eventType === "generation.succeeded"), "hydrated workspace missing generation.succeeded EventLog");
}

async function verifyReplayReadsDb() {
  await resetServerWorkspace();
  const response = await fetch(`${origin}/api/agent/session-replay?sessionId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const replay = await response.json();
  assert(response.ok, `session replay failed: ${response.status} ${JSON.stringify(replay)}`);
  assert(replay.projectBundle, "session replay did not read project bundle from DB store");
  assert(replay.projectBundle.approvalRequests.length === 1, "session replay DB bundle missing ApprovalRequest");
  assert(replay.projectBundle.generationTasks.length === 1, "session replay DB bundle missing GenerationTask");
  assert(replay.projectBundle.mediaAssets.length === 1, "session replay DB bundle missing MediaAsset");
  assert(replay.projectBundle.canvasGraph.nodes.length === 1, "session replay DB bundle missing CanvasGraph projection");
  assert(replay.projectBundle.events.some((event) => event.eventType === "generation.succeeded"), "session replay DB bundle missing EventLog");
  assert(!JSON.stringify(replay).includes(serviceRoleKey), "session replay leaked service role key");
}

async function verifyPostgresRows() {
  const query = `project_id=eq.${encodeURIComponent(projectId)}`;
  const projects = await tableRows("ad_agent_projects", `id=eq.${encodeURIComponent(projectId)}`);
  const sessions = await tableRows("ad_agent_sessions", query);
  const artifacts = await tableRows("ad_agent_artifacts", query);
  const approvals = await tableRows("ad_approval_requests", query);
  const tasks = await tableRows("ad_generation_tasks", query);
  const assets = await tableRows("ad_media_assets", query);
  const graphs = await tableRows("ad_canvas_graphs", query);
  const snapshots = await tableRows("ad_canvas_snapshots", query);
  const events = await tableRows("ad_agent_events", `${query}&order=sequence.asc`);

  assert(projects.length === 1, "Postgres missing Project row");
  assert(sessions.length === 1, "Postgres missing Session row");
  assert(artifacts.length === 1, "Postgres missing AgentArtifact row");
  assert(approvals.length === 1, "Postgres missing ApprovalRequest row");
  assert(approvals[0].status === "executed", "Postgres approval did not reach executed");
  assert(tasks.length === 1, "Postgres missing GenerationTask row");
  assert(tasks[0].status === "succeeded", "Postgres GenerationTask did not reach succeeded");
  assert(tasks[0].provider === "vidu", "Postgres GenerationTask provider mismatch");
  assert(tasks[0].provider_task_id, "Postgres GenerationTask provider_task_id missing");
  assert(assets.length === 1, "Postgres missing MediaAsset row");
  assert(assets[0].storage_provider === "supabase_storage", "Postgres MediaAsset did not persist Supabase Storage provider");
  assert(assets[0].storage_key, "Postgres MediaAsset storage_key missing");
  assert(assets[0].recoverable === true, "Postgres MediaAsset was not recoverable");
  assert(graphs.length === 1, "Postgres missing CanvasGraph row");
  assert(Array.isArray(graphs[0].nodes) && graphs[0].nodes.length === 1, "Postgres CanvasGraph projection missing node");
  assert(snapshots.length >= 1, "Postgres missing CanvasSnapshot row");
  assert(events.some((event) => event.event_type === "generation.succeeded"), "Postgres EventLog missing generation.succeeded");
  assert(events.some((event) => event.event_type === "asset.persisted"), "Postgres EventLog missing asset.persisted");
  assert(events.some((event) => event.event_type === "canvas.node.created"), "Postgres EventLog missing canvas.node.created");

  const sequences = events.map((event) => event.sequence);
  assert(new Set(sequences).size === sequences.length, "Postgres EventLog sequences are not unique");
  assert(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]), "Postgres EventLog is not append-ordered");

  const blockedMutation = await supabaseRequest(`/rest/v1/ad_agent_events?id=eq.${encodeURIComponent(events[0].id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { payload: { attemptedMutation: true } },
    allowFailure: true
  });
  assert(!blockedMutation.response.ok, "Postgres EventLog update was not blocked by append-only trigger");

  const objectResponse = await fetch(`${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodePath(assets[0].storage_key)}`, { cache: "no-store" });
  assert(objectResponse.ok, `Supabase Storage public object was not readable: ${objectResponse.status}`);
  const bytes = Buffer.from(await objectResponse.arrayBuffer());
  assert(bytes.byteLength > 0, "Supabase Storage public object was empty");
}

async function main() {
  fixtureServer = await startFixtureServer();
  fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;

  await ensureBucket();
  await cleanupProject();
  await ensureServer();
  await resetServerWorkspace();
  await executeAndPoll();
  await verifyWorkspaceHydratesDb();
  await verifyPostgresRows();
  await verifyReplayReadsDb();

  assert(fixtureState.viduCreates === 1, "expected exactly one fixture Vidu create call");
  assert(fixtureState.viduPolls >= 1, "expected at least one fixture Vidu poll call");
  assert(fixtureState.outputDownloads === 1, "expected exactly one fixture provider output download");

  console.log("M5.7 real Docker Supabase smoke passed", {
    projectId,
    bucket,
    fixtureViduCreates: fixtureState.viduCreates,
    fixtureViduPolls: fixtureState.viduPolls,
    providerOutputDownloads: fixtureState.outputDownloads,
    oldViduRouteCalls: 0,
    realViduCalls: 0,
    realCreditsCharged: 0
  });
}

main().finally(() => {
  if (startedServer) startedServer.kill();
  if (fixtureServer) fixtureServer.close();
});
