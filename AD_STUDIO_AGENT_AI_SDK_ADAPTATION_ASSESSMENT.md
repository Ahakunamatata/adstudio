# AD Studio Agent AI SDK 技术适配评估

日期：2026-05-20  
范围：基于 Vercel AI SDK v6 官方文档，评估 AD Studio Agent 对 `generateText`、`Output.object`、`tool()`、`ToolLoopAgent`、`createAgentUIStreamResponse`、`useChat` 的适配顺序和风险。  
约束：本评估不改核心源码；不基于旧版本记忆推断 API；结论以官方文档和当前代码为准。

---

## 1. 结论

AD Studio 的 Milestone 1 应只做 AI SDK Provider + Structured Output 的稳定替换：

- 使用 `generateText` 承接当前 `/api/agent/decide` 的非流式决策调用。
- 使用 `Output.object({ schema: llmAgentOutputSchema })` 替代手写 JSON 提取和 parse。
- 保持现有 `LlmAgentOutput`、`AgentEventRenderer`、`AgentWorkbenchView` 和 `/api/agent/decide` 响应格式不变。
- 保留 direct Gemini / OpenAI-compatible fetch 作为兼容 fallback，直到 provider 覆盖被验证。

必须后置：

- `tool()`：适合 Milestone 3 起做 guarded proposal tools，不适合 Milestone 1。
- `ToolLoopAgent`：适合 tools、approval、artifact、event log 稳定后再引入。
- `createAgentUIStreamResponse`：适合新增 `/api/agent/chat` 和 UIMessage 映射后使用。
- `useChat`：适合 Streaming + Tool Status 阶段，不应为了接 hook 重写当前工作台。

---

## 2. 官方 API 对照

| API | 官方文档要点 | AD Studio 适配判断 | 里程碑 |
| --- | --- | --- | --- |
| `generateText` | 从 `ai` 导入；支持 `model`、`system`、`prompt/messages`、`tools`、`activeTools`、`stopWhen`、`output`、`timeout`；返回 `text`、`output`、`toolCalls/toolResults`、`steps`、`warnings`、usage 和 response metadata。 | 最适合当前 `/api/agent/decide`。M1 只使用 `model/system/prompt/output/timeout/maxRetries`，暂不启用 tools。 | M1 |
| `Output.object` | 用于 `generateText` / `streamText` 的结构化输出；完整 output 会按 schema 校验；streaming partial output 是 deep partial，不能按完整 schema 验证。 | 适合当前 `llmAgentOutputSchema`。后续 artifact schema 应拆小对象逐步接入，避免一次塞入过大 schema。 | M1 起 |
| `tool()` | 是工具定义的类型推断 helper；使用 `inputSchema`，可选 `outputSchema`、`execute`、`needsApproval`、`strict`。无 `execute` 时不会自动执行。 | 适合作为 AD Studio guarded tool registry 的实现方式，但必须包住 canvas validator / permission / blocker。 | M3+ |
| `ToolLoopAgent` | 封装 LLM + tools + loop；`generate()` 返回 `GenerateTextResult`，`stream()` 返回 `StreamTextResult`；默认 agent loop 可到 20 steps，可用 `stopWhen`、`activeTools`、`prepareStep` 控制。 | 不适合 M1。AD Studio 还没有稳定 tools、approval、artifact 和成本边界，直接上 loop 会放大成本和状态风险。 | M6/M7 后 |
| `createAgentUIStreamResponse` | 执行一个 Agent，把 `.stream()` 输出转成 UI message stream，并返回 HTTP `Response`。需要 `agent` 和 `uiMessages`。 | 依赖 UIMessage 数据结构和 Agent `.stream()`。当前工作台是自定义 `AgentMessage/AgentEvent`，需要先做适配层。 | M6 |
| `useChat` | 从 `@ai-sdk/react` 导入；v6 使用 transport-based architecture；默认走 `DefaultChatTransport` 到 `/api/chat`；不再内部管理 input state。 | 当前项目未安装 `@ai-sdk/react`，工作台也不是 UIMessage 状态。应后置到 streaming 阶段，先保持现有 UI。 | M6 |

---

## 3. Milestone 1 适配边界

### 适合放入 Milestone 1

- `src/features/agent-runtime/ai-sdk/decision-provider.ts` 作为唯一 AI SDK provider 入口。
- `generateText` + `Output.object` 生成 `LlmAgentOutput`。
- 保持 `src/lib/gemini-agent.ts` 里的 direct fetch fallback。
- 给 runtime metadata 增加可观测字段的设计要求：`aiSdkAttempted`、`aiSdkUsed`、`fallbackReason`、`modelId`、`warnings`、`totalUsage`。实现时不得输出 key 或完整请求体。
- 对结构化输出失败做可统计错误类型：`NoObjectGeneratedError`、Zod schema issue、provider HTTP error、timeout。

### 不应放入 Milestone 1

- 不新增 `ToolLoopAgent`。
- 不把 `agent-tool-schema.ts` 直接改成可执行 tools。
- 不接 `createAgentUIStreamResponse`。
- 不接 `useChat` 或引入 `@ai-sdk/react`。
- 不让模型直接执行 `runNodeGeneration`、`appendVersion`、`lockNode` 等会改变生产事实的动作。

---

## 4. 当前代码适配建议

当前代码已经具备 M1 的雏形：

- `package.json` 已有 `ai@^6.0.185` 和 `@ai-sdk/google@^3.0.75`。
- `src/features/agent-runtime/ai-sdk/decision-provider.ts` 已使用 `generateText`、`Output.object`、`NoObjectGeneratedError` 和 `@ai-sdk/google`。
- `src/lib/gemini-agent.ts` 已把 AI SDK structured output 放在 direct fetch 前面，并保留 fallback。
- `src/features/agent-runtime/llm/agent-output-schema.ts` 已有 `llmAgentOutputSchema`，能继续作为 M1 对外 contract。
- `src/features/agent-runtime/canvas-action-validator.ts` 已经阻止第一版 Agent 直接触发生成任务、阻止写入占位媒体结果，应继续作为后续 tools 的硬边界。

建议按以下方式收口：

1. 明确 M1 成功标准是“当前 Agent 对话行为兼容，结构化输出由 AI SDK 生成并可观测”，不是“开始 tool calling”。
2. 保持 `decision-provider.ts` 小而稳定，不引入 canvas/action 逻辑。
3. 将当前 catch 后静默 fallback 的行为改为可观测设计，但不要在用户响应里暴露 secrets、请求体或完整 provider payload。
4. `llmAgentOutputSchema` 现在有大量 preprocess，适合兼容当前 UI；后续 artifact schema 应比它更严格，不要继续靠宽松 normalize 承担事实层。
5. `agent-snapshot.ts` 目前没有 `artifacts` 和 `permissions`，这正好说明 ToolLoopAgent/useChat 还不应提前接入。
6. `agent-tool-schema.ts` 目前只是工具名草稿，后续应升级为 `tool()` registry，但每个 tool 的 `execute` 必须调用 AD Studio guard/reducer，而不是直接信任模型输入。
7. `@ai-sdk/react` 当前未安装，M1 不需要安装；到 M6 再按官方 `useChat`/transport 文档引入。

---

## 5. API 与版本风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| AI SDK v6 API 仍在变动 | `Output.object`、agent callbacks、UI stream、transport 参数可能随 patch/minor 调整。 | 以 lockfile + installed typecheck 为准；涉及 AI SDK 的 PR 必须跑 `pnpm build` 或至少 `pnpm lint` + TS 检查。 |
| `generateText.output` 在 reference 中标为 experimental setting | structured output 行为可能受 provider 差异影响。 | 保留 direct fetch fallback；记录 `NoObjectGeneratedError`；schema 先小后大。 |
| Google provider structured output 兼容性 | 当前代码设置 `providerOptions.google.structuredOutputs: false`，说明原生 structured output 不能盲信。 | M1 继续走 AI SDK output validation；不要把 provider 原生 schema 当唯一保障。 |
| OpenAI-compatible KIE/Gemini endpoint 不等于 AI SDK Google provider | 当前 `apiFormat === "openai"` 会 fallback，AI SDK provider 不一定覆盖该 endpoint。 | 不发明 custom provider；先保留 direct fetch；后续单独做 provider matrix。 |
| `tool().strict` 不是所有 provider/model 都支持 | 设错会被忽略或限制 schema。 | per-tool 启用；只给简单稳定 schema 开 strict；复杂 schema 用常规 validation + blocker。 |
| `needsApproval` 不是同步暂停 | 官方流程是第一次返回 approval request，用户响应后第二次模型调用才执行或拒绝。 | 不把它当现有 `PendingAgentConfirmation` 的直接替代；先设计 approval record 和 UI 映射。 |
| `ToolLoopAgent` 默认最多 20 steps | 成本、延迟、错误传播风险高。 | 后置；使用 `stepCountIs(2-5)`、`activeTools`、timeout、event log、cost guard。 |
| `createAgentUIStreamResponse` 需要 UIMessage/Agent stream | 当前 `AgentMessage` / `AgentEvent` 与 UIMessage parts 不同。 | M6 先做 adapter，不重写工作台。 |
| `useChat` v6 transport 架构与旧 hook 不兼容 | 直接迁移会冲击输入框、pending turn、history、canvas event。 | 延后；用 `DefaultChatTransport` 和 `prepareSendMessagesRequest` 承载 session/canvas metadata。 |
| `@ai-sdk/react` 未安装 | M6 前接 useChat 会新增依赖和状态迁移。 | M1 不安装；M6 再加并验证 bundle/runtime。 |

---

## 6. 官方资料

- Vercel AI SDK `generateText`: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
- Vercel AI SDK Generating Text: https://ai-sdk.dev/docs/ai-sdk-core/generating-text
- Vercel AI SDK `Output`: https://ai-sdk.dev/docs/reference/ai-sdk-core/output
- Vercel AI SDK Tools and Tool Calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Vercel AI SDK `tool()`: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool
- Vercel AI SDK Agents Overview: https://ai-sdk.dev/docs/agents/overview
- Vercel AI SDK Loop Control: https://ai-sdk.dev/docs/agents/loop-control
- Vercel AI SDK `ToolLoopAgent`: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Vercel AI SDK `createAgentUIStreamResponse`: https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response
- Vercel AI SDK `useChat`: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- Vercel AI SDK UI Transport: https://ai-sdk.dev/docs/ai-sdk-ui/transport

---

## 7. 建议更新飞书文档

以下内容不是追加到文末，而是建议主线程按章节替换合并。

### 7.1 替换章节：`2.3 Vercel AI SDK：适合承接 Agent 基座`

替换原因：原章节方向正确，但没有明确哪些 API 只能后置，也没有写清 `needsApproval`、`ToolLoopAgent` 和 UI stream 的边界。

建议替换文本：

````md
### 2.3 Vercel AI SDK：适合承接 Agent 基座

Vercel AI SDK 适合做 AD Studio Agent 的模型调用和工具协议基座，但不应该替 AD Studio 定义广告业务规则。

基于 AI SDK v6 官方文档，当前可确认的适配边界是：

- `generateText` 适合承接当前非流式 Agent decision。它支持 `system`、`prompt/messages`、`output`、`tools`、`activeTools`、`stopWhen`、timeout、usage、warnings 和 step metadata。
- `Output.object()` 适合把当前 `LlmAgentOutput` 约束成 Zod schema 输出，是 Milestone 1 的核心。
- `tool()` 适合后续把 AD Studio 能力封装成 tools。工具使用 `inputSchema`，可选 `outputSchema`、`execute`、`needsApproval`、`strict`；但必须由 AD Studio guard/reducer 执行真实业务动作。
- `needsApproval` 不是同步暂停执行。官方流程是先返回 `tool-approval-request`，用户响应后再进行第二次模型调用，所以需要 AD Studio 自己的 approval record 和 UI 映射。
- `ToolLoopAgent` 适合 tools、approval、artifacts、event log 稳定后再使用；默认 agent loop 可到 20 steps，必须显式设置 `stopWhen`、`activeTools`、timeout 和成本边界。
- `createAgentUIStreamResponse` 和 `useChat` 适合 Streaming + Tool Status 阶段，不适合 Milestone 1 强行接入。

因此，AI SDK 在 AD Studio 中的角色应该是：

- Milestone 1：模型调用 + 结构化输出。
- Milestone 3-5：受保护 tools + approval flow。
- Milestone 6+：streaming UI + ToolLoopAgent。
````

### 7.2 替换章节：`6.3 第一阶段：AI SDK Provider + Structured Output`

替换原因：当前代码已经部分实现 M1，文档应从“计划安装依赖”更新为“收口现有 provider 实现并定义验收边界”；同时 `@ai-sdk/react` 不应放入 M1。

建议替换文本：

````md
### 6.3 第一阶段：AI SDK Provider + Structured Output

目标：

- 用 AI SDK `generateText` + `Output.object()` 承接当前 `/api/agent/decide` 的结构化决策。
- 保持现有工作台 UI、controller、`LlmAgentOutput` 和 API response 兼容。
- 保留 direct Gemini / OpenAI-compatible fetch fallback，直到 provider 覆盖被验证。
- 不在本阶段引入 `tool()`、`ToolLoopAgent`、`createAgentUIStreamResponse` 或 `useChat`。

当前代码状态：

- `package.json` 已包含 `ai` 和 `@ai-sdk/google`。
- `src/features/agent-runtime/ai-sdk/decision-provider.ts` 已使用 `generateText`、`Output.object` 和 `llmAgentOutputSchema`。
- `src/lib/gemini-agent.ts` 已把 AI SDK structured output 放在 direct fetch fallback 前。

第一阶段应补齐的工程要求：

- runtime metadata 记录 `aiSdkAttempted`、`aiSdkUsed`、`fallbackReason`、`modelId`、`warnings`、usage，但不得输出 secrets 或完整请求体。
- 结构化输出失败要能区分 `NoObjectGeneratedError`、Zod schema error、provider HTTP error、timeout。
- `llmAgentOutputSchema` 仍是对外 contract；artifact schema 暂不并入本阶段。
- `@ai-sdk/react` 暂不安装，等 Streaming + Tool Status 阶段再引入。

验收标准：

- `/api/agent/decide` 返回格式不变。
- 现有 Agent 对话能正常工作。
- schema parse 成功率和 fallback 次数可观测。
- 错误信息不泄露 API key、请求 body 或原始 provider payload。
````

### 7.3 替换章节：`6.5 第三阶段：Guarded Tools`

替换原因：原章节只列工具名，需明确 AI SDK `tool()` 的官方字段、approval 行为，以及 AD Studio guard 的职责边界。

建议替换文本：

````md
### 6.5 第三阶段：Guarded Proposal Tools

目标：

- 把 `agent-tool-schema.ts` 从工具名草稿升级为 AI SDK `tool()` registry。
- 第一批只做 proposal / inspect / save 类工具，不直接执行高成本或不可逆动作。

AI SDK 工具定义应使用：

- `description`：告诉模型何时使用工具。
- `inputSchema`：用 Zod 或 JSON Schema 校验模型输入。
- `outputSchema`：为工具结果提供类型约束。
- `execute`：只调用 AD Studio guard/reducer，不直接信任模型输入。
- `needsApproval`：仅用于需要用户确认的工具，但必须注意官方 approval 是两次模型调用流程。
- `strict`：只对 provider 支持且 schema 简单的工具逐个启用。

第一批工具：

```text
askUser
saveArtifact
proposeActionBatch
inspectCanvas
```

统一工具结果：

```ts
type AgentToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  blocker?: AgentBlocker;
  events: AgentEvent[];
  suggestedNextActions?: string[];
};
```

硬边界：

- 所有 canvas action 必须复用 `canvas-action-validator.ts`。
- 高成本生成、locked 节点修改、删除节点、覆盖最终结果必须先生成 approval request。
- 工具返回 blocker 时，模型只能重新规划或追问，不能伪造执行成功。
````

### 7.4 替换章节：`6.7 第五阶段：AI SDK Streaming UI` 和 `6.8 第六阶段：ToolLoopAgent`

替换原因：streaming、`useChat`、`ToolLoopAgent` 在官方 API 中相互依赖 UIMessage 和 agent stream，必须推迟到 tools/approval/artifacts 稳定之后。

建议替换文本：

````md
### 6.7 第六阶段：Streaming + Tool Status

目标：

- 新增 `/api/agent/chat`，让长任务、工具状态、approval request 可以流式呈现。
- 使用 `createAgentUIStreamResponse` 的前提是后端已有 Agent `.stream()`，并且前端能消费 UIMessage stream。
- 当前 `AgentMessage` / `AgentEvent` 需要先做 UIMessage adapter，不直接重写工作台。

前端策略：

- `useChat` 从 `@ai-sdk/react` 引入，但仅在本阶段安装。
- v6 `useChat` 使用 transport-based architecture，默认 `DefaultChatTransport` 指向 `/api/chat`。
- AD Studio 应通过 `DefaultChatTransport` / `prepareSendMessagesRequest` 传递 session、canvas snapshot、artifact summary 等 metadata。
- 当前输入框、pending turn、history、canvas event renderer 可以先保留，再逐步映射到 UIMessage parts。

验收标准：

- 用户能看到 Agent 正在分析、调用工具、等待确认。
- tool result / blocker / approval request 能映射到现有卡片。
- 长任务不会让 UI 像卡死。

### 6.8 第七阶段：ToolLoopAgent

目标：

- 在 tools、approval、guard、artifact、event log 都稳定后，再使用 `ToolLoopAgent`。

适合场景：

- 多步素材分析。
- blocker 后自动补问。
- repair 流程多步检查。
- 创建 plan 后继续生成 confirmation。

不适合场景：

- Milestone 1 的普通 Agent decision。
- 未确认的高成本视频生成。
- 直接修改画布状态或 locked 节点。

策略：

- 显式设置较小 `stopWhen`，不要依赖默认 20 steps。
- 使用 `activeTools` 限制每个阶段可用工具。
- 对高风险工具使用 approval，并写入 event log。
- 每一步记录 usage、model、tool result、blocker 和 affected node ids。
````

### 7.5 替换章节：`6.12 风险与对策`

替换原因：原风险表偏产品/架构，缺少 AI SDK v6 API 与版本风险。

建议替换文本：

````md
### 6.12 风险与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| AI SDK v6 API 变动 | `Output.object`、agent callbacks、UI stream、transport 参数可能随版本调整 | 以 lockfile 和官方文档为准；AI SDK 相关 PR 必须跑类型检查 |
| structured output provider 差异 | `generateText.output` 行为可能受 provider 支持影响 | 保留 fallback；统计 `NoObjectGeneratedError` 和 schema error |
| OpenAI-compatible endpoint 不等于 AI SDK provider | KIE/Gemini OpenAI-compatible 不一定能走 `@ai-sdk/google` | 不发明 provider；先保留 direct fetch；单独做 provider matrix |
| tool strict mode 支持不一致 | 不是所有 provider/model 支持 strict tool calling | per-tool 启用；复杂 schema 交给 guard 和 blocker |
| approval flow 误解 | `needsApproval` 返回 approval request，不是同步暂停 | 建立 AD Studio approval record，并处理第二次模型调用 |
| ToolLoopAgent 成本失控 | 默认 loop 可到 20 steps | 后置；设置小步数、activeTools、timeout、cost guard |
| UIMessage 迁移成本 | 当前工作台不是 AI SDK UIMessage 状态 | 先做 adapter；不要为了 `useChat` 重写工作台 |
| 上下文膨胀 | 素材解析、脚本、分镜会很长 | artifact summary + 按需加载 |
| 模型虚构状态 | 模型可能编造 nodeId、outputUrl、生成结果 | 事实源只来自 session/canvas/artifacts/tool result |
````
