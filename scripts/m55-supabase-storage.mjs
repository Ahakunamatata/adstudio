import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredBaseUrl = process.env.M55_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3011/";
const origin = new URL(configuredBaseUrl).origin;
const port = new URL(configuredBaseUrl).port || "3011";
const confirmValue = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";

let startedServer = null;
let fixtureServer = null;
const fixtureState = {
  viduCreates: 0,
  viduPolls: 0,
  outputDownloads: 0,
  storageUploads: []
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && requestUrl.pathname === "/text2video") {
        fixtureState.viduCreates += 1;
        await readBody(request);
        json(response, 200, {
          task_id: `vidu-m55-${fixtureState.viduCreates}`,
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
        const bytes = Buffer.from("m55 fixture mp4 bytes");
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": String(bytes.byteLength)
        });
        response.end(bytes);
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
        if (key.includes("project-m55-storage-failed")) {
          json(response, 500, { message: "fixture storage upload failed" });
          return;
        }
        json(response, 200, { Key: key });
        return;
      }

      json(response, 404, { message: `Unhandled fixture route: ${request.method} ${requestUrl.pathname}` });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

let fixtureOrigin = "";

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
      AD_STUDIO_M54_ENABLE_REAL_VIDU_WORKBENCH: "1",
      AD_STUDIO_M54_CONFIRM_REAL_VIDU_WORKBENCH: confirmValue,
      VIDU_API_KEY: "m55-fixture-vidu-key",
      VIDU_API_BASE_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
      SUPABASE_SERVICE_ROLE_KEY: "m55-fixture-service-role",
      SUPABASE_MEDIA_BUCKET: "ad-studio-media"
    }
  });

  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M55_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M55_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function createWorkspace(projectId, approvalId, actionHash, idempotencyKey) {
  const now = new Date().toISOString();
  return {
    route: "workbench",
    selectedProduct: "",
    setupMode: "clone",
    activeSessionId: projectId,
    sessions: [
      {
        id: projectId,
        title: "M5.5 Storage Acceptance",
        product: "Family Locator",
        mode: "clone",
        updatedAt: now,
        session: {
          id: projectId,
          mode: "clone",
          product: "Family Locator",
          projectTitle: "M5.5 Storage Acceptance",
          createdAt: now,
          updatedAt: now
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
          title: "M5.5 Storage Acceptance",
          productName: "Family Locator",
          mode: "clone",
          lifecycle: "ready",
          activeSessionId: projectId,
          createdAt: now,
          updatedAt: now
        },
        sessions: [],
        artifacts: [],
        approvalRequests: [
          {
            schemaVersion: 1,
            id: approvalId,
            projectId,
            sessionId: projectId,
            kind: "generation",
            title: "确认真实 Vidu 生成",
            summary: "M5.5 验收用受控生成确认。",
            status: "pending",
            requestedActions: [],
            actionHash,
            idempotencyKey,
            affectedNodeIds: [],
            affectedArtifactIds: [],
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
        events: [],
        updatedAt: now
      }
    ]
  };
}

function generationRequest() {
  return {
    kind: "video",
    modelId: "viduq3-turbo",
    modelName: "Vidu Q3 Turbo",
    modeKey: "text-to-video",
    prompt: "Create a 5 second vertical mobile app ad for M5.5 storage acceptance.",
    params: {
      ratio: "9:16",
      duration: "5s",
      resolution: "720p"
    },
    slots: []
  };
}

async function putWorkspace(workspace) {
  const response = await fetch(`${origin}/api/agent/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace)
  });
  assert(response.ok, `workspace PUT failed: ${response.status}`);
}

async function executeAndPoll(projectId) {
  const approvalRequestId = `approval-${projectId}`;
  const actionHash = `generation:m55:${projectId}`;
  const idempotencyKey = `m55:${projectId}:${actionHash}`;
  await putWorkspace(createWorkspace(projectId, approvalRequestId, actionHash, idempotencyKey));

  const executeResponse = await fetch(`${origin}/api/agent/generation/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      approvalRequestId,
      actionHash,
      idempotencyKey,
      actorId: "m55-acceptance",
      generation: generationRequest()
    })
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
  assert(pollJson.oldViduRouteCalls === 0, "poll reported legacy Vidu route usage");
  return pollJson;
}

async function run() {
  fixtureServer = await startFixtureServer();
  const address = fixtureServer.address();
  fixtureOrigin = `http://127.0.0.1:${address.port}`;
  await ensureServer();

  const persisted = await executeAndPoll("project-m55-storage-persisted");
  assert(persisted.status === "succeeded", "persisted case did not succeed");
  assert(persisted.asset?.recoverable === true, "persisted asset is not recoverable");
  assert(persisted.asset?.storageProvider === "supabase_storage", "persisted asset did not use supabase_storage");
  assert(persisted.asset?.storageKey?.includes("projects/project-m55-storage-persisted/generations/"), "persisted asset storage key is missing project/task path");
  assert(!persisted.temporaryExternalAssetWarning, "persisted asset still returned temporary external warning");
  assert(persisted.bundle.events.some((event) => event.eventType === "asset.persisted"), "persisted case missing asset.persisted");
  assert(!persisted.bundle.events.some((event) => event.eventType === "asset.not_persisted"), "persisted case should not write asset.not_persisted");

  const failed = await executeAndPoll("project-m55-storage-failed");
  assert(failed.status === "succeeded", "storage failure case should keep generation succeeded");
  assert(failed.asset?.recoverable === false, "storage failure case should keep asset unrecoverable");
  assert(failed.asset?.storageProvider === "external", "storage failure case should keep external storage");
  assert(Boolean(failed.temporaryExternalAssetWarning), "storage failure case should return temporary external warning");
  assert(failed.bundle.events.some((event) => event.eventType === "asset.not_persisted"), "storage failure case missing asset.not_persisted");
  assert(failed.bundle.events.some((event) => event.eventType === "generation.succeeded"), "storage failure case missing generation.succeeded");

  assert(fixtureState.viduCreates === 2, "unexpected Vidu create call count");
  assert(fixtureState.viduPolls === 2, "unexpected Vidu poll call count");
  assert(fixtureState.outputDownloads === 2, "provider output was not downloaded for both cases");
  assert(fixtureState.storageUploads.length === 2, "Supabase Storage upload was not attempted for both cases");
  assert(fixtureState.storageUploads.every((upload) => upload.authorization === "Bearer m55-fixture-service-role"), "storage upload did not use service role authorization");
  assert(fixtureState.storageUploads.every((upload) => upload.upsert === "true"), "storage upload did not set x-upsert");

  console.log(JSON.stringify({
    status: "passed",
    mode: "m55-supabase-storage",
    origin,
    fixtureOrigin,
    realProviderCalls: fixtureState.viduCreates + fixtureState.viduPolls,
    oldViduRouteCalls: 0,
    storageUploads: fixtureState.storageUploads.map((upload) => ({
      key: upload.key,
      byteSize: upload.byteSize,
      contentType: upload.contentType,
      upsert: upload.upsert
    })),
    cases: [
      {
        name: "persisted",
        asset: persisted.asset,
        eventTypes: persisted.bundle.events.map((event) => event.eventType)
      },
      {
        name: "storage-failed",
        asset: failed.asset,
        temporaryExternalAssetWarning: failed.temporaryExternalAssetWarning,
        eventTypes: failed.bundle.events.map((event) => event.eventType)
      }
    ]
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      mode: "m55-supabase-storage",
      origin,
      fixtureOrigin,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedServer) startedServer.kill("SIGTERM");
    if (fixtureServer) fixtureServer.close();
  });

