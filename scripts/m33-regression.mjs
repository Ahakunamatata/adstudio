import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredBaseUrl = process.env.M33_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3010/";
const origin = new URL(configuredBaseUrl).origin;
const homeUrl = new URL("/", origin).toString();
const workbenchUrl = new URL("/ad-workbench", origin).toString();

const internalTerms = [
  "fallbackUsed",
  "fallbackReason",
  "runtime",
  "workspace",
  "snapshot",
  "schema",
  "Zod",
  "structured fact",
  "Agent LLM 决策失败",
  "M3.2",
  "provider"
];

const emptyWorkspace = {
  route: "workbench",
  selectedProduct: "",
  setupMode: "clone",
  activeSessionId: null,
  sessions: [],
  artifacts: [],
  eventLog: []
};

const caseResults = [];
let startedServer = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function waitFor(fn, label, timeoutMs = 8000) {
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
    if (process.env.M33_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M33_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function latestUserText(snapshot) {
  const userMessages = Array.isArray(snapshot?.messages)
    ? snapshot.messages.filter((message) => message?.role === "user" && typeof message.body === "string")
    : [];
  return userMessages.at(-1)?.body ?? "";
}

function cloneIntakeQuestion({ productRequired = true } = {}) {
  return {
    id: productRequired ? "m33-clone-intake" : "m33-clone-reference-first",
    title: productRequired ? "补齐复刻任务信息" : "先保存竞品参考信息",
    description: productRequired
      ? "先把参考素材、推广产品和参考程度补齐。"
      : "产品可以稍后补。先把竞品素材或描述保存下来。",
    submitLabel: productRequired ? "提交信息" : "保存参考信息",
    fields: [
      {
        id: "reference_upload",
        label: "参考广告素材",
        type: "upload",
        required: true,
        requiredGroup: "reference",
        requiredGroupLabel: "参考广告素材或描述",
        uploadRole: "competitor_asset",
        accept: "image/*,video/*",
        multiple: true,
        placeholder: "上传竞品图片或视频"
      },
      {
        id: "reference_description",
        label: "参考广告描述",
        type: "textarea",
        required: true,
        requiredGroup: "reference",
        requiredGroupLabel: "参考广告素材或描述",
        placeholder: "也可以先描述你想参考的广告内容"
      },
      {
        id: "product_asset",
        label: "我的产品 / 要推广的产品",
        type: "product_asset",
        required: productRequired,
        help: productRequired ? "选择已有产品资产包，或粘贴产品链接解析。" : "可以稍后补产品，或先粘贴产品链接。"
      },
      {
        id: "reference_mode",
        label: "复刻参考方式",
        type: "radio",
        display: "segmented",
        required: productRequired,
        options: [
          {
            id: "strict_plot",
            label: "严格复刻剧情结构",
            description: "保留故事线、情绪转折和卖点植入位置。"
          },
          {
            id: "structure_only",
            label: "只参考节奏结构",
            description: "只迁移 Hook、节奏和信息层级。"
          },
          {
            id: "visual_style_only",
            label: "只参考视觉风格",
            description: "只参考画面质感、构图、色彩和剪辑氛围。"
          }
        ]
      }
    ]
  };
}

function decideOutput(snapshot) {
  const text = latestUserText(snapshot);

  if (Array.isArray(snapshot?.intakeSubmissions) && snapshot.intakeSubmissions.length > 0) {
    return {
      message: "已收到这批信息。我会把已提交的产品和参考素材作为当前任务上下文，下一步只需要补充投放目标和时长。",
      briefPatch: {
        product: snapshot.session?.product || "已选产品",
        competitorAsset: snapshot.session?.competitor || "已填写参考素材"
      },
      questions: [
        {
          id: "m33-delivery-settings",
          title: "补充投放设置",
          description: "参考素材和产品已经收到，只补充还缺的投放边界。",
          submitLabel: "保存设置",
          fields: [
            {
              id: "market_language",
              label: "投放国家或语言",
              type: "text",
              required: true,
              placeholder: "例如：美国 / 英语"
            },
            {
              id: "duration",
              label: "视频目标时长",
              type: "text",
              required: false,
              placeholder: "例如：15s 或 30s"
            }
          ]
        }
      ],
      confirmation: null,
      canvasActions: []
    };
  }

  if (/^hi$|你好|你是谁|help|怎么用/i.test(text.trim())) {
    return {
      message: "你好，我在。你可以告诉我想复刻竞品广告、从零做广告，或者先上传参考素材。",
      briefPatch: {},
      questions: [],
      confirmation: null,
      canvasActions: []
    };
  }

  if (/复刻/.test(text)) {
    return {
      message: "可以。先补齐参考广告、推广产品和你希望参考的程度。",
      briefPatch: {
        originalPrompt: text
      },
      questions: [cloneIntakeQuestion({ productRequired: true })],
      confirmation: null,
      canvasActions: []
    };
  }

  return {
    message: "收到，我会基于你刚补充的信息继续判断下一步。",
    briefPatch: {},
    questions: [],
    confirmation: null,
    canvasActions: []
  };
}

async function createMockProviderContext(browser) {
  let workspace = structuredClone(emptyWorkspace);
  const decideCalls = [];
  const viduGenerateCalls = [];
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ video: [], image: [] })
    });
  });

  await context.route("**/api/vidu/generate**", async (route) => {
    viduGenerateCalls.push({
      method: route.request().method(),
      url: route.request().url()
    });
    await route.fulfill({
      status: 418,
      contentType: "application/json",
      body: JSON.stringify({ error: "M3.3 regression blocks media generation." })
    });
  });

  await context.route("**/api/product/extract**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        product: {
          id: "product-location-tracker",
          name: "location tracker",
          type: "App",
          summary: "Location tracking app",
          description: "A location tracker product for family safety ads.",
          assets: 1,
          images: []
        }
      })
    });
  });

  await context.route("**/api/agent/decide", async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();
    decideCalls.push({
      url: request.url(),
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
          model: "m33-regression-mock",
          apiUrl: "mock://agent"
        }
      })
    });
  });

  return {
    context,
    decideCalls,
    viduGenerateCalls,
    getWorkspace: () => workspace
  };
}

async function createProviderSmokeContext(browser) {
  let workspace = structuredClone(emptyWorkspace);
  const viduGenerateCalls = [];
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });

  await context.route("**/api/agent/workspace**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      workspace = request.postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspace) });
  });

  await context.route("**/api/vidu/history**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ video: [], image: [] })
    });
  });

  await context.route("**/api/vidu/generate**", async (route) => {
    viduGenerateCalls.push({
      method: route.request().method(),
      url: route.request().url()
    });
    await route.fulfill({
      status: 418,
      contentType: "application/json",
      body: JSON.stringify({ error: "M3.3 provider smoke blocks media generation." })
    });
  });

  return {
    context,
    viduGenerateCalls,
    getWorkspace: () => workspace
  };
}

async function sendMessage(page, text) {
  const input = page.locator(".agent-composer-input");
  await input.fill(text);
  await page.locator(".agent-composer-send").click();
}

async function visibleText(page) {
  return cleanText((await page.locator("body").innerText()) ?? "");
}

async function assertNoInternalTerms(page) {
  const text = await visibleText(page);
  const leaked = internalTerms.filter((term) => text.includes(term));
  assert(leaked.length === 0, `UI leaked internal terms: ${leaked.join(", ")}`);
}

async function assertCanvasZero(page) {
  const text = await visibleText(page);
  assert(text.includes("0 nodes · 0 links · 0 credits"), "canvas did not remain 0 nodes / 0 links / 0 credits");
}

async function getWorkspaceState(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("ad-studio:agent-workspace:v2");
    return raw ? JSON.parse(raw) : null;
  });
}

async function getRuntimeStates(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("ad-studio:agent-runtime:chat-only:v1:"))
        .map((key) => [key, JSON.parse(window.localStorage.getItem(key) ?? "null")])
    )
  );
}

async function fillHomePromptAndCreate(page, text) {
  const prompt = page.locator(".agent-launcher-shell .launcher-prompt").first();
  await waitFor(async () => await prompt.isVisible(), "home Agent launcher prompt not visible");
  await prompt.fill(text);
  const createButton = page.locator(".agent-launcher-shell .launcher-send").first();
  await waitFor(async () => await createButton.isEnabled(), "home create task button not enabled");
  await createButton.click();
}

async function spawnAndCapture(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (process.env.M33_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (process.env.M33_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function parseAcceptanceReport(stdout) {
  const marker = '{\n  "status"';
  const start = stdout.lastIndexOf(marker);
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

async function runM32Baseline() {
  const { stdout } = await spawnAndCapture(process.execPath, ["scripts/m32-acceptance.mjs"], {
    env: {
      ...process.env,
      M32_ACCEPTANCE_BASE_URL: workbenchUrl
    }
  });
  const report = parseAcceptanceReport(stdout);
  assert(report?.status === "passed", "M3.2 acceptance did not return a passed report");
  return {
    delegatedScript: "scripts/m32-acceptance.mjs",
    caseCount: report.cases?.length ?? 0,
    cases: report.cases?.map((item) => item.name) ?? []
  };
}

async function runReferenceDescriptionCase(browser) {
  const harness = await createMockProviderContext(browser);
  const page = await harness.context.newPage();

  try {
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await sendMessage(page, "我要复刻一个广告");
    await waitFor(() => harness.decideCalls.length === 1, "clone request did not call /api/agent/decide");
    await waitFor(async () => (await visibleText(page)).includes("补齐复刻任务信息"), "clone intake card not visible");

    const card = page.locator(".question-card").first();
    const submitButton = card.getByRole("button", { name: /提交信息|继续/ });
    await waitFor(async () => !(await submitButton.isEnabled()), "submit should be disabled before required fields");
    await card.locator("textarea").first().fill("参考广告开头是强 Hook，中段展示家庭安全焦虑，结尾 CTA 下载。");
    await card.locator(".agent-product-card").first().click();
    await card.locator(".agent-option-grid button").first().click();
    await waitFor(async () => await submitButton.isEnabled(), "submit not enabled after text reference and product");
    await submitButton.click();

    await waitFor(() => harness.decideCalls.length === 2, "text card submit did not re-enter /api/agent/decide");
    await waitFor(async () => (await visibleText(page)).includes("补充投放设置"), "Agent did not continue after text reference submission");
    await assertNoInternalTerms(page);
    await assertCanvasZero(page);
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    const runtimeStates = await getRuntimeStates(page);
    const activeRuntime = Object.values(runtimeStates).find((runtime) => Array.isArray(runtime?.intakeSubmissions));
    assert(
      JSON.stringify(activeRuntime?.intakeSubmissions ?? []).includes("参考广告开头是强 Hook"),
      "reference description was not persisted in intakeSubmissions"
    );

    return {
      decideCalls: harness.decideCalls.length,
      viduGenerateCalls: harness.viduGenerateCalls.length,
      intakeSubmissions: activeRuntime?.intakeSubmissions?.length ?? 0
    };
  } finally {
    await harness.context.close();
  }
}

async function runHomepageSecondTaskCase(browser) {
  const harness = await createMockProviderContext(browser);
  const page = await harness.context.newPage();
  const firstPrompt = "我要复刻一个广告，第一条任务";
  const secondPrompt = "我要复刻一个广告，第二条任务";

  try {
    await page.goto(homeUrl, { waitUntil: "networkidle" });
    await fillHomePromptAndCreate(page, firstPrompt);
    await waitFor(() => harness.decideCalls.length === 1, "first home task did not call /api/agent/decide", 12000);
    await waitFor(async () => (await visibleText(page)).includes("补齐复刻任务信息"), "first home task did not reach workbench intake");
    await assertNoInternalTerms(page);
    await assertCanvasZero(page);

    const firstWorkspace = await waitFor(async () => {
      const workspace = await getWorkspaceState(page);
      return workspace?.activeSessionId ? workspace : null;
    }, "first task was not written to workspace");
    const firstSessionId = firstWorkspace.activeSessionId;

    await page.goto(homeUrl, { waitUntil: "networkidle" });
    await fillHomePromptAndCreate(page, secondPrompt);
    await waitFor(() => harness.decideCalls.length === 2, "second home task did not call /api/agent/decide", 12000);
    await waitFor(async () => (await visibleText(page)).includes("补齐复刻任务信息"), "second home task did not reach workbench intake");
    await assertNoInternalTerms(page);
    await assertCanvasZero(page);
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    const workspace = await waitFor(async () => {
      const value = await getWorkspaceState(page);
      return value?.sessions?.length >= 2 ? value : null;
    }, "second task did not create a separate workspace session");
    const activeSessionId = workspace.activeSessionId;
    const firstRecord = workspace.sessions.find((item) => item.id === firstSessionId);
    const activeRecord = workspace.sessions.find((item) => item.id === activeSessionId);
    assert(firstRecord, "first session disappeared after creating second task");
    assert(activeRecord, "active second session is missing");
    assert(activeSessionId !== firstSessionId, "second home task reused the first session");
    assert(firstRecord.session.originalPrompt.includes("第一条任务"), "first session did not keep its own prompt");
    assert(!firstRecord.session.originalPrompt.includes("第二条任务"), "first session was polluted by second prompt");
    assert(activeRecord.session.originalPrompt.includes("第二条任务"), "second session did not receive the second prompt");

    const [firstCall, secondCall] = harness.decideCalls;
    assert(firstCall.snapshot?.session?.id !== secondCall.snapshot?.session?.id, "second decision reused first snapshot session id");
    assert(secondCall.latestUserText.includes("第二条任务"), "second decision snapshot did not include second prompt");

    return {
      decideCalls: harness.decideCalls.length,
      viduGenerateCalls: harness.viduGenerateCalls.length,
      sessionCount: workspace.sessions.length,
      firstSessionId,
      activeSessionId
    };
  } finally {
    await harness.context.close();
  }
}

async function runRealProviderSmoke(browser) {
  const harness = await createProviderSmokeContext(browser);
  const page = await harness.context.newPage();
  const decideResponses = [];

  page.on("response", (response) => {
    if (response.url().includes("/api/agent/decide")) {
      decideResponses.push({ status: response.status(), url: response.url() });
    }
  });

  try {
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await sendMessage(page, "hi");
    await waitFor(async () => {
      const text = await visibleText(page);
      return (
        decideResponses.length > 0 ||
        text.includes("重新连接 Agent") ||
        text.includes("连接失败") ||
        text.includes("请求超时") ||
        text.includes("这次没有生成有效回复") ||
        text.includes("你好")
      );
    }, "real provider smoke did not produce a response or friendly failure", 80000);

    await assertNoInternalTerms(page);
    await assertCanvasZero(page);
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    const text = await visibleText(page);
    const providerStatus = decideResponses.at(-1)?.status ?? null;
    const providerUnavailable = providerStatus === null || providerStatus >= 400 || /重新连接 Agent|连接失败|请求超时|这次没有生成有效回复/.test(text);
    if (providerUnavailable && process.env.M33_REAL_PROVIDER_STRICT === "1") {
      throw new Error(`real provider smoke failed in strict mode: ${providerStatus ?? "no http response"}`);
    }

    return {
      providerHttpStatus: providerStatus,
      outcome: providerUnavailable ? "provider_unavailable_ui_boundary_held" : "real_provider_ok",
      strict: process.env.M33_REAL_PROVIDER_STRICT === "1",
      viduGenerateCalls: harness.viduGenerateCalls.length
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

  if (process.env.M33_SKIP_M32_BASELINE !== "1") {
    await runCase("M3.2 baseline acceptance remains green", runM32Baseline);
  }

  const browser = await chromium.launch({
    channel: process.env.M33_ACCEPTANCE_BROWSER_CHANNEL ?? process.env.M32_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M33_ACCEPTANCE_HEADFUL !== "1"
  });

  try {
    await runCase("M3.3 mock: reference description can submit without upload", () => runReferenceDescriptionCase(browser));
    await runCase("M3.3 mock: homepage can create a second isolated task", () => runHomepageSecondTaskCase(browser));

    if (process.env.M33_REAL_PROVIDER_SMOKE === "1") {
      await runCase("M3.3 smoke: real provider hi path keeps UI boundaries", () => runRealProviderSmoke(browser));
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    status: "passed",
    mode: "m33-regression",
    homeUrl,
    workbenchUrl,
    mockProviderRegression: true,
    realProviderSmoke: process.env.M33_REAL_PROVIDER_SMOKE === "1",
    cases: caseResults
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      mode: "m33-regression",
      homeUrl,
      workbenchUrl,
      cases: caseResults,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedServer) startedServer.kill("SIGTERM");
  });
