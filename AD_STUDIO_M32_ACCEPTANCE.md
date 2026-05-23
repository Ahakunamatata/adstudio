# M3.2 Interaction Intake Cards Acceptance

Scope: Agent-driven conversation intake in `/ad-workbench`.

Out of scope: real media generation, canvas action execution, M3.5 backend fact store, M4 canvas tools.

## Hard Boundaries

- User-visible assistant replies must come from Agent structured output, except explicit system error states.
- Every user chat message should trigger `/api/agent/decide`.
- Do not add phrase-specific product routing for the acceptance sentences.
- `/api/vidu/generate` must be called 0 times.
- Canvas must stay `0 nodes · 0 links · 0 credits`.
- UI must not expose internal terms: `fallbackUsed`, `fallbackReason`, `runtime`, `workspace`, `snapshot`, `schema`, `Zod`, `structured fact`, `Agent LLM 决策失败`, `M3.2`, `provider`.
- Model failure can show friendly retry UI only. It must not open a clone intake card or claim the task was understood.
- Question card submit must write structured intake facts, then re-enter Agent decision.

## Manual Acceptance Checklist

Use the same entry: `http://127.0.0.1:3010/ad-workbench`.

Before testing:

1. Open DevTools Network.
2. Filter for `/api/agent/decide` and `/api/vidu/generate`.
3. Keep the canvas header visible.

### Case 1: Greeting Should Not Start A Task

Input: `hi`

Expected:

- Network shows one `/api/agent/decide` request.
- Agent responds naturally.
- No clone intake card appears.
- Project title remains neutral, and the header does not become a clone task.
- `originalPrompt` and `creativeGoal` are not written for this greeting.
- Canvas stays `0 nodes · 0 links · 0 credits`.
- `/api/vidu/generate` count is 0.

### Case 2: Start Clone Task

Input: `我要复刻一个广告`

Expected:

- Network shows `/api/agent/decide`.
- Agent returns a question card or a clear follow-up.
- If a card appears, it comes from structured question events.
- Fields focus on reference ad or competitor material, product or promoted subject, and reference mode.
- No generation, no canvas mutations, no credits.

### Case 3: Product Not Ready

Input: `我想复刻这个竞品，但是产品还没准备好`

Expected:

- Product is not forced as a required field.
- Agent offers reasonable paths: upload/describe reference material, add product later, paste a product link, or just save clone intent.
- No fixed full product-required clone card loop.
- Canvas stays empty, generation count is 0.

### Case 4: Submit Reference Material Or Description

Action:

1. In the card, upload a reference image/video, or fill a reference description.
2. Fill/select any other required fields shown by that card.
3. Submit the card.

Expected:

- Required-field validation is clear and disables submit until satisfied.
- The old card changes to submitted/saved state.
- Uploaded assets are saved into `uploadedAssets` and workspace/session state.
- Runtime contains an `intake_submission` fact with form id, answers, uploaded asset ids, timestamp, and source message id.
- Submit triggers `/api/agent/decide` again.
- Agent does not ask again for information already satisfied.

### Case 5: Supplement Product

Input: `产品是 location tracker`

Expected:

- Agent treats it as a supplement to the current task.
- It does not start a new task.
- It does not reopen a full fixed intake card.
- If only product was missing, Agent should move to the next missing boundary or a summary/confirmation preview.

### Case 6: User Says Not To Generate

Input: `先不要生成`

Expected:

- Agent explicitly says it will only save or organize the plan.
- No executable confirmation is shown.
- No visible executable canvas action is offered.
- `/api/vidu/generate` count is 0.
- Canvas stays `0 nodes · 0 links · 0 credits`.

### Case 7: Model Failure

Simulate `/api/agent/decide` failure by blocking the request, returning 500, or temporarily removing model credentials.

Input: `hi`

Expected:

- UI shows friendly connection failure and retry.
- UI does not show internal debug terms.
- No clone intake card appears.
- No brief/task semantics are written.
- User can retry.

### Case 8: Refresh Restore

After a successful card submission, refresh `/ad-workbench`.

Expected:

- Submitted product/reference information remains visible.
- Uploaded assets remain in session/workspace state.
- `intakeSubmissions` remain in runtime.
- The old card is still submitted/saved, not a fresh editable card.
- Agent does not rerun the initial startup turn just because the page refreshed.

## Automated Browser Acceptance

Run:

```bash
corepack pnpm accept:m32
```

The script:

- Opens the real `/ad-workbench` UI.
- Intercepts `/api/agent/decide` with deterministic structured output.
- Intercepts `/api/vidu/generate` and fails the test if it is called.
- Verifies `/api/agent/decide` call counts.
- Verifies internal debug terms are not visible.
- Verifies canvas count stays `0 nodes · 0 links · 0 credits`.
- Verifies required card fields, card submission, structured intake facts, uploaded assets, and refresh restore.

This test is for M3.2 UI/runtime acceptance. It intentionally avoids real model cost and real generation.

## Static Checks

The automated script also checks:

- `submitTextValue` does not directly create fixed intake runtime.
- Card submit does not create a local assistant reply as the formal response.
- Card submit re-enters Agent decision.
- Conversation shell routing is not present in the main flow.
- The acceptance test sentences are not hard-coded in product code.
- The fixed fallback intake function exists only in fallback/orchestrator code and is not called by the workbench main path.
