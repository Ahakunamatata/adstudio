import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredBaseUrl = process.env.M4_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3010/";
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
    if (process.env.M4_ACCEPTANCE_DEBUG) process.stdout.write(chunk.toString());
  });
  startedServer.stderr.on("data", (chunk) => {
    if (process.env.M4_ACCEPTANCE_DEBUG) process.stderr.write(chunk.toString());
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function latestUserText(snapshot) {
  const userMessages = Array.isArray(snapshot?.messages)
    ? snapshot.messages.filter((message) => message?.role === "user" && typeof message.body === "string")
    : [];
  return userMessages.at(-1)?.body ?? "";
}

function cloneIntakeQuestion() {
  return {
    id: "m4-clone-intake",
    title: "补齐复刻任务信息",
    description: "先把参考素材、推广产品和参考程度补齐。",
    submitLabel: "提交信息",
    fields: [
      {
        id: "reference_description",
        label: "参考广告描述",
        type: "textarea",
        required: true,
        placeholder: "描述你想复刻的广告内容"
      },
      {
        id: "product_asset",
        label: "我的产品 / 要推广的产品",
        type: "product_asset",
        required: true
      },
      {
        id: "reference_mode",
        label: "复刻参考方式",
        type: "radio",
        display: "segmented",
        required: true,
        options: [
          {
            id: "strict_plot",
            label: "严格复刻剧情结构",
            description: "保留故事线和卖点植入位置。"
          },
          {
            id: "structure_only",
            label: "只参考节奏结构",
            description: "只迁移 Hook、节奏和信息层级。"
          }
        ]
      }
    ]
  };
}

function m4CanvasActions() {
  return [
    {
      type: "createNode",
      input: {
        id: "m4-product",
        kind: "text",
        businessType: "product_pack",
        title: "产品资料包",
        model: "Ad Studio Agent",
        position: { x: 0, y: 40 },
        input: "用户选择的产品资产包。",
        output: "保存产品卖点和限制，供下游节点引用。",
        status: "draft",
        previewClass: "product-pack"
      }
    },
    {
      type: "createNode",
      input: {
        id: "m4-reference",
        kind: "upload",
        businessType: "competitor_asset",
        title: "参考广告素材",
        model: "User Asset",
        position: { x: 320, y: 40 },
        input: "用户提交的参考广告描述或素材。",
        output: "等待客观拆解。",
        status: "uploaded",
        previewClass: "competitor-video"
      }
    },
    {
      type: "createNode",
      input: {
        id: "m4-analysis",
        kind: "script",
        businessType: "competitor_analysis",
        title: "参考广告客观拆解",
        model: "Ad Studio Agent",
        position: { x: 650, y: 40 },
        input: "参考广告素材。",
        output: "拆解 Hook、节奏、卖点植入和 CTA。",
        status: "draft",
        previewClass: "analysis"
      }
    },
    { type: "connectNodes", source: "m4-reference", target: "m4-analysis" },
    {
      type: "createNode",
      input: {
        id: "m4-creative-plan",
        kind: "plan",
        businessType: "clone_strategy",
        title: "复刻创意方案",
        model: "Ad Studio Agent",
        position: { x: 980, y: 40 },
        input: "产品资料包 + 参考广告拆解。",
        output: "先确认结构方案，不生成媒体。",
        status: "waiting_user",
        previewClass: "clone-plan"
      }
    },
    { type: "connectNodes", source: "m4-product", target: "m4-creative-plan" },
    { type: "connectNodes", source: "m4-analysis", target: "m4-creative-plan" },
    {
      type: "createNode",
      input: {
        id: "m4-script",
        kind: "script",
        businessType: "ad_script",
        title: "脚本占位",
        model: "Script Agent",
        position: { x: 1310, y: 40 },
        input: "复刻创意方案。",
        output: "等待用户确认后再扩写脚本。",
        status: "draft",
        previewClass: "analysis"
      }
    },
    { type: "connectNodes", source: "m4-creative-plan", target: "m4-script" },
    {
      type: "createNode",
      input: {
        id: "m4-storyboard",
        kind: "image",
        businessType: "storyboard_frame",
        title: "分镜占位",
        model: "Storyboard Planner",
        position: { x: 1640, y: 40 },
        input: "脚本占位。",
        output: "这里只创建画布结构，不调用图片或视频生成。",
        status: "draft",
        previewClass: "storyboard",
        settings: { ratio: "9:16" }
      }
    },
    { type: "connectNodes", source: "m4-script", target: "m4-storyboard" }
  ];
}

function decideOutput(snapshot) {
  const text = latestUserText(snapshot);

  if (Array.isArray(snapshot?.intakeSubmissions) && snapshot.intakeSubmissions.length > 0) {
    return {
      message: "信息已足够。我会先提出画布结构方案，确认前不会改动画布。",
      briefPatch: {
        product: snapshot.session?.product || "已选产品",
        competitorAsset: snapshot.session?.competitor || "已填写参考素材"
      },
      questions: [],
      confirmation: {
        id: "m4-canvas-proposal",
        title: "确认搭建复刻广告画布结构",
        summary: "确认后只创建/连接非扣费的画布结构节点，不生成媒体。",
        bullets: [
          "创建产品、参考素材、拆解、创意方案、脚本和分镜占位节点。",
          "连接上游引用，方便后续逐步确认脚本和分镜。",
          "本次不会调用图片或视频供应商，也不会扣 credits。"
        ],
        confirmLabel: "确认搭建画布",
        secondaryLabel: "先调整"
      },
      canvasActions: m4CanvasActions()
    };
  }

  if (/复刻/.test(text)) {
    return {
      message: "可以。先补齐参考广告、推广产品和你希望参考的程度。",
      briefPatch: {
        originalPrompt: text
      },
      questions: [cloneIntakeQuestion()],
      confirmation: null,
      canvasActions: []
    };
  }

  return {
    message: "收到，我会继续整理。",
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
      body: JSON.stringify({ error: "M4 acceptance blocks media generation." })
    });
  });

  await context.route("**/api/product/extract**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        product: {
          id: "product-m4-location-tracker",
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
          model: "m4-approval-mock",
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

async function visibleText(page) {
  return cleanText((await page.locator("body").innerText()) ?? "");
}

async function sendMessage(page, text) {
  const input = page.locator(".agent-composer-input");
  await input.fill(text);
  await page.locator(".agent-composer-send").click();
}

async function submitIntake(page) {
  await sendMessage(page, "我要复刻一个广告");
  await waitFor(async () => (await visibleText(page)).includes("补齐复刻任务信息"), "intake card not visible");
  const card = page.locator(".question-card").first();
  await card.locator("textarea").first().fill("参考广告开头强 Hook，中段展示家庭安全焦虑，结尾 CTA 下载。");
  await card.locator(".agent-product-card").first().click();
  await card.locator(".agent-option-grid button").first().click();
  const submitButton = card.getByRole("button", { name: /提交信息|继续/ });
  await waitFor(async () => await submitButton.isEnabled(), "intake submit not enabled");
  await submitButton.click();
}

async function getWorkspaceState(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("ad-studio:agent-workspace:v2");
    return raw ? JSON.parse(raw) : null;
  });
}

function getActiveBundle(workspace) {
  const projectId = workspace?.activeSessionId;
  return workspace?.projectBundles?.find((bundle) => bundle?.project?.id === projectId) ?? workspace?.projectBundles?.[0] ?? null;
}

async function assertCanvasCount(page, nodes, links) {
  const expected = `${nodes} nodes · ${links} links`;
  await waitFor(async () => (await visibleText(page)).includes(expected), `canvas did not show ${expected}`);
}

async function waitForBundle(page, predicate, label) {
  return waitFor(async () => {
    const workspace = await getWorkspaceState(page);
    const bundle = getActiveBundle(workspace);
    return bundle && predicate(bundle) ? bundle : null;
  }, label);
}

async function runApproveRefreshIdempotencyCase(browser) {
  const harness = await createMockProviderContext(browser);
  const page = await harness.context.newPage();

  try {
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await submitIntake(page);
    await waitFor(async () => (await visibleText(page)).includes("确认搭建复刻广告画布结构"), "approval card not visible");
    assert((await visibleText(page)).includes("不会调用图片或视频供应商"), "approval card did not show no-provider boundary");
    assert((await visibleText(page)).includes("不会扣 credits"), "approval card did not show no-credit boundary");
    await assertCanvasCount(page, 0, 0);

    const confirmButton = page.getByRole("button", { name: "确认搭建画布" });
    await confirmButton.click();
    await confirmButton.click({ timeout: 500 }).catch(() => undefined);
    await assertCanvasCount(page, 6, 5);

    const executedBundle = await waitForBundle(
      page,
      (bundle) =>
        bundle.canvasGraph?.nodes?.length === 6 &&
        bundle.canvasGraph?.edges?.length === 5 &&
        bundle.approvalRequests?.some((approval) => approval.status === "executed") &&
        bundle.events?.some((event) => event.eventType === "approval.executed"),
      "executed approval bundle was not persisted"
    );

    const nodeIds = executedBundle.canvasGraph.nodes.map((node) => node.id);
    assert(new Set(nodeIds).size === 6, "approval execution duplicated canvas nodes");
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    await page.reload({ waitUntil: "networkidle" });
    await assertCanvasCount(page, 6, 5);
    const restoredBundle = await waitForBundle(
      page,
      (bundle) =>
        bundle.canvasGraph?.nodes?.length === 6 &&
        bundle.approvalRequests?.some((approval) => approval.status === "executed") &&
        bundle.events?.some((event) => event.eventType === "approval.executed"),
      "executed approval bundle did not restore after refresh"
    );

    return {
      decideCalls: harness.decideCalls.length,
      viduGenerateCalls: harness.viduGenerateCalls.length,
      nodeCount: restoredBundle.canvasGraph.nodes.length,
      edgeCount: restoredBundle.canvasGraph.edges.length,
      approvalStatuses: restoredBundle.approvalRequests.map((approval) => approval.status)
    };
  } finally {
    await harness.context.close();
  }
}

async function runRejectCase(browser) {
  const harness = await createMockProviderContext(browser);
  const page = await harness.context.newPage();

  try {
    await page.goto(workbenchUrl, { waitUntil: "networkidle" });
    await submitIntake(page);
    await waitFor(async () => (await visibleText(page)).includes("确认搭建复刻广告画布结构"), "approval card not visible");
    await assertCanvasCount(page, 0, 0);
    await page.getByRole("button", { name: "先调整" }).click();
    await assertCanvasCount(page, 0, 0);

    const rejectedBundle = await waitForBundle(
      page,
      (bundle) =>
        (bundle.canvasGraph?.nodes?.length ?? 0) === 0 &&
        bundle.approvalRequests?.some((approval) => approval.status === "rejected") &&
        bundle.events?.some((event) => event.eventType === "approval.rejected"),
      "rejected approval bundle was not persisted"
    );
    assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");

    return {
      decideCalls: harness.decideCalls.length,
      viduGenerateCalls: harness.viduGenerateCalls.length,
      nodeCount: rejectedBundle.canvasGraph.nodes.length,
      approvalStatuses: rejectedBundle.approvalRequests.map((approval) => approval.status)
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
    channel: process.env.M4_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M4_ACCEPTANCE_HEADFUL !== "1"
  });

  try {
    await runCase("M4 mock: approve executes canvas structure once and refresh restores it", () => runApproveRefreshIdempotencyCase(browser));
    await runCase("M4 mock: reject keeps canvas unchanged and records approval rejection", () => runRejectCase(browser));
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    status: "passed",
    mode: "m4-approval-canvas",
    workbenchUrl,
    cases: caseResults
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      mode: "m4-approval-canvas",
      workbenchUrl,
      cases: caseResults,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedServer) startedServer.kill("SIGTERM");
  });
