import type { AgentInputSnapshot } from "../agent-snapshot";
import type { LlmAgentOutput } from "./agent-output-schema";

export type LlmAgentProvider = {
  decide: (snapshot: AgentInputSnapshot) => Promise<LlmAgentOutput>;
};
