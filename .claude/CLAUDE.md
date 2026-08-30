# pdf-case-review

Open-source VS Code extension: open a PDF, highlight passages by user-defined category (Fact, Financial, Strategic implication, Concern, Question by default), attach notes, and generate a printable Markdown / Word / PDF report of the notes. Built for reading business-school cases; generic enough for papers, contracts and textbooks. The design record is `PLAN.local.md` (gitignored, the owner's copy) and `docs/explanation/decisions.md` (ADRs, committed).

## Layout

- `src/extension/` — extension host code (VS Code API). **No Node built-ins here** except under `src/extension/desktop/`; everything else must work in the web extension host (`vscode.workspace.fs`, `Uri.joinPath`, `TextDecoder`).
- `src/core/` — pure TypeScript: model, categories, report pipeline. No `vscode` import, no DOM, no Node. Unit-tested with vitest.
- `src/shared/protocol.ts` — the typed message contract between host and webview.
- `src/webview/` — the PDF.js viewer bootstrap and the `ViewerAdapter`. Every touch of PDF.js internals lives here.
- `vendor/pdfjs/` — the pinned PDF.js prebuilt viewer, produced by `pnpm prepare-pdfjs` from `pdfjs.lock.json`. Gitignored; shipped in the VSIX. Patches (ideally none) go in `patches/pdfjs/`.
- `media/` — icon and webview CSS. `schemas/` — the sidecar JSON schema. `scripts/` — Node maintenance scripts. `test/{unit,integration,fixtures}`. `docs/` — diataxis.

Derived-from-upstream files (see `pdfjs.lock.json` → `upstreamReference.derivedFiles`) keep the Mathematic Inc header plus a "Modified by" line; never strip either.

## Conventions

- TypeScript strict; `pnpm` only (never npm/yarn); Node 22+.
- Lint/format = Biome (`pnpm lint`, `pnpm fix`). Line length 110.
- Names spell things out (`webviewPanel`, not `wp`). No comments unless the *why* is non-obvious.
- Validate at boundaries (settings, sidecar files, webview messages); trust internal calls.
- Don't add dependencies without a real need; anything bundled into the VSIX must be pure JS (no native modules) and its license recorded in `THIRD_PARTY_NOTICES.md`.
- Never write to the user's PDF except through the dual-write sync in `src/extension/pdfSync/`; never strip encryption or permissions from a PDF.

## Tooling

- `pnpm prepare-pdfjs` — vendor PDF.js (run once after clone, and after `pdfjs.lock.json` changes).
- `pnpm fixtures` — generate synthetic test PDFs into `test/fixtures/generated/`.
- `pnpm build` / `pnpm watch` — tsup (extension host + webview + integration tests).
- `pnpm check` — typecheck + lint + unit tests. `pnpm test:integration` — headless VS Code (Mocha).
- F5 in VS Code runs the extension against `test/fixtures`.
- `pnpm package` — builds the `.vsix`.

## Committing

- **Never commit without the user's explicit yes.** Propose the commit, then wait.
- Once approved, **delegate to the `committer` agent**, quoting the user's yes verbatim in the delegation prompt — a PreToolUse gate rejects `git commit` from anywhere else. Codex follows the same policy through `AGENTS.md`, `.agents/skills/committer` and `.codex/hooks.json` (same script, `--allow-direct`). Auto-accept mode is not approval.
- The gate blocks any `git commit` that is on `main`, uses `--no-verify`, stages `pnpm-lock.yaml` without a `package.json` version bump, or has a red `pnpm run test:unit`. Fix the cause; never work around the gate.
- **Conventional Commits**: `feat:`/`fix:`/`docs:`/`ci:`/`refactor:`/`test:`/`chore:`, imperative, one logical change per commit. release-please turns them into versions and the CHANGELOG.
- Always feature branch + PR: `git switch -c <type>/<slug> --no-track`, push `-u` immediately.

## Pull requests

- Delegate PR creation to the `pr-manager` agent (`.claude/agents/pr-manager.md`; Codex uses `.agents/skills/pr-manager`). It opens **draft** PRs with: assignee `realslimslaney`, one `area:*` label (`area:viewer`, `area:notes`, `area:report`, `area:ai`, `area:release`, `area:docs`), and `Closes #N`. Never create new labels.
- Bodies end with the attribution footer for the agent that created them.

## Documentation (diataxis)

`docs/tutorials/` (learning), `docs/how-to/` (tasks), `docs/reference/` (settings, commands, sidecar schema), `docs/explanation/` (why; `decisions.md` holds the ADRs). Don't mix quadrants in one doc.
