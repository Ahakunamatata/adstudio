# AD Studio Agent Working Context

## Current Understanding

AD Studio is an AI ad production product for performance creative teams. The Agent flow is still early and unvalidated; the existing implementation is a scaffold, not a proven product workflow.

Documentation policy:

- The Feishu roadmap must stay product-manager readable.
- New concepts should use Chinese first, then the English/code name in parentheses.
- Any new technical term used by later Codex threads should be added to the roadmap glossary before it becomes a milestone requirement.
- Technical identifiers can remain in English when they map directly to code, but the business meaning must be stated in Chinese.

The valuable product direction is not a generic chatbot. The Agent should help users move through ad production: product intake, competitor/reference analysis, creative direction, script, anchor assets, storyboard, video generation, review, and localized rework.

The current code already has early concepts for:

- Agent conversation state and messages.
- Structured Agent output: message, questions, confirmation, canvasActions, briefPatch, safetyNotes.
- Canvas as a production workspace with nodes, edges, versions, locks, stale status, and generation results.
- User confirmation before high-cost or high-risk production actions.
- Anchor First production logic: product UI/icon, characters, scene, and brand anchors should stabilize before storyboard/video.
- Gemini-based ad/media analysis and Agent decision endpoints.

## Architecture Direction

The target should not be two disconnected systems. A better split is:

1. AD Studio product layer
   - Owns business rules, ad workflows, canvas state, node lifecycle, confirmation rules, generation task rules, rework logic, and safety constraints.

2. Agent orchestration layer
   - Owns prompts, schemas, tool definitions, tool permissions, when to ask the user, when to propose actions, when to execute, and how to translate model intent into AD Studio actions.

3. Vercel AI SDK foundation layer
   - Owns model calls, structured output, tool calling, streaming, chat transport/state, provider switching, and eventually multi-step agent loops.

The product logic should remain inspectable and testable outside the model. AI SDK should make the model call those capabilities in a standard way, not hide the business workflow inside prompt text.

## Current AI SDK Hypothesis

AI SDK should be introduced gradually.

Best first replacement:

- Replace hand-written model request and JSON parsing in the Gemini Agent provider with AI SDK structured output.

Likely later additions:

- Convert ask_user and propose_action_batch into AI SDK tools.
- Convert create_node, update_node, connect_nodes, run_generation, append_version, lock_node, mark_stale into guarded tools.
- Use AI SDK UI streaming only when the product needs real streaming status and tool state.
- Consider ToolLoopAgent only after confirmation, validation, action execution, and rollback behavior are stable.

Avoid for now:

- Rewriting the whole workbench around AI SDK before product logic is validated.
- Letting the model directly mutate canvas state without AD Studio validators and user confirmations.
- Treating AI SDK as the business workflow engine.

## RH Agent Review Lens

When reading the RH Agent implementation material, evaluate:

- What business state model does it use?
- How does it separate planning, action proposal, execution, and persistence?
- How does it represent tools and permissions?
- How does it handle user confirmation and irreversible/high-cost actions?
- How does it recover from partial failure?
- How much logic is deterministic code versus model prompt behavior?
- Which parts depend on OpenClaw and need to be translated to Vercel AI SDK?
- Which parts are product-specific and should not be copied directly into AD Studio?

## Desired Output After Reading RH Material

Produce an AD Studio-specific implementation proposal:

- What to keep from the current scaffold.
- What to replace with AI SDK.
- What RH Agent patterns are worth borrowing.
- What the first milestone should be.
- What files/modules would likely change.
- Which risks or product assumptions need validation before deeper buildout.

## RH Agent Material Notes

Source reviewed: `/Users/hakunamatata/Downloads/资料/RH_Agent_design_review.md`.

RH Agent is not mainly a single prompt or hard-coded backend state machine. It is closer to a soft-protocol orchestration system:

- Skill.md SOPs define phases and role-specific rules.
- A soft State block tracks control flow.
- creative-doc tracks content artifacts such as outline, script, and clip table.
- canvas-snapshot is the asset truth source.
- anchorRegistry maps semantic assets to real node IDs and binding order.
- media-context injects visual keyframes into the model.
- create_workflow / update_node_params / run_node execute canvas actions.

Strong patterns to borrow:

- Separate control flow, content flow, and asset flow.
- Treat canvas snapshot as the truth source for node IDs, status, and output URLs.
- Use an anchor registry before video prompt compilation.
- Gate high-risk steps with user confirmation.
- Split ad production into reverse analysis, strategy outline, anchor generation, script, shot timing, prompt compile, workflow assembly, and repair.
- Use precondition checks before each transition.

Weaknesses to avoid:

- Do not keep State and creative-doc only in conversation context.
- Do not rely on loose Markdown fences where hard Zod schemas are practical.
- Do not let the model invent node IDs or assume missing output URLs.
- Do not claim automatic visual QA unless the system actually polls, samples frames, and evaluates outputs.
- Do not rely on implicit edge order for semantic asset binding if explicit role metadata can be stored.

AD Studio translation:

- Use AD Studio's own persistent runtime objects instead of RH's loose State / creative-doc text blocks.
- Keep `CanvasNode`, `CanvasEdge`, `AgentRuntimeState`, `PendingAgentConfirmation`, and `LlmAgentOutput` as the hard contracts.
- Add dedicated protocol objects for `ReferenceAnalysis`, `CreativePlan`, `AnchorRegistry`, `ScriptDoc`, `ClipTable`, `PromptPack`, and `WorkflowPlan`.
- Use Vercel AI SDK structured output and tool calling to generate and invoke these objects.
- Use AI SDK tools as guarded adapters over AD Studio actions, not as direct uncontrolled canvas mutation.

## learn-claude-code Notes

Source reviewed: `/Users/hakunamatata/Desktop/CodeX项目/GitHub/learn-claude-code`.

The main design idea is "model as agent, code as harness". The model should reason and choose actions. The product code should provide:

- Capabilities / tools.
- On-demand knowledge.
- Observations and context.
- Action interfaces.
- Permissions and guardrails.

Important patterns:

- Keep the core loop simple: model sees context and tools, chooses tool use or final response.
- Add tools by adding handlers, not by rewriting the loop.
- Use planning / todo as a focus aid, not a rigid workflow engine.
- Use subagents for context isolation when exploration would pollute the main conversation.
- Load skills / domain knowledge on demand instead of stuffing all instructions into the system prompt.
- Persist task graphs or project artifacts outside the model context when they must survive compression or restart.
- Use request-response protocols for approvals and high-risk actions.
- Add autonomy gradually only after task state, permissions, and recovery paths exist.

Implication for AD Studio:

- Avoid turning the ad workflow into a rigid if/else pipeline too early.
- Make the hard layer describe available capabilities, facts, permissions, and artifact schemas.
- Let the model choose which stage/tool is appropriate within those boundaries.
- Keep facts hard: asset status, node IDs, output URLs, locked anchors, user approvals, generation costs, and irreversible actions.
- Keep creative strategy soft: whether to ask more, propose variants, adapt a RH-like phase, or route to quick generation.

Revised stance:

AD Studio should not be "hard-coded business workflow + AI SDK". It should be "domain harness + guarded tools + structured artifacts + flexible model planning". RH Agent's phase objects are useful, but the phase transition logic should be suggestive and recoverable, not a brittle state machine.

## Feishu Roadmap Maintenance

Source wiki URL: `https://my.feishu.cn/wiki/NFwIwVIGOiwKHYklb0IcKpI1nlo`.

Resolved Feishu document:

- Wiki token: `NFwIwVIGOiwKHYklb0IcKpI1nlo`
- Docx token: `KnrEdbQ1xo3qeZxXVtoc622TnCf`
- Title: `AD Studio Agent 长期开发方案`

Maintenance rule:

- Update by replacing or rewriting existing sections.
- Do not append repeated update logs to the end of the document.
- Keep the Feishu roadmap aligned with `AD_STUDIO_AGENT_AI_SDK_ROADMAP.md`.

## Persistence Design Merge Notes

Source reviewed: `AD_STUDIO_AGENT_BACKEND_PERSISTENCE_DESIGN.md`.

The persistence thread's core conclusion has been merged into the roadmap:

- localStorage and `.next/cache` can support a single-user demo, but must not become the production fact source.
- Critical durable objects are `AgentArtifacts`, `ApprovalRequest`, `CanvasSnapshot`, `GenerationTask`, and `EventLog`.
- No-backend MVP should introduce store adapters over local/project JSON first.
- Production backend should use Postgres/Supabase as the fact source, object storage for media, and KV only for short-lived locks/cache/idempotency.
- Roadmap section 6 now includes a dedicated `6.7 第五阶段：后端与持久化`.
- Milestones now include `Milestone 2.5：Persistence MVP` and `Milestone 5.5：Generation Persistence`.

Feishu updates applied:

- `6.1 当前项目现状`
- `6.2 建议新增目录`
- `6.4 第二阶段：Artifacts 硬协议`
- `6.6 第四阶段：Approval Flow`
- `6.7 第五阶段：后端与持久化`
- `6.8 第六阶段：AI SDK Streaming UI`
- `6.9 第七阶段：ToolLoopAgent`
- `6.10 与现有文件的映射`
- `6.11 开发里程碑`
- `6.12 测试策略`
- `6.13 风险与对策`
- `6.14 决策原则`
- `7. 参考资料`

## QA / Evaluation / Risk Control Merge Notes

Source reviewed: `AD_STUDIO_AGENT_QA_EVALUATION_RISK_CONTROL.md`.

The QA thread's core conclusion has been merged into the roadmap:

- Agent QA must evaluate reliability, advertising production quality, hard risk control, and recovery ability.
- P0 risks are unconfirmed credit spend, hallucinated product claims, wrong nodeId references, and context loss.
- Credits-consuming actions must bind approval id, action hash, idempotency key, event log, and execution trace.
- Product claims should be backed by a `ProductFactRegistry` or explicit user confirmation before entering final script, CTA, or prompt.
- Golden scenarios should cover insufficient input, parsed competitor material, anchor not ready, unconfirmed credits, wrong nodeId, provider failure, and refresh recovery.
- Automated QA covers schemas, permissions, preconditions, canvas validator, prompt compiler, persistence, tool result, mock provider, approvals, and regression scenarios.
- Human QA remains required for final ad usability, competitor similarity, marketing quality, localization, and product claim suitability.

Roadmap sections updated:

- `5.4 权限与确认策略`
- `5.9 QA 与评估指标`
- `6.6 第四阶段：Approval Flow`
- `6.11 开发里程碑`
- `6.12 测试策略`
- `6.13 风险与对策`
- `7. 参考资料`

## AI SDK Adaptation Merge Notes

Source reviewed: `AD_STUDIO_AGENT_AI_SDK_ADAPTATION_ASSESSMENT.md`.

The AI SDK adaptation thread's core conclusion has been merged into the roadmap:

- Milestone 1 should only close the `generateText` + `Output.object()` provider/structured-output path.
- `tool()`, `ToolLoopAgent`, `createAgentUIStreamResponse`, and `useChat` stay after guarded tools, approval, artifacts, persistence, and streaming adapters are stable.
- Current `package.json` already has `ai` and `@ai-sdk/google`; `@ai-sdk/react` is not installed and should wait until Streaming + Tool Status.
- `decision-provider.ts` and `gemini-agent.ts` already represent the M1 direction; next work should improve observability, fallback reason tracking, and typed error categories.
- AI SDK `needsApproval` should not replace AD Studio's durable approval record; it requires UI mapping and a follow-up model/tool flow.
- ToolLoopAgent needs strict step limits, `activeTools`, timeout, cost guard, event log, and approval boundaries.

Roadmap sections updated:

- `2.3 Vercel AI SDK：适合承接 Agent 基座`
- `6.3 第一阶段：AI SDK Provider + Structured Output`
- `6.5 第三阶段：Guarded Proposal Tools`
- `6.8 第六阶段：AI SDK Streaming UI`
- `6.9 第七阶段：ToolLoopAgent`
- `6.13 风险与对策`
- `7. 参考资料`

## UX / Playbook Acceptance Merge Notes

Source reviewed: `AD_STUDIO_AGENT_UX_PLAYBOOK_ACCEPTANCE.md`.

The UX/playbook thread's core conclusion has been merged into the roadmap:

- The roadmap must drive implementation, not just document maintenance.
- Playbooks are now defined as executable UX acceptance paths: recommended production path + preconditions + confirmation points + canvas artifacts + failure recovery.
- Four first-stage paths must be testable: competitor clone, create from zero, quick generation upgrade to Agent project, and partial repair.
- Agent UX should be judged by whether the user can move work into inspectable, confirmable, recoverable canvas artifacts under controlled cost.
- Confirmation cards and failure cards are core product controls, not generic chat messages.
- Canvas remains the fact source; chat remains the control console.
- First-stage UX acceptance scripts now live in the testing strategy section and should be used by implementation threads.

Roadmap sections updated:

- `4.3 把 RH 的 phase 改成可验收 Playbook`
- `5.7 UI 设计要求`
- `5.8 失败恢复策略`
- `6.12 测试策略`
- `7. 参考资料`

Execution stance:

- After merging the remaining already-completed design threads, new work should move to implementation threads.
- Milestone 1 is implemented and audited.
- Milestone 2 is implemented and audited at the schema/snapshot boundary.
- Milestone 2.5 is implemented and audited at the workspace-backed artifact persistence boundary.
- Milestone 3 is implemented and audited as a guarded tool schema/executor MVP.
- Milestone 3.1 is implemented and audited as a PM-hand-clickable golden path where Agent saves a visible artifact and returns a non-executable production proposal.
- Milestone 3.2 is implemented and main-thread audited as the interaction intake/state-flow stabilization milestone. The accepted boundary is: every user-authored chat message goes through Agent runtime/snapshot and `/api/agent/decide`; homepage startup prompts do not prewrite `originalPrompt` / `creativeGoal`; stale pending turns are not restored as active; question card submissions write structured facts and re-enter Agent decision; model failures show friendly retry-only UI and do not open business cards.
- M3.2 verification passed via `corepack pnpm exec tsc --noEmit`, `corepack pnpm lint`, `corepack pnpm build`, and `corepack pnpm exec node scripts/m32-acceptance.mjs`. Main thread also removed a dead-code risk where the old fallback runtime could still render a fixed intake card if accidentally reused.
- Remaining M3.2 risk: real KIE OpenAI-compatible provider has tail latency and may still hit timeout/network instability. This is provider stability work, not an M3.2 UI/state-flow blocker. KIE can remain short-term; official Gemini / AI Gateway / openai-compatible AI SDK provider evaluation belongs to M3.2.5 or provider-stability work.
- Milestone 3.2.5 AI SDK foundation is implemented and main-thread audited at the adapter/foundation boundary. Accepted pieces: provider metadata/error reason/latency/retry layer, message lifecycle types, AI SDK UIMessage adapter, `LlmAgentOutput` to `AgentEvent` adapter, and schema-only guarded-tool-to-AI-SDK-tool adapter. It intentionally does not add `useChat`, streaming UI, `ToolLoopAgent`, canvas reducer execution, database work, or `/api/vidu/generate`.
- M3.2.5 verification passed via `corepack pnpm exec node scripts/m325-ai-sdk-foundation.mjs`, `corepack pnpm exec node scripts/m32-acceptance.mjs`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm lint`, and `corepack pnpm build`. The transient global TypeScript blocker from M3.5 (`agent-project-store.typecheck.ts` missing `agent-project-store.ts`) has been fixed and no longer blocks M3.2.5 acceptance.
- Milestone 3.3 conversation regression automation is implemented and main-thread audited. `scripts/m33-regression.mjs` runs the M3.2 baseline, adds mock-provider coverage for text-only reference description submission and homepage second-task isolation, and keeps real-provider smoke opt-in via `M33_REAL_PROVIDER_SMOKE=1`. `AD_STUDIO_AGENT_M33_ACCEPTANCE.md` is the PM-readable checklist. Future UI/state-flow changes must run `corepack pnpm accept:m33` in addition to type/lint/build checks.
- Backend fact source MVP design has been reviewed in `AD_STUDIO_AGENT_BACKEND_MVP_PLAN.md` as a candidate M3.5 gate. It should follow M3.2 UI stabilization and precede executable M4 Canvas Tools.
- The reviewed backend design is directionally accepted with two main-thread corrections: artifact record statuses must reuse existing `artifactStatusSchema` names, and `ApprovalRequest` must distinguish user approval from execution success/failure.

## Milestone 1 Implementation Audit Notes

Source thread result reviewed: AI SDK Provider + Structured Output implementation.

Code paths reviewed:

- `package.json`
- `pnpm-lock.yaml`
- `src/features/agent-runtime/ai-sdk/model-config.ts`
- `src/features/agent-runtime/ai-sdk/decision-provider.ts`
- `src/lib/gemini-agent.ts`
- `src/app/api/agent/decide/route.ts`
- `src/features/agent-runtime/llm/agent-output-schema.ts`

Accepted implementation boundaries:

- `ai` and `@ai-sdk/google` are installed.
- Official Google Gemini path uses `generateText` + `Output.object`.
- `/api/agent/decide` top-level response shape remains `{ output, runtime }`.
- `llmAgentOutputSchema` remains the final validation contract.
- Direct Gemini and OpenAI-compatible/KIE fallback remain.
- No `ToolLoopAgent`, no `useChat`, no streaming UI, no high-cost generation execution.

Main audit fix applied by main thread:

- Added runtime observability for `aiSdkAttempted`, `aiSdkUsed`, `fallbackUsed`, `fallbackReason`, `decisionSource`, AI SDK warnings, and usage summary.
- Sanitized runtime URL/query exposure and provider error details before returning API-visible errors.

Verification run in main thread:

- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed. Next emitted local SWC code-signature warnings and fell back to WASM, then completed successfully.

Remaining risk:

- AI SDK path covers official Google Generative AI provider only.
- OpenAI-compatible/KIE should stay on direct fallback until a provider matrix confirms baseURL, model field, and request-body extensions.
- Real-model curl verification consumes text-model tokens and should only be run intentionally.

## Milestone 2 Implementation Audit Notes

Source thread result reviewed: Artifacts Schema / Store / Snapshot boundary implementation.

Code paths reviewed:

- `src/features/agent-runtime/artifacts.ts`
- `src/features/agent-runtime/artifact-store.ts`
- `src/features/agent-runtime/artifacts.typecheck.ts`
- `src/features/agent-runtime/agent-snapshot.ts`
- `src/features/workbench/agent-types.ts`
- `src/features/workbench/agent-orchestrator.ts`
- `src/lib/gemini-agent.ts`
- `AD_STUDIO_AGENT_ARTIFACTS_SCHEMA_DESIGN.md`

Accepted implementation boundaries:

- `ReferenceAnalysis`, `CreativePlan`, `AnchorRegistry`, `ScriptDoc`, `ClipTable`, `PromptPack`, `WorkflowPlan`, `RepairPlan`, and `AgentArtifacts` now have Zod schemas and TypeScript types.
- `AgentInputSnapshot` now carries `artifacts: AgentArtifactSnapshot`, which is a compact summary rather than full artifact content.
- `AgentRuntimeState` can hold optional `AgentArtifacts`, and new runtime initialization creates empty artifacts.
- `ArtifactStore` is only an interface plus memory/browser-local adapters; no backend database is introduced.
- `/api/agent/decide` response shape remains unchanged.
- No ToolLoopAgent, no real model generation, no media generation, no high-cost execution.

Main audit fix applied by main thread:

- Empty artifacts no longer emit a fake `1970-01-01` `updatedAt`, so snapshot does not imply historical artifact activity when no artifact exists.

Verification run in main thread:

- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.

Remaining risk:

- Artifacts are initialized and summarized, but no UI/tool path writes real artifacts yet.
- Browser localStorage adapter is acceptable for M2 boundary work, but M2.5 must connect artifacts to project-level store/persistence and restore failure events.
- Versioning, overwrite protection, canvas node artifact links, and durable approval binding are still future work.

## Milestone 2.5 Implementation Audit Notes

Source thread result reviewed: Persistence MVP for workspace-backed artifacts.

Code paths reviewed:

- `src/lib/agent-workspace-model.ts`
- `src/lib/agent-workspace-store.ts`
- `src/app/api/agent/workspace/route.ts`
- `src/components/app-shell/AdStudioApp.tsx`
- `src/features/agent-runtime/artifact-store.ts`
- `src/features/workbench/AgentWorkbenchView.tsx`
- `src/features/agent-runtime/artifacts.typecheck.ts`
- `AD_STUDIO_AGENT_ARTIFACTS_SCHEMA_DESIGN.md`

Accepted implementation boundaries:

- `StoredAgentWorkspace` now carries `artifacts` and `eventLog`.
- Workspace-backed `ArtifactStore` persists through browser workspace state, `/api/agent/workspace`, and `.next/cache/ad-studio-agent-workspace.json`.
- Runtime artifacts are restored into `AgentRuntimeState.artifacts`, while `AgentInputSnapshot.artifacts` remains summary-only.
- Legacy `ad-studio:agent-artifacts:v1:${sessionId}` can migrate into workspace.
- EventLog MVP covers `artifact.saved`, `artifact.loaded`, and `artifact.restore_failed`.
- `/api/agent/decide` response shape remains unchanged.
- No ToolLoopAgent, no real model generation, no media generation, no high-cost execution.

Main audit fix applied by main thread:

- `createBrowserWorkspaceArtifactStore` now preserves the workspace envelope with active sessions when merging browser-local and API workspace drafts. This prevents a stale/default API workspace from overwriting local session records while artifact/event collections are being merged.

Verification run in main thread:

- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed. Next emitted local SWC code-signature warnings and fell back to WASM, then completed successfully.

Remaining risk:

- EventLog is still a JSON array, not database append-only; multi-tab writes can still be last-write-wins.
- `projectId` currently equals `sessionId`; migrate when real project IDs exist.
- Approval, Canvas graph, and GenerationTask are not yet unified under durable stores.
- No tool writes real artifacts yet; M3 should start with proposal-only tools and continue to avoid high-cost execution.

## Milestone 3 Implementation Audit Notes

Source thread result reviewed: Guarded Proposal Tools MVP.

Code paths reviewed:

- `src/features/agent-runtime/guarded-tools.ts`
- `src/features/agent-runtime/guarded-tools.typecheck.ts`
- `src/features/agent-runtime/llm/agent-tool-schema.ts`
- `AD_STUDIO_AGENT_AI_SDK_ROADMAP.md`

Accepted implementation boundaries:

- `askUser`, `saveArtifact`, `proposeActionBatch`, and `inspectCanvas` now have Zod input schemas and unified `AgentToolResult`.
- Tool results explicitly distinguish `ok`, `blocker`, `needs_approval`, and `error`.
- `saveArtifact` uses workspace-backed `ArtifactStore.save()` and therefore relies on artifact persistence/event logging from M2.5.
- `proposeActionBatch` returns a non-executable confirmation proposal and blocks generation/version actions in M3.
- `inspectCanvas` only reads the supplied `CanvasSnapshot`; unknown node ids return blocker.
- `agent-tool-schema.ts` keeps the old `agentToolSchemas` export name while pointing to the guarded registry.
- `/api/agent/decide` response shape remains unchanged.
- No ToolLoopAgent, no real model generation, no media generation, no canvas reducer execution, no high-cost execution.

Verification run in main thread:

- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed. Next emitted local SWC code-signature warnings and fell back to WASM, then completed successfully.

Product acceptance gap closed by M3.1:

- M3 was code-level complete but not PM-experience complete.
- M3.1 now connects `inspectCanvas`, `saveArtifact`, and `proposeActionBatch` into a visible Agent golden path in the UI.
- The golden path is intentionally deterministic and local; it is a product acceptance bridge, not final ToolLoopAgent behavior.

Remaining risk:

- No AI SDK tool runtime or ToolLoopAgent integration yet.
- No durable ApprovalRequest yet; proposal confirmations are non-executable placeholders.
- `saveArtifact` overwrite protection still needs durable versioning before confirmed artifacts can be safely replaced.

## Milestone 3.1 Implementation Audit Notes

Source thread result reviewed: PM Golden Path for guarded proposal tools.

Code paths reviewed:

- `src/features/agent-runtime/m3-golden-path.ts`
- `src/features/agent-runtime/m3-golden-path.typecheck.ts`
- `src/features/workbench/AgentWorkbenchView.tsx`
- `src/features/agent-runtime/AgentEventRenderer.tsx`
- `src/app/globals.css`

Accepted implementation boundaries:

- `runM3GoldenPathDemo` uses the existing guarded executors: `executeInspectCanvasTool`, `executeSaveArtifactTool`, and `executeProposeActionBatchTool`.
- It saves a `creativePlan` artifact through the workspace-backed `ArtifactStore`.
- It reloads artifacts after save and places the resulting artifact state into `AgentRuntimeState.artifacts`, so snapshot summary can be rendered and recovered after refresh.
- It returns a `needs_approval` confirmation with `executable: false`.
- It does not return `canvasActions`, does not call canvas reducer execution, and does not call media generation.
- `AgentWorkbenchView` routes M3.1 trigger text into the local orchestrated path both on initial workbench boot and on explicit composer submit.
- `AgentEventRenderer` shows `executable: false` and hides the confirm button for non-executable proposal cards.

Main audit fix applied by main thread:

- `inferReferenceMode` now prioritizes explicit strict/clone intent before the generic `结构` keyword, so the golden prompt `严格复刻剧情结构` is saved and rendered as `严格复刻剧情结构` rather than `只参考节奏和叙事结构`.

Verification run in main thread:

- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed. Next emitted local SWC code-signature warnings and fell back to WASM, then completed successfully.
- HTTP check: `http://127.0.0.1:3010` returned 200.
- Workspace check: `/api/agent/workspace` contained the reported M3.1 session and `creativePlan` artifact.
- Playwright check on `/ad-workbench`: first load and refresh both showed `M3.1 PM Golden Path 本地编排`, `已保存 creativePlan`, `Artifact summary 已进入 runtime snapshot`, `executable: false`, and `0 nodes · 0 links · 0 credits`.
- Playwright full flow from homepage: filled the M3.1 prompt, clicked `创建复刻任务`, entered Workbench, refreshed, and saw the same acceptance signals.
- Playwright follow-up check confirmed `参考程度: 严格复刻剧情结构` appears both before and after refresh.
- Playwright request log for the full flow did not include `/api/agent/decide` or `/api/vidu/generate`; it only hit `/api/agent/workspace` and existing `/api/vidu/history`.
- Temporary Playwright-created session was deleted through `/api/agent/workspace?sessionId=...`.

Remaining risk:

- This is still a deterministic local orchestrated path, not AI SDK `ToolLoopAgent`.
- Trigger keywords are intentionally demo-oriented (`M3`, `M3.1`, `golden path`, `guarded tools`, `安全演示`, `本地演示`) and should be removed or replaced when real tool-loop routing lands.
- Repeated refreshes can append additional artifact loaded/saved events in the JSON event log; durable event semantics still belong to the later backend phase.
- The next step should not make proposal cards executable until durable ApprovalRequest and canvas mutation audit logs exist.
