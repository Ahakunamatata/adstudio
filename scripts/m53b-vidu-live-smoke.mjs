const enableEnv = "AD_STUDIO_M53B_ENABLE_REAL_VIDU_SMOKE";
const confirmEnv = "AD_STUDIO_M53B_CONFIRM_REAL_VIDU_SMOKE";
const confirmValue = "I_CONFIRM_M53B_REAL_VIDU_SMOKE_CAN_COST_CREDITS";
const baseUrl = (process.env.M53B_BASE_URL || "http://127.0.0.1:3010").replace(/\/+$/, "");

function envEnabled() {
  return process.env[enableEnv] === "1" && process.env[confirmEnv] === confirmValue;
}

function printDisabled() {
  console.error(`${enableEnv}=1 and ${confirmEnv}=${confirmValue} are required before running a real Vidu smoke.`);
  console.error(`Example:`);
  console.error(`  M53B_BASE_URL=http://127.0.0.1:3010 \\`);
  console.error(`  ${enableEnv}=1 \\`);
  console.error(`  ${confirmEnv}=${confirmValue} \\`);
  console.error(`  corepack pnpm smoke:m53b:vidu-live`);
}

async function main() {
  if (!envEnabled()) {
    printDisabled();
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${baseUrl}/api/agent/vidu-smoke`, {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.M53B_TIMEOUT_MS || 420000)),
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      execute: true,
      confirm: confirmValue,
      projectId: process.env.M53B_PROJECT_ID,
      sessionId: process.env.M53B_SESSION_ID,
      prompt: process.env.M53B_PROMPT,
      modelId: process.env.M53B_MODEL_ID,
      modelName: process.env.M53B_MODEL_NAME,
      modeKey: process.env.M53B_MODE_KEY,
      ratio: process.env.M53B_RATIO,
      duration: process.env.M53B_DURATION,
      resolution: process.env.M53B_RESOLUTION,
      maxPolls: process.env.M53B_MAX_POLLS ? Number(process.env.M53B_MAX_POLLS) : undefined,
      pollIntervalMs: process.env.M53B_POLL_INTERVAL_MS ? Number(process.env.M53B_POLL_INTERVAL_MS) : undefined
    })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  console.log(JSON.stringify({
    httpStatus: response.status,
    ok: response.ok,
    ...data
  }, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
