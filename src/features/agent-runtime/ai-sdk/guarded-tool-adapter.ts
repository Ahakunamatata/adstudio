import { tool, type Tool, type ToolSet } from "ai";
import type { CanvasSnapshot } from "../agent-snapshot";
import {
  agentToolResultSchema,
  guardedAgentToolSchemas,
  type AgentToolResult
} from "../guarded-tools";
import type { WorkspaceArtifactStore } from "../artifact-store";

type GuardedToolDefinition = (typeof guardedAgentToolSchemas)[number];

type GuardedToolExecutionContext = {
  canvas?: CanvasSnapshot;
  artifactStore?: WorkspaceArtifactStore;
};

type GuardedToolExecute = (input: unknown, context?: GuardedToolExecutionContext) => unknown;

export type GuardedToolAdapterOptions = {
  includeExecute?: boolean;
  context?: GuardedToolExecutionContext;
};

export function guardedToolToAiSdkTool(
  definition: GuardedToolDefinition,
  options: GuardedToolAdapterOptions = {}
): Tool<unknown, AgentToolResult> {
  const execute = options.includeExecute
    ? async (input: unknown) => {
        const rawResult = await Promise.resolve(
          (definition.execute as GuardedToolExecute)(input, options.context)
        );
        return agentToolResultSchema.parse(rawResult) as AgentToolResult;
      }
    : undefined;

  return tool({
    title: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    needsApproval: definition.name !== "inspectCanvas",
    strict: false,
    metadata: {
      source: "ad-studio-guarded-tools",
      guardedToolName: definition.name,
      executionDefault: "schema-only"
    },
    ...(execute ? { execute } : {})
  } as Tool<unknown, AgentToolResult>);
}

export function createAiSdkToolDefinitionsFromGuardedTools(
  options: GuardedToolAdapterOptions = {}
): ToolSet {
  return Object.fromEntries(
    guardedAgentToolSchemas.map((definition) => [
      definition.name,
      guardedToolToAiSdkTool(definition, options)
    ])
  ) as ToolSet;
}
