import { createAgentSession } from "@/features/agent/agent-session";
import { createInitialLlmAgentRuntime } from "@/features/workbench/agent-orchestrator";
import { createAgentArtifactSnapshot } from "./artifacts";
import { createEmptyCanvasSnapshot } from "./agent-snapshot";
import { createMemoryArtifactStore, type WorkspaceArtifactStore } from "./artifact-store";
import {
  runM3GoldenPathDemo,
  shouldUseM3GoldenPathDemo
} from "./m3-golden-path";

const memoryWorkspaceStore: WorkspaceArtifactStore = {
  ...createMemoryArtifactStore(),
  async recordRestoreFailure() {
    return undefined;
  }
};

export async function typecheckM3GoldenPathDemoRoundTrip() {
  const text = "M3 golden path 演示：给 Family Locator 做 15s TikTok 泰语广告，严格复刻剧情结构，生活场景为主，App 作为解决方案出现。";
  const session = createAgentSession("clone", "Family Locator", text);
  const transition = await runM3GoldenPathDemo({
    state: createInitialLlmAgentRuntime(session),
    text,
    session,
    canvas: createEmptyCanvasSnapshot(),
    artifactStore: memoryWorkspaceStore,
    showUserMessage: true
  });
  const storedArtifacts = await memoryWorkspaceStore.load(session.id);
  const runtimeArtifactSnapshot = createAgentArtifactSnapshot(transition.state.artifacts);
  const confirmation = transition.state.messages
    .flatMap((message) => message.events ?? [])
    .findLast((event) => event.kind === "confirmation")?.confirmation;

  return {
    shouldUseDemo: shouldUseM3GoldenPathDemo(text),
    storedCreativePlanId: storedArtifacts.creativePlan?.id,
    runtimeSummaryCount: runtimeArtifactSnapshot.summaries.length,
    proposalExecutable: confirmation?.executable,
    canvasActionCount: transition.canvasActions?.length ?? 0
  } satisfies {
    shouldUseDemo: boolean;
    storedCreativePlanId?: string;
    runtimeSummaryCount: number;
    proposalExecutable?: boolean;
    canvasActionCount: number;
  };
}
