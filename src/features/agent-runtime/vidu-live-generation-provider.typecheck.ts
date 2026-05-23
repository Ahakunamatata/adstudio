import type { MediaGenerationInput } from "./generation-provider";
import {
  createViduLiveGenerationPlan,
  createViduLiveMediaGenerationProvider,
  VIDU_LIVE_PROVIDER_CONFIRM_ENV,
  VIDU_LIVE_PROVIDER_CONFIRM_VALUE,
  VIDU_LIVE_PROVIDER_ENABLE_ENV
} from "./vidu-live-generation-provider";

const sampleInput: MediaGenerationInput = {
  projectId: "project-m53a-vidu-smoke-preflight",
  sessionId: "session-m53a-vidu-smoke-preflight",
  approvalRequestId: "approval-m53a-vidu-smoke",
  idempotencyKey: "m53a:project-m53a-vidu-smoke-preflight:generation:vidu-smoke",
  kind: "video",
  surface: "agent",
  modelId: "viduq3-turbo",
  modelName: "Vidu Q3 Turbo",
  modeKey: "text-to-video",
  prompt: "Create a short mobile-first product ad smoke test.",
  params: {
    ratio: "9:16",
    duration: "5s",
    resolution: "720p"
  },
  slots: []
};

function assertTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function typecheckM53AViduLiveProviderPreflight() {
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return {
      task_id: "vidu-live-smoke-task",
      state: "created",
      model: "viduq3-turbo"
    };
  };

  const disabledProvider = createViduLiveMediaGenerationProvider({
    env: {},
    transport
  });
  assertTrue(disabledProvider.capabilities.liveSmoke === true, "live provider must be marked explicit liveSmoke only");
  assertTrue(disabledProvider.capabilities.dryRun === false, "live provider must not be treated as dry-run");
  const disabledPlan = createViduLiveGenerationPlan(sampleInput, { env: {} });
  assertTrue(disabledPlan.ok, "disabled live provider should still build a dry-run plan");
  assertTrue(disabledPlan.enabled === false, "live provider must be disabled by default");
  assertTrue(disabledPlan.confirmed === false, "live provider must be unconfirmed by default");
  assertTrue(disabledPlan.request?.path === "/text2video", "dry-run plan must show the Vidu create path");

  let disabledBlocked = false;
  try {
    await disabledProvider.createTask(sampleInput);
  } catch (error) {
    disabledBlocked = error instanceof Error && error.message.includes(VIDU_LIVE_PROVIDER_ENABLE_ENV);
  }
  assertTrue(disabledBlocked, "disabled provider must block createTask before transport");
  assertTrue(transportCalls === 0, "disabled provider must not call transport");

  const unconfirmedProvider = createViduLiveMediaGenerationProvider({
    env: {
      [VIDU_LIVE_PROVIDER_ENABLE_ENV]: "1"
    },
    transport
  });
  let unconfirmedBlocked = false;
  try {
    await unconfirmedProvider.createTask(sampleInput);
  } catch (error) {
    unconfirmedBlocked = error instanceof Error && error.message.includes(VIDU_LIVE_PROVIDER_CONFIRM_ENV);
  }
  assertTrue(unconfirmedBlocked, "enabled provider must still require explicit confirmation");
  assertTrue(transportCalls === 0, "unconfirmed provider must not call transport");

  const confirmedPlan = createViduLiveGenerationPlan(sampleInput, {
    env: {
      [VIDU_LIVE_PROVIDER_ENABLE_ENV]: "1",
      [VIDU_LIVE_PROVIDER_CONFIRM_ENV]: VIDU_LIVE_PROVIDER_CONFIRM_VALUE
    },
    apiBaseUrl: "https://api.example.test"
  });
  assertTrue(confirmedPlan.enabled, "confirmed plan must report enabled");
  assertTrue(confirmedPlan.confirmed, "confirmed plan must report confirmed");
  assertTrue(confirmedPlan.request?.apiBaseUrl === "https://api.example.test", "plan must keep explicit API base URL");

  return {
    disabledPlanPath: disabledPlan.request?.path,
    disabledBlocked,
    unconfirmedBlocked,
    transportCalls,
    realProviderCalls: 0
  };
}
