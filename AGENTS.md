# Ad Studio Codex Rules

Project alias: `adstudio`

Canonical project path:

```text
/Users/climber_glc/Desktop/AI_Climber/adstudio
```

## Resume Rule

When the user says only:

```text
继续 adstudio
```

treat it as a request to resume this project from the current filesystem state. Do not ask the user to restate the old chat history.

First read:

- `CODEX_HANDOFF.md`
- `git status --short`
- `git diff --stat`
- `package.json`
- Existing project docs, especially `AD_STUDIO_PROJECT_CONTEXT.md`, `AD_STUDIO_PRODUCT_ARCHITECTURE.md`, and `AD_STUDIO_TEMPLATE_SCHEMA.md` when relevant.

Then inspect the specific source files needed for the requested or implied task.

## Source Of Truth

Use the current code, docs, and git state as the source of truth. Old Codex chat history is optional context only and must not be required for continuation.

For this project, important areas are:

- `src/components/app-shell/AdStudioApp.tsx`
- `src/features/home`
- `src/features/agent`
- `src/features/workbench`
- `src/features/canvas`
- `src/features/generation`
- `src/features/templates`
- `src/lib/domain`
- `src/lib/mock-data`

## Handoff Maintenance

After finishing a meaningful stage of work, update `CODEX_HANDOFF.md`.

Update it when:

- A feature path becomes usable or changes behavior.
- New files, routes, or module boundaries are added.
- The next step changes.
- Verification results change.
- The user is likely to continue from phone or a new thread.

Do not update it for every tiny message. Keep it short and operational.

`CODEX_HANDOFF.md` should contain only:

- Current goal
- Recent completed work
- Key files
- Open tasks
- Verification status
- Notes and risks

Do not paste full chat logs, long command output, or large diffs into `CODEX_HANDOFF.md`.

## Safety

The worktree may contain user edits or edits from another Codex thread. Never revert unrelated changes. Before editing files that already have changes, inspect them and work with the current state.

For docs-only maintenance requests, do not change business code.
