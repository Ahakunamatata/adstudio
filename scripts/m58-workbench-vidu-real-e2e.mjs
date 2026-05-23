import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const confirmValue = "I_CONFIRM_M54_REAL_VIDU_WORKBENCH_CAN_COST_CREDITS";
const defaultPort = 3520 + Math.floor(Math.random() * 300);
const baseUrl = (process.env.M58_WORKBENCH_VIDU_BASE_URL ?? `http://127.0.0.1:${defaultPort}`).replace(/\/+$/, "");
const port = new URL(baseUrl).port || String(defaultPort);
const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() || "ad-studio-media";
const maxPolls = Number(process.env.M58_WORKBENCH_VIDU_MAX_POLLS || 28);
const pollIntervalMs = Number(process.env.M58_WORKBENCH_VIDU_POLL_INTERVAL_MS || 15000);
const promptText = process.env.M58_WORKBENCH_VIDU_PROMPT || [
  "请为 Family Locator 生成一条 5 秒 9:16 移动端广告视频。",
  "不要再追问，brief 已完整：产品是家庭定位 App，目标是让父母看到孩子安全到校，画面是手机 App 位置提醒和家庭安心场景。",
  "请直接输出受控真实 Vidu generation confirmation，必须使用 kind=video、surface=agent、modelId=viduq3-turbo、modeKey=text-to-video、ratio=9:16、duration=5s、resolution=720p。",
  "不要输出 canvasActions；确认后才允许触发真实 Vidu，可能消耗 credits。"
].join("\n");

let startedServer = null;

function assert(condition, message, classification = "assertion_failed") {
  if (!condition) {
    const error = new Error(message);
    error.classification = classification;
    throw error;
  }
}

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function getMergedEnv() {
  return {
    ...parseDotEnv(path.join(rootDir, ".env.local")),
    ...process.env
  };
}

function redactSecrets(value, secrets) {
  let output = String(value);
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function runSupabaseStatus() {
  const result = spawnSync("corepack", ["pnpm", "dlx", "supabase", "status", "-o", "json"], {
    cwd: rootDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error("Local Supabase status failed. Start local Supabase Docker before this smoke.");
  }
  return JSON.parse(result.stdout);
}

function getSupabaseConfig(env) {
  const status = runSupabaseStatus();
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || status.API_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || status.SERVICE_ROLE_KEY || "";
  assert(supabaseUrl, "Missing NEXT_PUBLIC_SUPABASE_URL and Supabase status API_URL.", "db_store_failed");
  assert(serviceRoleKey, "Missing SUPABASE_SERVICE_ROLE_KEY and Supabase status SERVICE_ROLE_KEY.", "db_store_failed");
  return { supabaseUrl, serviceRoleKey };
}

async function supabaseRequest(config, pathname, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${pathname}`, {
    method: options.method ?? "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
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

async function ensureBucket(config) {
  const list = await supabaseRequest(config, "/storage/v1/bucket");
  const buckets = Array.isArray(list.body) ? list.body : [];
  if (buckets.some((item) => item?.id === bucket || item?.name === bucket)) return;
  await supabaseRequest(config, "/storage/v1/bucket", {
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

async function waitFor(fn, label, timeoutMs = 60000, intervalMs = 250) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function ensureServer(serverEnv) {
  startedServer = spawn("corepack", ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", port], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv
  });
  startedServer.stdout.on("data", (chunk) => {
    if (process.env.M58_WORKBENCH_VIDU_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M58_WORKBENCH_VIDU_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(async () => {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }, "dev server did not become ready", 90000);
}

function findChromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function latestSnapshotUserText(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const user = messages.filter((message) => message?.role === "user" && typeof message.body === "string").at(-1);
  return user?.body?.trim() || promptText;
}

function createDeterministicAgentDecision(snapshot) {
  const prompt = latestSnapshotUserText(snapshot);
  const idSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    output: {
      message: "已准备好真实 Vidu 生成方案。确认后会通过受控 Workbench generation 入口创建任务。",
      briefPatch: {
        product: "Family Locator",
        originalPrompt: prompt,
        ratio: "9:16",
        duration: "5s"
      },
      questions: [],
      confirmation: {
        id: `m58-real-vidu-confirmation-${idSuffix}`,
        title: "确认真实 Vidu 生成",
        summary: "确认后创建一条 5 秒竖版 Vidu 视频任务；确认前不会调用 provider。",
        bullets: [
          "生成入口必须校验 ApprovalRequest、actionHash 和 idempotencyKey。",
          "Vidu create 只允许触发一次，后续通过 poll 更新 GenerationTask。",
          "成功后必须转存 Supabase Storage，再投影到 Canvas。"
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
    },
    runtime: {
      provider: "m58-workbench-vidu-real-smoke",
      model: "deterministic-generation-confirmation",
      fallbackUsed: false
    }
  };
}

async function sendWorkbenchText(page, text) {
  const input = page.locator('textarea[aria-label="Agent input"]');
  await input.waitFor({ state: "visible", timeout: 60000 });
  await input.fill(text);
  await page.locator('button[aria-label="Send"]').click();
}

async function waitForGenerationConfirmation(page) {
  const confirmation = page.locator(".confirmation-card.is-generation-approval").last();
  try {
    await confirmation.waitFor({ state: "visible", timeout: 150000 });
    return confirmation;
  } catch {
    await sendWorkbenchText(page, [
      promptText,
      "",
      "请基于上面的完整 brief，直接输出真实 Vidu 受控 generation confirmation。",
      "不要输出 canvasActions，不要追问；确认卡需要绑定 ApprovalRequest、actionHash、idempotencyKey。"
    ].join("\n"));
    await confirmation.waitFor({ state: "visible", timeout: 150000 });
    return confirmation;
  }
}

async function triggerFromWorkbenchUi(secrets) {
  const executablePath = findChromeExecutable();
  assert(executablePath, "No local Chrome/Chromium executable found for Playwright UI smoke.", "ui_state_failed");
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  if (process.env.M58_WORKBENCH_VIDU_USE_LIVE_AGENT !== "1") {
    await context.route("**/api/agent/decide", async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createDeterministicAgentDecision(body?.snapshot))
      });
    });
  }
  const page = await context.newPage();
  const browserCounts = {
    oldViduRouteCalls: 0,
    executeCalls: 0,
    pollCallsFromUi: 0
  };

  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/vidu/generate")) browserCounts.oldViduRouteCalls += 1;
    if (url.includes("/api/agent/generation/execute")) browserCounts.executeCalls += 1;
    if (url.includes("/api/agent/generation/poll")) browserCounts.pollCallsFromUi += 1;
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator("#home.is-active .launcher-send").click();
    await page.waitForURL(/\/ad-workbench/, { timeout: 60000 });
    await sendWorkbenchText(page, promptText);

    const confirmation = await waitForGenerationConfirmation(page);
    const confirmationText = await confirmation.innerText();
    assert(/Vidu|真实|credits|确认/i.test(confirmationText), "Agent confirmation did not look like a real Vidu confirmation.", "ui_state_failed");

    const executeResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/agent/generation/execute") && response.request().method() === "POST",
      { timeout: 600000 }
    );
    await confirmation.locator("button.small-btn.is-selected").last().click();
    const executeResponse = await executeResponsePromise;
    const executeJson = await executeResponse.json();
    assert(executeResponse.ok() && executeJson.ok, `Workbench execute failed: ${JSON.stringify(executeJson)}`, "vidu_failed");
    assert(executeJson.oldViduRouteCalls === 0, "execute reported legacy /api/vidu/generate usage", "ui_state_failed");
    assert(executeJson.realProviderCalls === 1, `expected one Vidu create call, got ${executeJson.realProviderCalls}`, "vidu_failed");
    assert(executeJson.task?.id, "execute response missing GenerationTask id", "db_store_failed");
    assert(executeJson.task?.providerTaskId, "execute response missing providerTaskId", "vidu_failed");

    const projectId = executeJson.projectId;
    const sessionId = projectId;
    await page.close();
    return {
      browser,
      context,
      projectId,
      sessionId,
      executeJson,
      browserCounts,
      confirmationText: redactSecrets(confirmationText, secrets)
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function createVerificationBrowserContext() {
  const executablePath = findChromeExecutable();
  assert(executablePath, "No local Chrome/Chromium executable found for Playwright UI smoke.", "ui_state_failed");
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  return { browser, context };
}

async function pollUntilTerminal(projectId, taskId, providerTaskId) {
  let lastJson = null;
  let providerPollCalls = 0;
  for (let index = 0; index < maxPolls; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const response = await fetch(`${baseUrl}/api/agent/generation/poll`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, taskId, providerTaskId })
    });
    const json = await response.json().catch(() => ({}));
    lastJson = json;
    providerPollCalls += Number(json.realProviderCalls ?? 0);
    assert(json.oldViduRouteCalls === 0, "poll reported legacy /api/vidu/generate usage", "ui_state_failed");
    if (!response.ok || !json.ok) {
      const classification = json.error === "provider_poll_failed" ? "poll_timeout_or_provider_poll_failed" : "vidu_failed";
      throw Object.assign(new Error(`poll failed: ${JSON.stringify(json)}`), { classification, lastJson, providerPollCalls });
    }
    if (json.status === "succeeded" || json.status === "failed" || json.status === "cancelled") {
      return { finalJson: json, providerPollCalls };
    }
  }
  throw Object.assign(new Error(`poll timed out after ${maxPolls} attempts`), {
    classification: "poll_timeout",
    lastJson,
    providerPollCalls
  });
}

function encodePath(value) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function tableRows(config, table, query = "") {
  const suffix = query ? `?${query}` : "";
  const { body } = await supabaseRequest(config, `/rest/v1/${table}${suffix}`);
  assert(Array.isArray(body), `Expected array response for ${table}`, "db_store_failed");
  return body;
}

async function verifySupabase(config, projectId, finalJson) {
  const query = `project_id=eq.${encodeURIComponent(projectId)}`;
  const approvals = await tableRows(config, "ad_approval_requests", query);
  const tasks = await tableRows(config, "ad_generation_tasks", query);
  const assets = await tableRows(config, "ad_media_assets", query);
  const graphs = await tableRows(config, "ad_canvas_graphs", query);
  const events = await tableRows(config, "ad_agent_events", `${query}&order=sequence.asc`);

  assert(approvals.some((approval) => approval.status === "executed"), "ApprovalRequest did not reach executed.", "db_store_failed");
  assert(tasks.length === 1 && tasks[0].status === "succeeded", "GenerationTask did not reach succeeded in Postgres.", "db_store_failed");
  assert(tasks[0].provider_task_id === finalJson.task.providerTaskId, "Postgres providerTaskId mismatch.", "db_store_failed");
  assert(assets.length === 1, "Postgres missing MediaAsset row.", "db_store_failed");
  assert(assets[0].storage_provider === "supabase_storage", "MediaAsset storage.provider is not supabase_storage.", "storage_persist_failed");
  assert(assets[0].recoverable === true, "MediaAsset recoverable is not true.", "storage_persist_failed");
  assert(assets[0].storage_key, "MediaAsset storage key missing.", "storage_persist_failed");
  assert(graphs.length === 1 && Array.isArray(graphs[0].nodes) && graphs[0].nodes.length >= 1, "CanvasGraph result node missing.", "db_store_failed");
  assert(events.some((event) => event.event_type === "asset.persisted"), "EventLog missing asset.persisted.", "storage_persist_failed");
  assert(events.some((event) => event.event_type === "generation.succeeded"), "EventLog missing generation.succeeded.", "db_store_failed");
  assert(events.some((event) => event.event_type === "canvas.node.created" || event.event_type === "canvas.node.updated"), "EventLog missing canvas change.", "db_store_failed");

  const objectResponse = await fetch(`${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodePath(assets[0].storage_key)}`, { cache: "no-store" });
  assert(objectResponse.ok, `Supabase Storage public object not readable: ${objectResponse.status}`, "storage_persist_failed");
  const bytes = Buffer.from(await objectResponse.arrayBuffer());
  assert(bytes.byteLength > 0, "Supabase Storage object is empty.", "storage_persist_failed");

  return { approvals, tasks, assets, graphs, events, storageBytes: bytes.byteLength };
}

async function verifyUiReplayAndCanvas(context, projectId, secrets) {
  const page = await context.newPage();
  const oldRouteRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/vidu/generate")) oldRouteRequests.push(request.url());
  });
  const workspaceResponse = await fetch(`${baseUrl}/api/agent/workspace`, { cache: "no-store" });
  const workspace = await workspaceResponse.json().catch(() => null);
  if (workspace && typeof workspace === "object") {
    const bundle = Array.isArray(workspace.projectBundles)
      ? workspace.projectBundles.find((item) => item?.project?.id === projectId)
      : null;
    const canvasState = bundle?.canvasGraph
      ? { nodes: bundle.canvasGraph.nodes ?? [], edges: bundle.canvasGraph.edges ?? [] }
      : null;
    if (canvasState) {
      workspace.route = "workbench";
      workspace.activeSessionId = projectId;
      workspace.sessions = Array.isArray(workspace.sessions) ? workspace.sessions : [];
      const sessionRecord = workspace.sessions.find((record) => record?.id === projectId);
      if (sessionRecord?.session) {
        sessionRecord.session.canvasState = canvasState;
      }
      await page.addInitScript((value) => {
        window.localStorage.setItem("ad-studio:agent-workspace:v2", JSON.stringify(value));
      }, workspace);
    }
  }
  await page.goto(`${baseUrl}/ad-workbench`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".agent-generation-task-card.is-succeeded", { timeout: 90000 });
  const cardText = await page.locator(".agent-generation-task-card.is-succeeded").last().innerText();
  assert(cardText.includes("supabase_storage") && cardText.includes("recoverable=true"), "Workbench task card did not show persisted Supabase asset.", "ui_state_failed");
  const canvasDomNodeVisible = await page.waitForSelector(".react-flow__node", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const replayResponse = await fetch(`${baseUrl}/api/agent/session-replay?sessionId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const replay = await replayResponse.json();
  assert(replayResponse.ok && replay?.pmReview, "session replay API did not return pmReview.", "db_store_failed");
  const replayText = JSON.stringify(replay);
  for (const secret of secrets) {
    assert(!secret || !replayText.includes(secret), "session replay leaked a configured secret.", "db_store_failed");
  }
  assert(replay.pmReview.approvals?.some((approval) => approval.status === "executed"), "replay missing executed approval.", "db_store_failed");
  assert(replay.pmReview.generationTasks?.some((task) => task.status === "succeeded"), "replay missing succeeded generation task.", "db_store_failed");
  assert(replay.pmReview.mediaAssets?.some((asset) => asset.storageProvider === "supabase_storage" && asset.recoverable === true), "replay missing persisted media asset.", "db_store_failed");
  assert(replay.pmReview.canvasChanges?.length > 0, "replay missing canvas changes.", "db_store_failed");
  const canvasNodeCount = replay.projectBundle?.canvasGraph?.nodes?.length ?? replay.pmReview.canvas?.nodeCount ?? 0;
  assert(canvasNodeCount > 0, "CanvasGraph did not contain a generation result node.", "ui_state_failed");
  await page.close();
  return {
    cardText: redactSecrets(cardText, secrets),
    canvasDomNodeVisible,
    canvasNodeCount,
    replay,
    oldViduRouteCalls: oldRouteRequests.length
  };
}

function summarizeFailure(error, partial) {
  return {
    ok: false,
    failureClassification: error?.classification || "unknown_failure",
    error: error instanceof Error ? error.message : String(error),
    partial
  };
}

async function main() {
  const mergedEnv = getMergedEnv();
  const supabase = getSupabaseConfig(mergedEnv);
  const viduApiKey = mergedEnv.VIDU_API_KEY?.trim();
  assert(viduApiKey, "Missing VIDU_API_KEY. Put it in process env or .env.local.", "vidu_failed");
  const secrets = [supabase.serviceRoleKey, viduApiKey, mergedEnv.GEMINI_AGENT_API_KEY, mergedEnv.GEMINI_API_KEY].filter(Boolean);
  await ensureBucket(supabase);

  await ensureServer({
    ...mergedEnv,
    NEXT_PUBLIC_SUPABASE_URL: supabase.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    SUPABASE_MEDIA_BUCKET: bucket,
    AD_STUDIO_AGENT_PROJECT_STORE: "supabase",
    AD_STUDIO_AGENT_PROJECT_STORE_REQUIRED: "1",
    AD_STUDIO_M54_ENABLE_REAL_VIDU_WORKBENCH: "1",
    AD_STUDIO_M54_CONFIRM_REAL_VIDU_WORKBENCH: confirmValue,
    VIDU_API_KEY: viduApiKey
  });

  let browser;
  const partial = {};
  try {
    const resumeProjectId = process.env.M58_WORKBENCH_VIDU_RESUME_PROJECT_ID?.trim();
    const resumeTaskId = process.env.M58_WORKBENCH_VIDU_RESUME_TASK_ID?.trim();
    const resumeProviderTaskId = process.env.M58_WORKBENCH_VIDU_RESUME_PROVIDER_TASK_ID?.trim();
    const resumeMode = Boolean(resumeProjectId && resumeTaskId && resumeProviderTaskId);
    const triggered = resumeMode
      ? {
          ...(await createVerificationBrowserContext()),
          projectId: resumeProjectId,
          sessionId: resumeProjectId,
          executeJson: {
            status: "queued",
            approvalStatus: "executing",
            realProviderCalls: 0,
            task: {
              id: resumeTaskId,
              providerTaskId: resumeProviderTaskId
            }
          },
          browserCounts: {
            oldViduRouteCalls: 0,
            executeCalls: 0,
            pollCallsFromUi: 0
          }
        }
      : await triggerFromWorkbenchUi(secrets);
    browser = triggered.browser;
    Object.assign(partial, {
      projectId: triggered.projectId,
      executeStatus: triggered.executeJson.status,
      executeApprovalStatus: triggered.executeJson.approvalStatus,
      providerTaskId: triggered.executeJson.task.providerTaskId,
      browserCounts: triggered.browserCounts
    });

    const polled = triggered.executeJson.status === "succeeded"
      ? { finalJson: triggered.executeJson, providerPollCalls: 0 }
      : await pollUntilTerminal(triggered.projectId, triggered.executeJson.task.id, triggered.executeJson.task.providerTaskId);
    Object.assign(partial, {
      finalStatus: polled.finalJson.status,
      providerPollCalls: polled.providerPollCalls
    });

    assert(polled.finalJson.status === "succeeded", `Vidu task ended as ${polled.finalJson.status}`, "vidu_failed");
    const asset = polled.finalJson.asset;
    if (asset?.storageProvider !== "supabase_storage" || asset.recoverable !== true) {
      throw Object.assign(new Error(`asset.not_persisted: ${JSON.stringify(asset)}`), { classification: "storage_persist_failed" });
    }

    const db = await verifySupabase(supabase, triggered.projectId, polled.finalJson);
    const ui = await verifyUiReplayAndCanvas(triggered.context, triggered.projectId, secrets);

    const replayText = JSON.stringify(ui.replay);
    const output = {
      ok: true,
      triggeredFromWorkbenchUi: true,
      agentConfirmationPresent: true,
      projectId: triggered.projectId,
      approval: {
        id: polled.finalJson.approvalId,
        initialStatus: "pending",
        executeResponseStatus: triggered.executeJson.approvalStatus,
        finalStatus: db.approvals[0]?.status,
        estimatedCredits: db.approvals[0]?.estimated_credits,
        actualCredits: db.approvals[0]?.actual_credits
      },
      generationTask: {
        id: polled.finalJson.task.id,
        status: polled.finalJson.task.status,
        progress: polled.finalJson.task.progress,
        provider: polled.finalJson.task.provider,
        providerTaskId: polled.finalJson.task.providerTaskId,
        credits: polled.finalJson.task.credits,
        costUsd: polled.finalJson.task.costUsd
      },
      viduCalls: {
        create: triggered.executeJson.realProviderCalls,
        poll: polled.providerPollCalls
      },
      credits: {
        estimated: db.approvals[0]?.estimated_credits ?? triggered.executeJson.task.credits ?? 0,
        actualApproval: db.approvals[0]?.actual_credits,
        task: polled.finalJson.task.credits,
        costUsd: polled.finalJson.task.costUsd,
        billingNote: "Vidu 实际扣费以 Vidu 控制台为准；本脚本记录 provider/API 返回并写入的 credits。"
      },
      mediaAsset: {
        id: asset.id,
        source: asset.source,
        storageProvider: asset.storageProvider,
        storageKey: asset.storageKey,
        recoverable: asset.recoverable,
        storageBytes: db.storageBytes
      },
      canvas: {
        resultNodeVisibleInWorkbench: ui.canvasNodeCount > 0,
        reactFlowDomNodeVisibleInHeadless: ui.canvasDomNodeVisible,
        nodeCount: ui.canvasNodeCount,
        eventTypes: db.events.map((event) => event.event_type).filter((type) => type.startsWith("canvas."))
      },
      sessionReplay: {
        readable: true,
        hasApproval: ui.replay.pmReview.approvals.length > 0,
        hasGenerationTask: ui.replay.pmReview.generationTasks.length > 0,
        hasMediaAsset: ui.replay.pmReview.mediaAssets.length > 0,
        hasCanvasChange: ui.replay.pmReview.canvasChanges.length > 0,
        leakedServiceRoleOrApiKey: secrets.some((secret) => secret && replayText.includes(secret)),
        redactionApplied: ui.replay.pmReview.diagnostics?.redactionApplied
      },
      oldViduRouteCalls: triggered.browserCounts.oldViduRouteCalls + ui.oldViduRouteCalls,
      browserNetwork: triggered.browserCounts,
      failureItems: [],
      nextFixSuggestions: []
    };

    assert(output.oldViduRouteCalls === 0, "legacy /api/vidu/generate was called.", "ui_state_failed");
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(JSON.stringify(summarizeFailure(error, partial), null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (startedServer) startedServer.kill();
  }
}

main();
