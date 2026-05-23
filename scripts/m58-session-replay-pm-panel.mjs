import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTsModule(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false
    },
    fileName: sourcePath
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

function createReplayWorkspace() {
  const now = "2026-05-23T02:20:00.000Z";
  const sessionId = "session-m58-1020";
  const projectId = sessionId;
  const approvalId = "approval-m58";
  const taskId = "task-m58";
  const assetId = "asset-m58";

  return {
    sessionId,
    workspace: {
      route: "workbench",
      selectedProduct: "Family Locator",
      setupMode: "clone",
      activeSessionId: sessionId,
      sessions: [
        {
          id: sessionId,
          title: "5月23 10:20",
          product: "Family Locator",
          mode: "clone",
          updatedAt: now,
          session: {
            id: sessionId,
            projectTitle: "5月23 10:20",
            projectKind: "blank",
            lifecycle: "ready",
            mode: "clone",
            currentStepIndex: 0,
            locked: false,
            product: "Family Locator",
            competitor: "",
            focus: [],
            creativeGoal: "生成一条安全感广告",
            specs: { language: "zh", channel: "TikTok", ratio: "9:16", duration: "5s" },
            originalPrompt: "生成一条安全感广告",
            uploadedAssets: [],
            canvasState: { nodes: [], edges: [] },
            createdAt: now,
            updatedAt: now
          },
          runtime: {
            stage: "ready",
            pendingConfirmation: { id: approvalId, approvalRequestId: approvalId, actionHash: "hash-m58", idempotencyKey: "idem-m58" },
            messages: [
              {
                id: "msg-user-m58",
                role: "user",
                body: "请生成一条 5 秒家庭定位广告。",
                createdAt: now,
                events: []
              },
              {
                id: "msg-agent-m58",
                role: "assistant",
                body: "我会先整理剧本和分镜，确认后再生成。",
                createdAt: now,
                events: [
                  { kind: "status", label: "planning", detail: "整理剧本" },
                  {
                    kind: "confirmation",
                    confirmation: {
                      id: approvalId,
                      kind: "generation",
                      title: "确认生成视频",
                      summary: "生成一条 5 秒广告。",
                      confirmLabel: "确认生成",
                      executable: true,
                      actions: [{ type: "runNodeGeneration", nodeId: "node-m58" }]
                    }
                  }
                ],
                metadata: {
                  debugLog: [
                    {
                      message: "connectNodes validation detail",
                      serviceRole: "m58-fixture-service-role",
                      nested: { authorizationToken: "m58-secret-token" }
                    }
                  ]
                }
              }
            ]
          }
        }
      ],
      artifacts: [],
      eventLog: [],
      projectBundles: [
        {
          schemaVersion: 1,
          project: {
            schemaVersion: 1,
            id: projectId,
            title: "5月23 10:20",
            productName: "Family Locator",
            mode: "clone",
            lifecycle: "ready",
            activeSessionId: sessionId,
            createdAt: now,
            updatedAt: now
          },
          sessions: [],
          artifacts: [],
          approvalRequests: [
            {
              schemaVersion: 1,
              id: approvalId,
              projectId,
              sessionId,
              kind: "generation",
              title: "确认生成视频",
              summary: "生成一条 5 秒广告。",
              status: "pending",
              requestedActions: [{ type: "runNodeGeneration", nodeId: "node-m58" }],
              actionHash: "hash-m58",
              idempotencyKey: "idem-m58",
              affectedNodeIds: ["node-m58"],
              affectedArtifactIds: [],
              estimatedCredits: 55,
              requestedAt: now
            }
          ],
          canvasGraph: {
            schemaVersion: 1,
            projectId,
            nodes: [
              {
                id: "node-m58",
                kind: "video",
                title: "5 秒广告",
                x: 120,
                y: 80,
                status: "ready",
                locked: false,
                businessType: "video",
                createdAt: now,
                updatedAt: now,
                versions: [{ id: "version-m58", providerTaskId: "provider-task-m58", createdAt: now }]
              }
            ],
            edges: [],
            graphVersion: "graph-m58",
            updatedAt: now
          },
          generationTasks: [
            {
              schemaVersion: 1,
              id: taskId,
              projectId,
              sessionId,
              nodeId: "node-m58",
              approvalRequestId: approvalId,
              kind: "video",
              surface: "agent",
              provider: "vidu",
              providerTaskId: "provider-task-m58",
              modelId: "viduq3-turbo",
              modelName: "Vidu Q3 Turbo",
              modeKey: "text-to-video",
              prompt: "5 second family locator ad",
              params: {},
              slots: [],
              status: "running",
              progress: 42,
              credits: 55,
              outputAssetId: assetId,
              idempotencyKey: "idem-m58",
              createdAt: now,
              updatedAt: now
            }
          ],
          mediaAssets: [
            {
              schemaVersion: 1,
              id: assetId,
              projectId,
              sessionId,
              kind: "video",
              role: "generated_output",
              source: "generation",
              storage: {
                provider: "external",
                publicUrl: "https://fixture.test/video.mp4?token=m58-url-token&apikey=m58-url-api-key"
              },
              recoverable: false,
              analysisStatus: "idle",
              createdAt: now,
              updatedAt: now
            }
          ],
          events: [
            {
              schemaVersion: 1,
              id: "event-m58-canvas",
              projectId,
              sessionId,
              sequence: 1,
              actorType: "agent",
              eventType: "canvas.node.created",
              objectType: "canvas_node",
              objectId: "node-m58",
              payload: { nodeId: "node-m58" },
              createdAt: now
            },
            {
              schemaVersion: 1,
              id: "event-m58-task",
              projectId,
              sessionId,
              sequence: 2,
              actorType: "provider",
              eventType: "generation.status_changed",
              objectType: "generation_task",
              objectId: taskId,
              payload: { status: "running" },
              createdAt: now
            }
          ],
          updatedAt: now
        }
      ]
    }
  };
}

const { createAgentSessionReplay } = await importTsModule("src/lib/agent-session-replay.ts");
const { workspace, sessionId } = createReplayWorkspace();
const replay = createAgentSessionReplay(workspace, sessionId);
const replayText = JSON.stringify(replay);

assert.equal(replay.pmReview?.sessionId, sessionId, "PM review summary must include the requested session id");
assert.equal(replay.pmReview?.audience, "pm_debug", "PM replay must be marked as a debug/PM view");
assert.ok(replay.pmReview.timeline.some((item) => item.type === "user_input" && item.visibility === "user_visible"), "timeline missing user input");
assert.ok(replay.pmReview.timeline.some((item) => item.type === "agent_reply" && item.visibility === "user_visible"), "timeline missing agent reply");
assert.ok(replay.pmReview.timeline.some((item) => item.type === "card_event" && item.cardKind === "confirmation"), "timeline missing confirmation/card event");
assert.ok(replay.pmReview.timeline.some((item) => item.type === "debug_log" && item.visibility === "internal_diagnostic"), "timeline missing internal diagnostic debug log");
assert.equal(replay.pmReview.approvals[0]?.status, "pending", "approval status not summarized");
assert.equal(replay.pmReview.generationTasks[0]?.status, "running", "generation task status not summarized");
assert.equal(replay.pmReview.mediaAssets[0]?.recoverable, false, "media asset recovery status not summarized");
assert.ok(replay.pmReview.canvasChanges.some((item) => item.eventType === "canvas.node.created"), "canvas changes not summarized");
assert.ok(replay.pmReview.diagnostics.redactionApplied, "redaction flag should be set when secrets are removed");
assert.ok(!replayText.includes("m58-fixture-service-role"), "service role leaked into replay");
assert.ok(!replayText.includes("m58-secret-token"), "token leaked into replay");
assert.ok(!replayText.includes("m58-url-token"), "URL token leaked into replay");
assert.ok(!replayText.includes("m58-url-api-key"), "URL api key leaked into replay");

console.log(JSON.stringify({
  ok: true,
  timelineItems: replay.pmReview.timeline.length,
  approvals: replay.pmReview.approvals.length,
  generationTasks: replay.pmReview.generationTasks.length,
  mediaAssets: replay.pmReview.mediaAssets.length,
  canvasChanges: replay.pmReview.canvasChanges.length,
  redactionApplied: replay.pmReview.diagnostics.redactionApplied
}));
