import type { ToolSet } from "ai";
import {
  createAiSdkToolDefinitionsFromGuardedTools,
  guardedToolToAiSdkTool
} from "./guarded-tool-adapter";
import { guardedAgentToolSchemas } from "../guarded-tools";

export function typecheckGuardedToolAdapter() {
  const askUserTool = guardedToolToAiSdkTool(guardedAgentToolSchemas[0]);
  const tools: ToolSet = createAiSdkToolDefinitionsFromGuardedTools();

  return {
    askUserHasInputSchema: Boolean(askUserTool.inputSchema),
    toolNames: Object.keys(tools)
  };
}
