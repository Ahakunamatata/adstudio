# Claude Code Handoff - Ad Studio

Project: `adstudio`

Canonical path:

```text
/Users/climber_glc/Desktop/AI_Climber/adstudio
```

## Start Here

This repo has active uncommitted product-prototype work. Do not assume the git worktree is clean, and do not revert unrelated changes.

Before changing code, read:

1. `CODEX_HANDOFF.md` for the latest operational state.
2. `package.json` for commands and port.
3. `AD_STUDIO_PROJECT_CONTEXT.md` for product context.
4. `AD_STUDIO_PRODUCT_ARCHITECTURE.md` for architecture intent.
5. `AD_STUDIO_TEMPLATE_SCHEMA.md` for the current template/product-pack contract.
6. `git status --short` and `git diff --stat` to understand current edits.

## Current Focus

The current handoff area is the `ad-模板-素材功能` prototype:

- AI template library.
- Winning ad library.
- Template detail modal.
- Winning ad detail modal.
- Flow from template into Ad Video / Ad Image generation.
- Flow from winning ad into Agent Workbench replication.

## Important Files

- `src/components/app-shell/AdStudioApp.tsx`: top-level view routing and handoff between templates, generation, and Agent Workbench.
- `src/features/home`: home launcher and template entry points.
- `src/features/templates`: template cards, AI template modal, winning ad cards, winning ad modal, templates page.
- `src/features/generation`: Ad Video / Ad Image generation forms.
- `src/features/agent`: Agent task setup and replication entry.
- `src/features/workbench`: Agent Workbench shell.
- `src/features/canvas`: canvas reducer/actions and React Flow state.
- `src/lib/domain/schemas.ts`: shared domain types.
- `src/lib/mock-data/templates.ts`: AI template categories, slots, script blocks, and filters.
- `src/lib/mock-data/topAds.ts`: winning ad examples.
- `src/lib/mock-data/products.ts`: mock product-pack slot values.
- `src/app/globals.css`: current prototype styling, including template and winning-ad UI.

## Local Startup

The app runs on:

```text
http://127.0.0.1:3010
```

Prefer direct binaries for local startup and verification because `pnpm dev` and `pnpm lint` have recently triggered a pnpm prompt to remove/reinstall `node_modules`.

Start dev server:

```bash
./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3010
```

Verify:

```bash
curl -I --max-time 10 http://127.0.0.1:3010/
./node_modules/.bin/eslint .
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/next build --webpack
```

## Current Behavior

- AI template card -> template detail modal -> `使用模板生成` -> Ad Video or Ad Image opens with prompt/model/ratio/duration/slots prefilled where supported.
- Winning ad card -> winning ad detail modal -> `在 Agent 中复刻` -> Agent Workbench opens with winning-ad replication context.
- Product-pack slot autofill is currently mock-data driven through `src/lib/mock-data/products.ts`.
- The implementation is still a local prototype. There is no real backend, database, persistence, model adapter, production API integration, or product URL extraction pipeline yet.

## Known Gaps

- Replace mock `templateSlots` with a real product URL/product-pack extraction pipeline.
- Decide how winning ad replication should materialize actual Workbench canvas nodes for objective breakdown, clone strategy, script, storyboard, and final video.
- Expand the mapping between template slot keys and generation form slots. Some edited slot content currently only lands in the final prompt.
- Template preview assets are local/static placeholders.

## Working Rules

- Keep existing uncommitted work unless the user explicitly asks to remove it.
- For docs-only requests, do not change business code.
- For UI changes, verify the local app at `http://127.0.0.1:3010`.
- If Chrome or an in-app browser shows a React hydration warning involving extension-injected attributes such as `monica-*`, treat it as a browser-extension warning unless the app is otherwise broken.
- Keep `CODEX_HANDOFF.md` short and operational when a meaningful stage changes.
