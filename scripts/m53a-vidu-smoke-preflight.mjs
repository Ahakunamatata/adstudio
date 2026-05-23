import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

const enableEnv = "AD_STUDIO_M53A_VIDU_SMOKE_PREFLIGHT";
const executeEnv = "AD_STUDIO_M53A_EXECUTE_REAL_VIDU";
const projectId = process.env.M53A_PROJECT_ID || "project-m53a-local-smoke";
const lockDir = path.join(process.cwd(), ".next", "cache", "ad-studio-m53a-locks");

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableHash(value) {
  return hashString(JSON.stringify(stableJson(value)));
}

function createGenerationRequest() {
  return {
    kind: process.env.M53A_KIND || "video",
    surface: "agent",
    modelId: process.env.M53A_MODEL_ID || "viduq3-turbo",
    modelName: process.env.M53A_MODEL_NAME || "Vidu Q3 Turbo",
    modeKey: process.env.M53A_MODE_KEY || "text-to-video",
    prompt: process.env.M53A_PROMPT || "Create a short mobile-first product ad smoke test.",
    params: {
      ratio: process.env.M53A_RATIO || "9:16",
      duration: process.env.M53A_DURATION || "5s",
      resolution: process.env.M53A_RESOLUTION || "720p"
    },
    slots: []
  };
}

async function withPlanLock(idempotencyKey, fn) {
  await mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${projectId}-${hashString(idempotencyKey)}.lock`);
  const handle = await open(lockPath, "wx");
  try {
    await handle.writeFile(JSON.stringify({
      projectId,
      idempotencyKey,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }, null, 2));
    return await fn(lockPath);
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function main() {
  if (process.env[executeEnv]) {
    throw new Error(`${executeEnv} is rejected in M5.3A. This script only prints a dry-run plan.`);
  }

  if (process.env[enableEnv] !== "1") {
    console.error(`${enableEnv}=1 is required. M5.3A preflight is disabled by default.`);
    process.exitCode = 1;
    return;
  }

  const generation = createGenerationRequest();
  const actionHash = `generation:vidu-smoke:${stableHash(generation)}`;
  const idempotencyKey = `m53a:${projectId}:${actionHash}`;

  await withPlanLock(idempotencyKey, async (lockPath) => {
    const plan = {
      status: "dry-run-only",
      realProviderCalls: 0,
      oldViduRouteCalls: 0,
      projectId,
      approval: {
        selection: "Use an existing approved generation approval with matching actionHash and idempotencyKey, or create a pending generation approval and stop.",
        requiredStatusBeforeCreate: "approved",
        actionHash,
        idempotencyKey
      },
      generation,
      executor: {
        create: "executeControlledGenerationTask(store, input)",
        poll: "pollControlledGenerationTask(store, input)",
        createWrites: ["approval.executing", "generation.queued", "generation.provider_task_created"],
        pollSucceededWrites: ["asset.not_persisted", "generation.succeeded", "approval.executed"],
        pollFailureWrites: ["generation.failed or generation.cancelled", "approval.execution_failed"]
      },
      temporaryUrlPolicy: {
        storageProvider: "external",
        recoverable: false,
        requiresSignedUrlExpiresAt: true,
        terminalAssetEvent: "asset.not_persisted"
      },
      lock: {
        strategy: "exclusive local lock file plus single-process idempotency guard",
        path: lockPath,
        longTermConstraint: "unique(projectId, idempotencyKey)"
      },
      disabled: [
        "live provider transport",
        "UI entry",
        "Agent-triggered generation",
        "legacy Vidu route",
        "long-term asset persistence"
      ]
    };

    console.log(JSON.stringify(plan, null, 2));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
