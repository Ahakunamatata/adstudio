import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const requireFromScript = createRequire(import.meta.url);

async function readSource(file) {
  return readFile(path.join(root, file), "utf8");
}

function loadCommonJsFromTypeScript(file) {
  const source = ts.transpileModule(file.source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const exports = {};
  const cjsModule = { exports };
  const context = vm.createContext({
    exports,
    module: cjsModule,
    require: requireFromScript,
    process,
    URL,
    console
  });
  vm.runInContext(source, context, { filename: file.name });
  return cjsModule.exports;
}

function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function assertProviderCapabilityMatrix() {
  const source = await readSource("src/features/agent-runtime/ai-sdk/model-config.ts");
  const modelConfig = loadCommonJsFromTypeScript({
    name: "model-config.ts",
    source
  });

  assert.equal(modelConfig.canUseAiSdkGoogleProvider({
    apiKey: "test-key",
    model: "gemini-test",
    apiUrl: "https://example.test/v1/chat/completions",
    apiFormat: "openai",
    explicitUrl: "https://example.test/v1/chat/completions",
    aiSdkProvider: "google",
    aiSdkBaseUrl: ""
  }), false);

  assert.equal(modelConfig.canUseAiSdkGoogleProvider({
    apiKey: "test-key",
    model: "gemini-test",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    apiFormat: "gemini",
    explicitUrl: "",
    aiSdkProvider: "google",
    aiSdkBaseUrl: ""
  }), true);

  const openAiCompatibleInfo = withEnv(
    {
      GEMINI_AGENT_API_KEY: "test-key",
      GEMINI_API_KEY: "test-key",
      GEMINI_AGENT_MODEL: "gemini-test",
      GEMINI_MODEL: "gemini-test",
      GEMINI_AGENT_API_FORMAT: "openai",
      GEMINI_API_FORMAT: "openai",
      GEMINI_AGENT_API_URL: "https://example.test/v1/chat/completions",
      GEMINI_API_URL: "https://example.test/v1/chat/completions",
      AD_STUDIO_AGENT_AI_SDK_PROVIDER: "google",
      GEMINI_AGENT_AI_SDK_PROVIDER: "google",
      AD_STUDIO_AGENT_AI_SDK_BASE_URL: undefined,
      GEMINI_AGENT_AI_SDK_BASE_URL: undefined
    },
    () => modelConfig.getGeminiAgentRuntimeInfo()
  );

  assert.equal(openAiCompatibleInfo.apiFormat, "openai");
  assert.equal(openAiCompatibleInfo.aiSdkSupported, false);
}

async function assertSourceContracts() {
  const packageJson = JSON.parse(await readSource("package.json"));
  assert.equal(packageJson.dependencies?.["@ai-sdk/react"], undefined, "M3.2.5 must not add @ai-sdk/react");

  const geminiAgent = await readSource("src/lib/gemini-agent.ts");
  const decisionProvider = await readSource("src/features/agent-runtime/ai-sdk/decision-provider.ts");
  const providerMetadata = await readSource("src/features/agent-runtime/ai-sdk/provider-metadata.ts");
  const browserProvider = await readSource("src/features/agent-runtime/llm/gemini-agent-provider.ts");
  const controller = await readSource("src/features/agent-runtime/llm-agent-controller.ts");
  const outputAdapter = await readSource("src/features/agent-runtime/llm/agent-output-adapter.ts");
  const uiAdapter = await readSource("src/features/agent-runtime/ai-sdk/ui-message-adapter.ts");
  const toolAdapter = await readSource("src/features/agent-runtime/ai-sdk/guarded-tool-adapter.ts");
  const lifecycle = await readSource("src/features/agent-runtime/agent-message-lifecycle.ts");

  const requiredReasons = [
    "configuration_missing",
    "provider_timeout",
    "provider_network_error",
    "provider_invalid_json",
    "schema_validation_failed",
    "provider_rate_limited",
    "provider_bad_gateway",
    "route_unhandled_error"
  ];
  for (const reason of requiredReasons) {
    assert(
      `${geminiAgent}\n${decisionProvider}\n${providerMetadata}`.includes(reason),
      `provider reason missing: ${reason}`
    );
  }

  assert(geminiAgent.includes("openai_compatible_config"), "KIE fallback reason is not explicit");
  assert(geminiAgent.includes('"openai_compatible"'), "openai-compatible decisionSource is not represented");
  assert(geminiAgent.includes("latencyMs"), "provider metadata missing latencyMs");
  assert(geminiAgent.includes("retryCount"), "provider metadata missing retryCount");
  assert(browserProvider.includes("70_000"), "browser Agent timeout should remain 70s");
  assert(!controller.includes("function outputToEvents"), "outputToEvents should live in adapter");
  assert(lifecycle.includes("userInput"), "retry lifecycle must retain original user input");

  for (const kind of [
    "text",
    "status",
    "question",
    "intake_submission",
    "retry",
    "confirmation",
    "warning",
    "canvas_action",
    "node_result"
  ]) {
    assert(uiAdapter.includes(kind), `UIMessage adapter missing event kind: ${kind}`);
  }

  assert(outputAdapter.includes("llmAgentOutputToEvents"), "structured output adapter missing");
  assert(toolAdapter.includes("tool("), "guarded tool adapter must create AI SDK tool() definitions");
  assert(toolAdapter.includes("includeExecute"), "guarded tool adapter must default away from execution");
  assert(lifecycle.includes("retrying"), "message lifecycle missing retrying state");
  assert(lifecycle.includes("cancelled"), "message lifecycle missing cancelled state");
}

async function run() {
  await assertProviderCapabilityMatrix();
  await assertSourceContracts();
  console.log(JSON.stringify({
    status: "passed",
    checks: [
      "provider capability matrix",
      "provider metadata/error reason source contracts",
      "AI SDK UIMessage adapter source contracts",
      "structured output adapter source contracts",
      "guarded tool adapter source contracts",
      "message lifecycle source contracts"
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
