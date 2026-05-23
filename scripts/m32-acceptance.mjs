import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.M32_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3010/ad-workbench";
const origin = new URL(baseUrl).origin;
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
  throw new Error(`${label}${lastError instanceof Error ? `：${lastError.message}` : ""}`);
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
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  startedServer.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (process.env.M32_ACCEPTANCE_DEBUG) process.stdout.write(text);
  });
  startedServer.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (process.env.M32_ACCEPTANCE_DEBUG) process.stderr.write(text);
  });

  await waitFor(isServerReady, "dev server did not become ready", 30000);
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function latestUserText(snapshot) {
  const userMessages = Array.isArray(snapshot?.messages)
    ? snapshot.messages.filter((message) => message?.role === "user" && typeof message.body === "string")
    : [];
  return userMessages.at(-1)?.body ?? "";
}

function cloneIntakeQuestion({ productRequired = true } = {}) {
  return {
    id: productRequired ? "m32-clone-intake" : "m32-clone-reference-first",
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
        competitorAsset: snapshot.session?.competitor || "已上传参考素材"
      },
      questions: [
        {
          id: "m32-delivery-settings",
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

  if (/产品是\s*location tracker/i.test(text)) {
    return {
      message: "收到，产品先记为 location tracker。我会把它作为上一轮复刻任务的推广主体，不会重新开一个新任务。",
      briefPatch: {
        product: "location tracker"
      },
      questions: [
        {
          id: "m32-reference-only-after-product",
          title: "补充参考素材",
          description: "产品信息已补充，只需要再给参考广告素材或描述。",
          submitLabel: "保存参考素材",
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
              multiple: true
            },
            {
              id: "reference_description",
              label: "参考广告描述",
              type: "textarea",
              required: true,
              requiredGroup: "reference",
              requiredGroupLabel: "参考广告素材或描述"
            }
          ]
        }
      ],
      confirmation: null,
      canvasActions: []
    };
  }

  if (/先不要生成|先别生成|不要生成|不要执行/.test(text)) {
    return {
      message: "收到。本轮只保存和整理方案，不会进入生成，也不会执行画布动作。",
      briefPatch: {},
      questions: [],
      confirmation: null,
      canvasActions: []
    };
  }

  if (/产品还没准备好/.test(text)) {
    return {
      message: "可以先不填产品。我们先保存竞品参考和复刻意图，产品稍后可以用名称、资产包或链接补上。",
      briefPatch: {},
      questions: [cloneIntakeQuestion({ productRequired: false })],
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

  if (/^hi$|你好|你是谁|help|怎么用/i.test(text.trim())) {
    return {
      message: "你好，我在。你可以告诉我想复刻竞品广告、从零做广告，或者先上传参考素材。",
      briefPatch: {},
      questions: [],
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

async function createContext(browser, options = {}) {
  let workspace = structuredClone(emptyWorkspace);
  const decideCalls = [];
  const viduGenerateCalls = [];
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });

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
      body: JSON.stringify({ error: "M3.2 acceptance blocks media generation." })
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

    if (options.failDecide) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Agent 暂时连接失败。" })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        output: decideOutput(postData?.snapshot),
        runtime: {
          configured: true,
          model: "m32-acceptance-mock",
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

async function createPngFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "ad-studio-m32-"));
  const file = path.join(dir, "reference.png");
  await writeFile(
    file,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lxFUWQAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  return file;
}

async function runStaticChecks() {
  const { readFile } = await import("node:fs/promises");
  const workbench = await readFile("src/features/workbench/AgentWorkbenchView.tsx", "utf8");
  const orchestrator = await readFile("src/features/workbench/agent-orchestrator.ts", "utf8");
  const sourceFiles = [
    "src/features/workbench/AgentWorkbenchView.tsx",
    "src/features/agent-runtime/llm-agent-controller.ts",
    "src/features/agent-runtime/AgentEventRenderer.tsx"
  ];
  const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(file, "utf8")])));

  const submitTextMatch = workbench.match(/function submitTextValue[\s\S]*?function submitComposer/);
  assert(submitTextMatch, "submitTextValue block not found");
  assert(!submitTextMatch[0].includes("createM32InteractionIntakeRuntime"), "submitTextValue directly creates fixed intake runtime");
  assert(!submitTextMatch[0].includes("conversation"), "submitTextValue contains conversation shell routing");

  const submitQuestionMatch = workbench.match(/function submitStructuredQuestion[\s\S]*?function submitQuestion/);
  assert(submitQuestionMatch, "submitStructuredQuestion block not found");
  assert(!submitQuestionMatch[0].includes('createLocalMessage("assistant"'), "card submit locally creates assistant reply");
  assert(submitQuestionMatch[0].includes("submitInternalAgentTask"), "card submit does not re-enter Agent decision");

  assert(!workbench.includes("createM32InteractionIntakeRuntime"), "Workbench imports or calls fixed M3.2 intake runtime");
  assert(orchestrator.includes("createM32InteractionIntakeRuntime"), "fallback intake runtime is missing from fallback module");

  const joined = Object.values(sources).join("\n");
  assert(!/conversation[-_]?shell|routeAgentConversation/.test(joined), "conversation shell route is present in main source");
  assert(!/我要复刻一个广告|我想复刻这个竞品，但是产品还没准备好|产品是 location tracker/.test(joined), "test sentence appears in product code");

  return "passed";
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
  await runStaticChecks();

  const browser = await chromium.launch({
    channel: process.env.M32_ACCEPTANCE_BROWSER_CHANNEL ?? "chrome",
    headless: process.env.M32_ACCEPTANCE_HEADFUL !== "1"
  });

  try {
    await runCase("Case 1: hi does not start ad task", async () => {
      const harness = await createContext(browser);
      const page = await harness.context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await sendMessage(page, "hi");
      await waitFor(() => harness.decideCalls.length === 1, "hi did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("你好，我在"), "hi assistant response not visible");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);
      assert(!(await visibleText(page)).includes("补齐复刻任务信息"), "hi opened clone intake card");
      const workspace = await getWorkspaceState(page);
      const activeSession = workspace?.sessions?.find((item) => item.id === workspace.activeSessionId)?.session;
      assert(!activeSession?.originalPrompt, "hi wrote originalPrompt");
      assert(!activeSession?.creativeGoal, "hi wrote creativeGoal");
      assert(!cleanText(await visibleText(page)).includes("未指定产品 · 复刻"), "hi made project look like clone task");
      assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");
      await harness.context.close();
      return { decideCalls: harness.decideCalls.length, viduGenerateCalls: harness.viduGenerateCalls.length };
    });

    await runCase("Cases 2/4/8: clone intake, submit card, refresh restore", async () => {
      const harness = await createContext(browser);
      const page = await harness.context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await sendMessage(page, "我要复刻一个广告");
      await waitFor(() => harness.decideCalls.length === 1, "clone request did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("补齐复刻任务信息"), "clone intake card not visible");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);

      const beforeSubmitText = await visibleText(page);
      assert(beforeSubmitText.includes("参考广告素材"), "clone card missing reference asset field");
      assert(beforeSubmitText.includes("我的产品 / 要推广的产品"), "clone card missing product field");
      assert(beforeSubmitText.includes("复刻参考方式"), "clone card missing reference mode field");
      assert(harness.decideCalls[0].snapshot?.messages?.some((message) => message.role === "user"), "snapshot did not include user message");

      const submitButton = page.locator(".question-card").first().getByRole("button", { name: /提交信息|继续/ });
      await waitFor(async () => !(await submitButton.isEnabled()), "submit button should be disabled before required fields");

      await page.locator(".question-card .agent-product-card").first().click();
      const fixture = await createPngFixture();
      await page.locator(".question-card input[type=file]").first().setInputFiles(fixture);
      await page.locator(".question-card .agent-option-grid button").first().click();
      await waitFor(async () => await submitButton.isEnabled(), "submit button not enabled after required fields");
      await submitButton.click();
      await waitFor(() => harness.decideCalls.length === 2, "card submit did not re-enter /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("补充投放设置"), "Agent did not continue with next question");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);

      const submittedText = await visibleText(page);
      assert(submittedText.includes("已提交"), "old card did not enter submitted state");
      assert(!submittedText.includes("还缺：参考广告素材或描述"), "old card still shows missing required reference");

      const workspace = await getWorkspaceState(page);
      const activeRecord = workspace?.sessions?.find((item) => item.id === workspace.activeSessionId);
      assert(activeRecord?.session?.uploadedAssets?.length > 0, "uploadedAssets not written to session/workspace");

      const runtimeStates = await getRuntimeStates(page);
      const activeRuntime = Object.values(runtimeStates).find((runtime) => Array.isArray(runtime?.intakeSubmissions));
      assert(activeRuntime?.intakeSubmissions?.length > 0, "intakeSubmissions not written to runtime");
      assert(activeRuntime?.messages?.some((message) => message.metadata?.intakeSubmission), "intake submission metadata missing");

      const callsBeforeReload = harness.decideCalls.length;
      await page.reload({ waitUntil: "networkidle" });
      await waitFor(async () => (await visibleText(page)).includes("已提交"), "submitted card did not restore after refresh");
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert(harness.decideCalls.length === callsBeforeReload, "refresh re-ran Agent decision unexpectedly");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);
      assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");
      await harness.context.close();
      return {
        decideCalls: harness.decideCalls.length,
        viduGenerateCalls: harness.viduGenerateCalls.length,
        uploadedAssets: activeRecord.session.uploadedAssets.length,
        intakeSubmissions: activeRuntime.intakeSubmissions.length,
        artifactSchemaVersion: activeRuntime.artifacts?.schemaVersion ?? null
      };
    });

    await runCase("Cases 3/5/6: product later, supplement product, no generation", async () => {
      const harness = await createContext(browser);
      const page = await harness.context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await sendMessage(page, "我想复刻这个竞品，但是产品还没准备好");
      await waitFor(() => harness.decideCalls.length === 1, "product-not-ready input did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("产品可以稍后补"), "product-later path not visible");
      let text = await visibleText(page);
      assert(!text.includes("还缺：我的产品 / 要推广的产品"), "product was forced required despite user saying not ready");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);

      await sendMessage(page, "产品是 location tracker");
      await waitFor(() => harness.decideCalls.length === 2, "product supplement did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("location tracker"), "product supplement not reflected");
      text = await visibleText(page);
      const fullCardOccurrences = (text.match(/补齐复刻任务信息/g) ?? []).length;
      assert(fullCardOccurrences === 0, "product supplement reopened full fixed clone card");

      await sendMessage(page, "先不要生成");
      await waitFor(() => harness.decideCalls.length === 3, "no-generate input did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("不会进入生成"), "no-generate response not visible");
      text = await visibleText(page);
      assert(!text.includes("等待确认执行"), "no-generate returned executable confirmation");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);
      assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");
      await harness.context.close();
      return { decideCalls: harness.decideCalls.length, viduGenerateCalls: harness.viduGenerateCalls.length };
    });

    await runCase("Case 7: model failure is friendly and non-semantic", async () => {
      const harness = await createContext(browser, { failDecide: true });
      const page = await harness.context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await sendMessage(page, "hi");
      await waitFor(() => harness.decideCalls.length === 1, "failure case did not call /api/agent/decide");
      await waitFor(async () => (await visibleText(page)).includes("连接失败"), "friendly connection failure not visible");
      await page.getByRole("button", { name: "重新连接 Agent" }).click();
      await waitFor(() => harness.decideCalls.length === 2, "retry did not call /api/agent/decide again");
      const text = await visibleText(page);
      assert(!text.includes("补齐复刻任务信息"), "failure path opened clone card");
      await assertNoInternalTerms(page);
      await assertCanvasZero(page);
      const workspace = await getWorkspaceState(page);
      const activeSession = workspace?.sessions?.find((item) => item.id === workspace.activeSessionId)?.session;
      assert(!activeSession?.originalPrompt, "failure wrote originalPrompt");
      assert(!activeSession?.creativeGoal, "failure wrote creativeGoal");
      assert(harness.viduGenerateCalls.length === 0, "/api/vidu/generate was called");
      await harness.context.close();
      return { decideCalls: harness.decideCalls.length, viduGenerateCalls: harness.viduGenerateCalls.length };
    });
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    status: "passed",
    baseUrl,
    staticChecks: "passed",
    cases: caseResults
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      baseUrl,
      cases: caseResults,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedServer) startedServer.kill("SIGTERM");
  });
