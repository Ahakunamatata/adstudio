import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredBaseUrl = process.env.M54_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3010/";
const origin = new URL(configuredBaseUrl).origin;
const workbenchUrl = new URL("/ad-workbench", origin).toString();

const emptyWorkspace = {
  route: "workbench",
  selectedProduct: "",
  setupMode: "clone",
  activeSessionId: null,
  sessions: [],
  artifacts: [],
  eventLog: [],
  projectBundles: []
};

const caseResults = [];
let startedServer = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function waitFor(fn, label, timeoutMs = 10000) {
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
  if (await isServerReady()) return;

  startedServer = spawn("corepack", ["pnpm", "dev"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M54_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M54_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function latestUserText(snapshot) {
  const userMessages = Array.isArray(snapshot?.messages)
    ? snapshot.messages.filter((message) => message?.role === "user" && typeof message.body === "string")
    : [];
  return userMessages.at(-1)?.body ?? "";
}

function decideOutput(snapshot) {
  const text = latestUserText(snapshot);
  const prompt = text || "Create a 5 second vertical mobile app ad for a family location app, realistic lifestyle scene, no text overlay.";
  return {
    message: "可以。我会先给出真实 Vidu 生成确认，确认前不会创建任务。",
    briefPatch: {
      product: "Family Locator",
      originalPrompt: prompt,
      ratio: "9:16",
      duration: "5s"
    },
    questions: [],
    confirmation: {
      id: "m54-real-vidu-confirmation",
      title: "确认真实 Vidu 生成",
      summary: "确认后创建一条 5 秒竖版 Vidu 视频任务，用于 PM 体验真实生成状态恢复。",
      bullets: [
        "确认前不调用 Vidu，也不创建 GenerationTask。",
        "确认后会创建 GenerationTask 并短轮询任务状态。",
        "成功输出仍是 Vidu 临时外链，未转存对象存储。"
      ],
      confirmLabel: "确认生成真实 Vidu",
      secondaryLabel: "先调整"
    },
    generation: {
      kind: "video",
      modelId: "viduq3-turbo",
      modelName: "Vidu Q3 Turbo",
      modeKey: "text-to-video",
      prompt,
      params: {
        ratio: "9:16",
        duration: "5s",
        resolution: "720p"
      },
      slots: []
    },
    canvasActions: []
  };
}

function eventRecord(eventType, objectType, objectId, payload, sequence) {
  return {
    schemaVersion: 1,
    id: `event-m54-${sequence}-${eventType.replace(/[^a-z0-9]+/gi, "-")}`,
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    sequence,
    actorType: eventType.startsWith("generation") || eventType.startsWith("asset") ? "provider" : "system",
    eventType,
    objectType,
    objectId,
    correlationId: payload.approvalRequestId,
    requestId: payload.idempotencyKey,
    payload,
    createdAt: payload.now
  };
}

function getWorkspaceActiveBundle(workspace, projectId) {
  return workspace.projectBundles?.find((bundle) => bundle.project?.id === projectId) ?? null;
}

function createBaseBundle(workspace, body) {
  const now = new Date().toISOString();
  const existing = getWorkspaceActiveBundle(workspace, body.projectId);
  if (existing) return structuredClone(existing);
  return {
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      id: body.projectId,
      title: "M5.4 Workbench Generation",
      mode: "clone",
      lifecycle: "intake",
      activeSessionId: body.projectId,
      createdAt: now,
      updatedAt: now
    },
    sessions: [],
    artifacts: [],
    approvalRequests: [],
    canvasGraph: {
      schemaVersion: 1,
      projectId: body.projectId,
      nodes: [],
      edges: [],
      graphVersion: `graph-${now}`,
      updatedAt: now
    },
    generationTasks: [],
    mediaAssets: [],
    events: [],
    updatedAt: now
  };
}

function upsertWorkspaceBundle(workspace, bundle) {
  workspace.projectBundles = [
    ...(workspace.projectBundles ?? []).filter((item) => item.project?.id !== bundle.project.id),
    bundle
  ];
}

function buildRunningBundle(workspace, body) {
  const now = new Date().toISOString();
  const bundle = createBaseBundle(workspace, body);
  const approval = {
    ...(bundle.approvalRequests.find((record) => record.id === body.approvalRequestId) ?? {
      schemaVersion: 1,
      id: body.approvalRequestId,
      projectId: body.projectId,
      sessionId: body.projectId,
      kind: "generation",
      title: "确认真实 Vidu 生成",
      summary: "确认后创建一条 Vidu 视频任务。",
      requestedActions: [],
      affectedNodeIds: [],
      affectedArtifactIds: [],
      requestedAt: now
    }),
    status: "executing",
    actionHash: body.actionHash,
    idempotencyKey: body.idempotencyKey,
    respondedBy: "user",
    respondedAt: now,
    actualCredits: 0
  };
  const taskId = `generation-task-${hashString(body.idempotencyKey)}`;
  const providerTaskId = `vidu-m54-${hashString(`${body.idempotencyKey}:provider`)}`;
  const task = {
    schemaVersion: 1,
    id: taskId,
    projectId: body.projectId,
    sessionId: body.projectId,
    approvalRequestId: body.approvalRequestId,
    kind: "video",
    surface: "agent",
    provider: "vidu",
    providerTaskId,
    modelId: body.generation.modelId,
    modelName: body.generation.modelName,
    modeKey: body.generation.modeKey,
    prompt: body.generation.prompt,
    params: body.generation.params,
    slots: body.generation.slots ?? [],
    status: "running",
    progress: 35,
    credits: 0,
    idempotencyKey: body.idempotencyKey,
    createdAt: now,
    startedAt: now,
    updatedAt: now
  };
  const eventPayload = {
    projectId: body.projectId,
    sessionId: body.projectId,
    approvalRequestId: body.approvalRequestId,
    idempotencyKey: body.idempotencyKey,
    actionHash: body.actionHash,
    taskId,
    provider: "vidu",
    providerTaskId,
    status: task.status,
    now
  };
  bundle.approvalRequests = [approval, ...bundle.approvalRequests.filter((record) => record.id !== approval.id)];
  bundle.generationTasks = [task, ...bundle.generationTasks.filter((record) => record.id !== task.id)];
  bundle.events = [
    ...bundle.events,
    eventRecord("generation.queued", "generation_task", taskId, eventPayload, bundle.events.length + 1),
    eventRecord("generation.provider_task_created", "generation_task", taskId, eventPayload, bundle.events.length + 2)
  ];
  bundle.updatedAt = now;
  upsertWorkspaceBundle(workspace, bundle);
  return { bundle, approval, task };
}

function buildSucceededBundle(workspace, body) {
  const now = new Date().toISOString();
  const bundle = createBaseBundle(workspace, body);
  const task = bundle.generationTasks.find((record) => record.id === body.taskId || record.providerTaskId === body.providerTaskId);
  assert(task, "poll requested unknown task");
  const approval = bundle.approvalRequests.find((record) => record.id === task.approvalRequestId);
  assert(approval, "poll task has no approval");
  const outputAssetId = `media-asset-${hashString(task.id)}`;
  const nextTask = {
    ...task,
    status: "succeeded",
    progress: 100,
    credits: 55,
    outputAssetId,
    output: {
      kind: "video",
      title: "Vidu video output",
      assetUrl: "https://example.com/m54-vidu-output.mp4",
      downloadUrl: "https://example.com/m54-vidu-output.mp4",
      ratio: "9:16"
    },
    completedAt: now,
    updatedAt: now
  };
  const asset = {
    schemaVersion: 1,
    id: outputAssetId,
    projectId: task.projectId,
    sessionId: task.sessionId,
    kind: "video",
    role: "generated_output",
    source: "generation",
    mimeType: "video/mp4",
    durationMs: 5000,
    storage: {
      provider: "external",
      publicUrl: "https://example.com/m54-vidu-output.mp4",
      signedUrlExpiresAt: "2026-05-24T00:00:00.000Z"
    },
    recoverable: false,
    createdAt: now,
    updatedAt: now
  };
  const nextApproval = {
    ...approval,
    status: "executed",
    actualCredits: 55,
    executedAt: now,
    executionResult: {
      ok: true,
      eventIds: [`event-m54-${bundle.events.length + 1}-asset-not-persisted`, `event-m54-${bundle.events.length + 2}-generation-succeeded`],
      taskIds: [task.id]
    }
  };
  const eventPayload = {
    projectId: task.projectId,
    sessionId: task.sessionId,
    approvalRequestId: approval.id,
    idempotencyKey: task.idempotencyKey,
    actionHash: approval.actionHash,
    taskId: task.id,
    provider: task.provider,
    providerTaskId: task.providerTaskId,
    outputAssetId,
    credits: 55,
    mediaAssetId: asset.id,
    recoverable: false,
    now
  };
  bundle.approvalRequests = [nextApproval, ...bundle.approvalRequests.filter((record) => record.id !== approval.id)];
  bundle.generationTasks = [nextTask, ...bundle.generationTasks.filter((record) => record.id !== task.id)];
  bundle.mediaAssets = [asset, ...bundle.mediaAssets.filter((record) => record.id !== asset.id)];
  bundle.events = [
    ...bundle.events,
    eventRecord("asset.not_persisted", "media_asset", asset.id, eventPayload, bundle.events.length + 1),
    eventRecord("generation.succeeded", "generation_task", task.id, eventPayload, bundle.events.length + 2)
  ];
  bundle.updatedAt = now;
  upsertWorkspaceBundle(workspace, bundle);
  return { bundle, approval: nextApproval, task: nextTask, asset };
}

function buildStillRunningBundle(workspace, body) {
  const now = new Date().toISOString();
  const bundle = createBaseBundle(workspace, body);
  const task = bundle.generationTasks.find((record) => record.id === body.taskId || record.providerTaskId === body.providerTaskId);
  assert(task, "poll requested unknown task");
  const approval = bundle.approvalRequests.find((record) => record.id === task.approvalRequestId);
  assert(approval, "poll task has no approval");
  const nextTask = {
    ...task,
    status: "running",
    progress: Math.max(task.progress ?? 0, 72),
    updatedAt: now
  };
  const eventPayload = {
    projectId: task.projectId,
    sessionId: task.sessionId,
    approvalRequestId: approval.id,
    idempotencyKey: task.idempotencyKey,
    actionHash: approval.actionHash,
    taskId: task.id,
    provider: task.provider,
    providerTaskId: task.providerTaskId,
    status: nextTask.status,
    progress: nextTask.progress,
    now
  };
  bundle.generationTasks = [nextTask, ...bundle.generationTasks.filter((record) => record.id !== task.id)];
  bundle.events = [
    ...bundle.events,
    eventRecord("generation.status_changed", "generation_task", task.id, eventPayload, bundle.events.length + 1)
  ];
  bundle.updatedAt = now;
  upsertWorkspaceBundle(workspace, bundle);
  return { bundle, approval, task: nextTask };
}

function summarizeRouteResult(result, realProviderCalls, idempotent = false) {
  return {
    ok: true,
    status: result.task.status,
    approvalId: result.approval.id,
    approvalStatus: result.approval.status,
    task: {
      id: result.task.id,
      approvalRequestId: result.task.approvalRequestId,
      provider: result.task.provider,
      providerTaskId: result.task.providerTaskId,
      status: result.task.status,
      progress: result.task.progress,
      credits: result.task.credits,
      outputAssetId: result.task.outputAssetId,
      output: result.task.output,
      updatedAt: result.task.updatedAt
    },
    asset: result.asset
      ? {
          id: result.asset.id,
          kind: result.asset.kind,
          source: result.asset.source,
          recoverable: result.asset.recoverable,
          storageProvider: result.asset.storage.provider,
          publicUrl: result.asset.storage.publicUrl,
          signedUrlExpiresAt: result.asset.storage.signedUrlExpiresAt
        }
      : undefined,
    eventIds: result.bundle.events.map((event) => event.id),
    idempotent,
    bundle: result.bundle,
    temporaryExternalAssetWarning: result.asset?.recoverable === false ? "当前输出是 Vidu 临时外链资产，尚未转存对象存储，不能当作长期资产。" : undefined,
    realProviderCalls,
    oldViduRouteCalls: 0
  };
}

async function createMockProviderContext(browser) {
  let workspace = structuredClone(emptyWorkspace);
  const decideCalls = [];
  const generationExecuteCalls = [];
  const generationPollCalls = [];
  const viduGenerateCalls = [];
  let realProviderCreateCalls = 0;
  let realProviderPollCalls = 0;
  const executedKeys = new Set();
  const pollCounts = new Map();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  await context.route("**/api/agent/workspace**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      workspace = request.postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
      return;
    }
    if (request.method() === "DELETE") {
      workspace = structuredClone(emptyWorkspace);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
  });

  await context.route("**/api/vidu/history**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ video: [], image: [] }) });
  });

  await context.route("**/api/vidu/generate**", async (route) => {
    viduGenerateCalls.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 418, contentType: "application/json", body: JSON.stringify({ error: "M5.4 acceptance blocks legacy Vidu route." }) });
  });

  await context.route("**/api/agent/generation/execute", async (route) => {
    const body = route.request().postDataJSON();
    generationExecuteCalls.push(body);
    const idempotent = executedKeys.has(body.idempotencyKey);
    if (!idempotent) {
      executedKeys.add(body.idempotencyKey);
      realProviderCreateCalls += 1;
    }
    const result = buildRunningBundle(workspace, body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summarizeRouteResult(result, idempotent ? 0 : 1, idempotent))
    });
  });

  await context.route("**/api/agent/generation/poll", async (route) => {
    const body = route.request().postDataJSON();
    generationPollCalls.push(body);
    realProviderPollCalls += 1;
    const pollKey = body.taskId ?? body.providerTaskId;
    const nextPollCount = (pollCounts.get(pollKey) ?? 0) + 1;
    pollCounts.set(pollKey, nextPollCount);
    const result = nextPollCount === 1
      ? buildStillRunningBundle(workspace, body)
      : buildSucceededBundle(workspace, body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summarizeRouteResult(result, 1))
    });
  });

  await context.route("**/api/agent/decide", async (route) => {
    const postData = route.request().postDataJSON();
    decideCalls.push({
      snapshot: postData?.snapshot,
      latestUserText: latestUserText(postData?.snapshot)
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        output: decideOutput(postData?.snapshot),
        runtime: {
          configured: true,
          model: "m54-generation-mock",
          apiUrl: "mock://agent"
        }
      })
    });
  });

  return {
    context,
    decideCalls,
    generationExecuteCalls,
    generationPollCalls,
    viduGenerateCalls,
    getProviderCreates: () => realProviderCreateCalls,
    getProviderPolls: () => realProviderPollCalls,
    getWorkspace: () => workspace
  };
}

async function visibleText(page) {
  return cleanText((await page.locator("body").innerText()) ?? "");
}

async function sendMessage(page, text) {
  const input = page.locator(".agent-composer-input");
  await input.fill(text);
  await page.locator(".agent-composer-send").click();
}

async function getLocalWorkspace(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("ad-studio:agent-workspace:v2");
    return raw ? JSON.parse(raw) : null;
  });
}

function getActiveBundle(workspace) {
  const projectId = workspace?.activeSessionId;
  return workspace?.projectBundles?.find((bundle) => bundle?.project?.id === projectId) ?? workspace?.projectBundles?.[0] ?? null;
}

async function waitForBundle(page, predicate, label) {
  return waitFor(async () => {
    const workspace = await getLocalWorkspace(page);
    const bundle = getActiveBundle(workspace);
    return bundle && predicate(bundle) ? bundle : null;
  }, label);
}

async function runWorkbenchGenerationCase(browser) {
  const harness = await createMockProviderContext(browser);
  const page = await harness.context.newPage();

  try {
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await sendMessage(page, "请用真实 Vidu 生成一条 5 秒家庭定位 App 竖版广告");
    await waitFor(async () => (await visibleText(page)).includes("确认真实 Vidu 生成"), "generation confirmation not visible");
    assert(harness.getProviderCreates() === 0, "provider create happened before confirmation");
    assert(harness.generationExecuteCalls.length === 0, "generation execute API was called before confirmation");
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called before confirmation");

    const confirmButton = page.getByRole("button", { name: "确认生成真实 Vidu" });
    await confirmButton.click();
    await confirmButton.click({ timeout: 500 }).catch(() => undefined);

    await waitFor(async () => (await visibleText(page)).includes("running"), "running task status not visible");
    let runningBundle;
    try {
      runningBundle = await waitForBundle(
        page,
        (bundle) =>
          bundle.approvalRequests?.some((approval) => approval.kind === "generation" && approval.status === "executing") &&
          bundle.generationTasks?.some((task) => task.status === "running" && task.provider === "vidu"),
        "running generation task was not persisted"
      );
    } catch (error) {
      if (process.env.M54_ACCEPTANCE_DEBUG) {
        console.error(JSON.stringify(await getLocalWorkspace(page), null, 2));
      }
      throw error;
    }
    assert(runningBundle.mediaAssets.length === 0, "running task should not have a media asset yet");

    await waitFor(async () => (await visibleText(page)).includes("succeeded"), "succeeded task status not visible", 12000);
    const succeededBundle = await waitForBundle(
      page,
      (bundle) =>
        bundle.approvalRequests?.some((approval) => approval.kind === "generation" && approval.status === "executed" && approval.actualCredits === 55) &&
        bundle.generationTasks?.some((task) => task.status === "succeeded" && task.outputAssetId) &&
        bundle.mediaAssets?.some((asset) => asset.source === "generation" && asset.storage?.provider === "external" && asset.recoverable === false) &&
        bundle.events?.some((event) => event.eventType === "generation.succeeded") &&
        bundle.events?.some((event) => event.eventType === "asset.not_persisted"),
      "succeeded generation bundle was not persisted"
    );

    assert(harness.getProviderCreates() === 1, "duplicate confirmation created more than one provider task");
    assert(harness.getProviderPolls() >= 1, "provider poll was not called");
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    await page.reload({ waitUntil: "networkidle" });
    await waitFor(async () => {
      const text = await visibleText(page);
      return text.includes("succeeded") && text.includes("当前输出未转存对象存储");
    }, "succeeded task did not restore after refresh");

    return {
      decideCalls: harness.decideCalls.length,
      generationExecuteCalls: harness.generationExecuteCalls.length,
      generationPollCalls: harness.generationPollCalls.length,
      realProviderCreateCalls: harness.getProviderCreates(),
      realProviderPollCalls: harness.getProviderPolls(),
      viduGenerateCalls: harness.viduGenerateCalls.length,
      taskStatuses: succeededBundle.generationTasks.map((task) => task.status),
      mediaAssets: succeededBundle.mediaAssets.map((asset) => ({
        source: asset.source,
        storageProvider: asset.storage?.provider,
        recoverable: asset.recoverable
      })),
      eventTypes: succeededBundle.events.map((event) => event.eventType)
    };
  } finally {
    await harness.context.close();
  }
}

async function runCase(name, fn) {
  try {
    const details = await fn();
    caseResults.push({ name, status: "passed", details });
  } catch (error) {
    caseResults.push({ name, status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function run() {
  await ensureServer();

  const browser = await chromium.launch({
    channel: process.env.M54_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M54_ACCEPTANCE_HEADFUL !== "1"
  });

  try {
    await runCase("M5.4 mock: confirmed generation creates one task, polls to succeeded, and restores after refresh", () => runWorkbenchGenerationCase(browser));
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    status: "passed",
    mode: "m54-workbench-generation",
    workbenchUrl,
    cases: caseResults
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      mode: "m54-workbench-generation",
      workbenchUrl,
      cases: caseResults,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedServer) startedServer.kill("SIGTERM");
  });
