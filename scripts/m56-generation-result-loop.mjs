import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = 3012 + Math.floor(Math.random() * 400);
const configuredBaseUrl = process.env.M56_ACCEPTANCE_BASE_URL ?? `http://127.0.0.1:${defaultPort}/`;
const origin = new URL(configuredBaseUrl).origin;
const port = new URL(configuredBaseUrl).port || "3012";
const workbenchUrl = new URL("/ad-workbench", origin).toString();
const confirmValue = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";

let startedServer = null;
let fixtureServer = null;
let fixtureOrigin = "";
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

function media(response) {
  const bytes = Buffer.from("m56 fixture mp4 bytes");
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
          task_id: `vidu-m56-${fixtureState.viduCreates}`,
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

      if (request.method === "GET" && requestUrl.pathname.startsWith("/storage/v1/object/public/ad-studio-media/")) {
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
        if (key.includes("project-m56-storage-failed")) {
          json(response, 500, { message: "fixture storage upload failed" });
          return;
        }
        json(response, 200, { Key: key });
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
      AD_STUDIO_M54_ENABLE_REAL_VIDU_WORKBENCH: "1",
      AD_STUDIO_M54_CONFIRM_REAL_VIDU_WORKBENCH: confirmValue,
      VIDU_API_KEY: "m56-fixture-vidu-key",
      VIDU_API_BASE_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
      SUPABASE_SERVICE_ROLE_KEY: "m56-fixture-service-role",
      SUPABASE_MEDIA_BUCKET: "ad-studio-media"
    }
  });

  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M56_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M56_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
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
        title: "M5.6 Result Loop Acceptance",
        product: "Family Locator",
        mode: "clone",
        updatedAt: now,
        session: {
          id: projectId,
          projectTitle: "M5.6 Result Loop Acceptance",
          projectKind: "blank",
          lifecycle: "ready",
          mode: "clone",
          currentStepIndex: 0,
          locked: false,
          product: "Family Locator",
          competitor: "",
          focus: [],
          creativeGoal: "M5.6 result loop acceptance",
          specs: { language: "", channel: "", ratio: "9:16", duration: "5s" },
          originalPrompt: "M5.6 result loop acceptance",
          uploadedAssets: [],
          canvasState: { nodes: [], edges: [] },
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
          title: "M5.6 Result Loop Acceptance",
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
            summary: "M5.6 验收用受控生成确认。",
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
    prompt: "Create a 5 second vertical mobile app ad for M5.6 result loop acceptance.",
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
  const actionHash = `generation:m56:${projectId}`;
  const idempotencyKey = `m56:${projectId}:${actionHash}`;
  const requestBody = {
    projectId,
    approvalRequestId,
    actionHash,
    idempotencyKey,
    actorId: "m56-acceptance",
    generation: generationRequest()
  };
  await putWorkspace(createWorkspace(projectId, approvalRequestId, actionHash, idempotencyKey));

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
  assert(pollJson.bundle.generationTasks.length === 1, "GenerationTaskRecord was not written");
  assert(pollJson.bundle.mediaAssets.length === 1, "MediaAssetRecord was not written");
  assert(pollJson.bundle.events.some((event) => event.eventType === "generation.succeeded"), "generation.succeeded event missing");
  assert(pollJson.bundle.canvasGraph.nodes.some((node) => node.versions.some((version) => version.providerTaskId === executeJson.task.providerTaskId)), "canvas node version was not projected");

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

  return pollJson;
}

function buildUiWorkspace(bundles, activeProjectId) {
  const now = new Date().toISOString();
  return {
    route: "workbench",
    selectedProduct: "Family Locator",
    setupMode: "clone",
    activeSessionId: activeProjectId,
    sessions: bundles.map((bundle) => ({
      id: bundle.project.id,
      title: bundle.project.title,
      product: bundle.project.productName ?? "Family Locator",
      mode: bundle.project.mode,
      updatedAt: bundle.updatedAt,
      session: {
        id: bundle.project.id,
        projectTitle: bundle.project.title,
        projectKind: "blank",
        lifecycle: "ready",
        mode: bundle.project.mode,
        currentStepIndex: 0,
        locked: false,
        product: bundle.project.productName ?? "Family Locator",
        competitor: "",
        focus: [],
        creativeGoal: "M5.6 result loop acceptance",
        specs: { language: "", channel: "", ratio: "9:16", duration: "5s" },
        originalPrompt: "M5.6 result loop acceptance",
        uploadedAssets: [],
        canvasState: {
          nodes: bundle.canvasGraph.nodes,
          edges: bundle.canvasGraph.edges
        },
        createdAt: bundle.project.createdAt ?? now,
        updatedAt: bundle.updatedAt
      }
    })),
    artifacts: [],
    eventLog: [],
    projectBundles: bundles
  };
}

async function visibleText(page) {
  return ((await page.locator("body").innerText()) ?? "").replace(/\s+/g, " ").trim();
}

async function sendMessage(page, text) {
  const input = page.locator(".agent-composer-input");
  await input.fill(text);
  await page.locator(".agent-composer-send").click();
}

async function verifyWorkbenchUi(workspace) {
  const browser = await chromium.launch({
    channel: process.env.M56_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M56_ACCEPTANCE_HEADFUL !== "1"
  });
  let oldViduRouteCalls = 0;

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((value) => {
      window.localStorage.setItem("ad-studio:agent-workspace:v2", JSON.stringify(value));
    }, workspace);
    await context.route("**/api/agent/workspace**", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        Object.assign(workspace, body);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
    });
    await context.route("**/api/vidu/history**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ video: [], image: [] }) });
    });
    await context.route("**/api/vidu/generate**", async (route) => {
      oldViduRouteCalls += 1;
      await route.fulfill({ status: 418, contentType: "application/json", body: JSON.stringify({ error: "legacy route blocked" }) });
    });

    const page = await context.newPage();
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    try {
      await waitFor(async () => {
        const text = await visibleText(page);
        return text.includes("真实生成任务") &&
          text.includes("生成完成") &&
          text.includes("结果已保存，可恢复") &&
          text.includes("结果已关联到画布") &&
          text.includes("局部返工") &&
          text.includes("生成视频结果") &&
          !text.includes("GenerationTask") &&
          !text.includes("MediaAsset") &&
          !text.includes("recoverable=true") &&
          !text.includes("supabase_storage") &&
          !text.includes("Canvas node");
      }, "Workbench did not show persisted generated result, storage state, or canvas projection");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}. Visible text: ${await visibleText(page)}`);
    }

    await page.getByRole("button", { name: /结果预览|临时结果预览/ }).first().click();
    await waitFor(() => page.locator(".generation-media-preview-overlay.open").isVisible(), "media preview did not open");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "局部返工" }).first().click();
    await waitFor(async () => (await visibleText(page)).includes("局部返工提案"), "repair proposal was not shown");

    await page.reload({ waitUntil: "networkidle" });
    await waitFor(async () => {
      const text = await visibleText(page);
      return text.includes("生成完成") &&
        text.includes("结果已保存，可恢复") &&
        text.includes("生成视频结果") &&
        text.includes("局部返工提案");
    }, "generated result did not restore after refresh");

    await context.close();
    return { oldViduRouteCalls };
  } finally {
    await browser.close();
  }
}

function invalidCanvasDecision(latestUserText) {
  if (/进入/.test(latestUserText)) {
    return {
      message: "我先把脚本方案整理成画布结构，确认后再创建。",
      briefPatch: {},
      questions: [],
      confirmation: {
        id: "m56-invalid-canvas-confirmation",
        title: "确认创建脚本画布",
        summary: "把当前脚本进入画布。",
        bullets: ["创建脚本节点并连接上游信息。"],
        confirmLabel: "确认创建",
        secondaryLabel: "先调整"
      },
      generation: undefined,
      canvasActions: [
        {
          type: "createNode",
          input: {
            id: "m56-script-node",
            kind: "script",
            title: "广告脚本",
            output: "脚本草案",
            status: "succeeded"
          }
        },
        { type: "connectNodes", source: "", target: "" },
        { type: "connectNodes", source: "m56-script-node", target: "m56-script-node" }
      ],
      safetyNotes: []
    };
  }

  if (/生成脚本/.test(latestUserText)) {
    return {
      message: "脚本草案已整理好。需要进入画布时，请输入“进入”。",
      briefPatch: { originalPrompt: "M5.6 internal error replay flow" },
      questions: [],
      canvasActions: []
    };
  }

  return {
    message: "已收到。请继续补充产品或下一步目标。",
    briefPatch: { product: "Family Locator" },
    questions: [],
    canvasActions: []
  };
}

async function verifyInternalErrorsHiddenAndReplayExported() {
  const browser = await chromium.launch({
    channel: process.env.M56_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M56_ACCEPTANCE_HEADFUL !== "1"
  });
  const internalTerms = ["connectNodes", "source", "target", "nodeId", "Action 3", "目标节点", "不能连接到自身"];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("**/api/agent/decide", async (route) => {
      const body = route.request().postDataJSON();
      const messages = Array.isArray(body?.snapshot?.messages) ? body.snapshot.messages : [];
      const latestUserText = [...messages].reverse().find((message) => message?.role === "user")?.body ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          output: invalidCanvasDecision(latestUserText),
          runtime: {
            configured: true,
            model: "m56-invalid-canvas-fixture",
            apiUrl: "mock://agent"
          }
        })
      });
    });
    await context.route("**/api/vidu/history**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ video: [], image: [] }) });
    });

    const page = await context.newPage();
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await sendMessage(page, "我要做一个广告");
    await waitFor(async () => (await visibleText(page)).includes("已收到"), "first message was not handled");
    await sendMessage(page, "产品是 Family Locator");
    await waitFor(async () => (await visibleText(page)).includes("Family Locator"), "product message was not handled");
    await sendMessage(page, "生成脚本");
    await waitFor(async () => (await visibleText(page)).includes("脚本草案已整理好"), "script message was not handled");
    await sendMessage(page, "进入");
    await waitFor(async () => (await visibleText(page)).includes("这个画布方案暂时无法创建"), "friendly canvas validation message not visible");

    const bodyText = await visibleText(page);
    for (const term of internalTerms) {
      assert(!bodyText.includes(term), `internal validator term leaked to UI: ${term}`);
    }

    await page.evaluate(async () => {
      const raw = window.localStorage.getItem("ad-studio:agent-workspace:v2");
      if (!raw) throw new Error("missing local workspace");
      await fetch("/api/agent/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: raw
      });
    });
    const replay = await page.evaluate(async () => {
      const workspace = JSON.parse(window.localStorage.getItem("ad-studio:agent-workspace:v2") ?? "{}");
      const sessionId = workspace.activeSessionId;
      const response = await fetch(`/api/agent/session-replay?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`replay export failed: ${response.status}`);
      return response.json();
    });
    const replayText = JSON.stringify(replay);
    assert(replayText.includes("connectNodes"), "replay export did not include connectNodes validator detail");
    assert(replayText.includes("缺少 source") || replayText.includes("不能连接到自身"), "replay export did not include internal validator error detail");
    assert(!replayText.includes("m56-fixture-service-role"), "replay export leaked service role key");

    await context.close();
    return {
      uiInternalTerms: internalTerms.filter((term) => bodyText.includes(term)),
      replayDebugLogs: replay?.derivedEvents?.debugLogs?.length ?? 0
    };
  } finally {
    await browser.close();
  }
}

async function run() {
  fixtureServer = await startFixtureServer();
  const address = fixtureServer.address();
  fixtureOrigin = `http://127.0.0.1:${address.port}`;
  await ensureServer();
  await resetServerWorkspace();

  const persisted = await executeAndPoll("project-m56-storage-persisted");
  assert(persisted.asset?.recoverable === true, "persisted asset is not recoverable");
  assert(persisted.asset?.storageProvider === "supabase_storage", "persisted asset did not use supabase_storage");
  assert(persisted.bundle.events.some((event) => event.eventType === "asset.persisted"), "persisted case missing asset.persisted");
  assert(persisted.bundle.events.some((event) => event.eventType === "canvas.node.created"), "persisted case missing canvas.node.created");
  assert(persisted.bundle.events.some((event) => event.eventType === "canvas.node.updated"), "persisted case missing canvas.node.updated");

  const failed = await executeAndPoll("project-m56-storage-failed");
  assert(failed.asset?.recoverable === false, "storage failure case should keep asset unrecoverable");
  assert(failed.asset?.storageProvider === "external", "storage failure case should keep external storage");
  assert(Boolean(failed.temporaryExternalAssetWarning), "storage failure case should return temporary external warning");
  assert(failed.bundle.events.some((event) => event.eventType === "asset.not_persisted"), "storage failure case missing asset.not_persisted");
  assert(failed.bundle.canvasGraph.nodes.some((node) => node.versions.some((version) => version.providerTaskId === failed.task.providerTaskId)), "storage failure was not projected to canvas");

  const workspace = buildUiWorkspace([persisted.bundle, failed.bundle], persisted.bundle.project.id);
  const ui = await verifyWorkbenchUi(workspace);
  const replay = await verifyInternalErrorsHiddenAndReplayExported();

  assert(fixtureState.viduCreates === 2, "unexpected provider create call count");
  assert(fixtureState.viduPolls === 2, "unexpected provider poll call count");
  assert(fixtureState.outputDownloads >= 2, `provider output was not downloaded for both cases: ${JSON.stringify({
    outputDownloads: fixtureState.outputDownloads,
    storageUploads: fixtureState.storageUploads.length,
    viduCreates: fixtureState.viduCreates,
    viduPolls: fixtureState.viduPolls
  })}`);
  assert(fixtureState.storageUploads.length === 2, `Supabase upload was not attempted for both cases: ${fixtureState.storageUploads.length}`);
  assert(ui.oldViduRouteCalls === 0, "/api/vidu/generate was called from Workbench");

  console.log(JSON.stringify({
    status: "passed",
    mode: "m56-generation-result-loop",
    origin,
    fixtureOrigin,
    realProviderCalls: fixtureState.viduCreates + fixtureState.viduPolls,
    oldViduRouteCalls: ui.oldViduRouteCalls,
    replay,
    cases: [
      {
        name: "persisted",
        storageProvider: persisted.asset.storageProvider,
        recoverable: persisted.asset.recoverable,
        canvasNodes: persisted.bundle.canvasGraph.nodes.length,
        eventTypes: persisted.bundle.events.map((event) => event.eventType)
      },
      {
        name: "storage-failed",
        storageProvider: failed.asset.storageProvider,
        recoverable: failed.asset.recoverable,
        canvasNodes: failed.bundle.canvasGraph.nodes.length,
        warning: failed.temporaryExternalAssetWarning,
        eventTypes: failed.bundle.events.map((event) => event.eventType)
      }
    ]
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      mode: "m56-generation-result-loop",
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
