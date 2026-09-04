---
name: docs-maintainer
description: Audit and fix the docs/ folder against the code before a PR goes out, covering the reference tables, the diataxis quadrants, the ADRs, and the VitePress sidebar. Not for editing source code, committing, or writing release notes.
---

# Docs Maintainer

## Workflow

Keep `docs/` accurate for this VS Code extension. The docs are diataxis: `docs/tutorials/`
(learning), `docs/how-to/` (tasks), `docs/reference/` (facts mirrored from code),
`docs/explanation/decisions.md` (ADRs, newest last). Never mix quadrants in one doc.

Pass 1, mechanical drift:

1. Run `pnpm docs:check` (`scripts/check-docs.mjs`). Fix every finding by editing the doc, not by
   growing the allowlist; extend the allowlist only for a genuinely intentional exception, with a
   comment saying why.
2. The joins it checks, if you need them by hand: `contributes.configuration` properties, defaults
   and non-`resource` scopes against `docs/reference/settings.md`; `contributes.commands` titles
   (via `package.nls.json`) against `docs/reference/commands.md`; `contributes.keybindings`
   against `docs/reference/keybindings.md`; `schemas/review.schema.json` fields against
   `docs/reference/sidecar.md`; every docs page against the hand-maintained sidebar in
   `docs/.vitepress/config.mts`; a non-empty `docs/index.md`; Claude/Codex agent-mirror parity.

Pass 2, prose accuracy for the branch's changes:

1. `git diff main...HEAD --stat` (or the range you were given). For every user-facing change (a
   command, setting, keybinding, sidecar field, report section, keyboard flow, consent dialog),
   verify the affected pages describe the current behavior, reading the source when unsure.
   Reference pages state facts; how-to pages get a short task-oriented section only when a user
   would need one; the tutorial changes only when the first-run flow changed.
2. A new page needs a sidebar entry in `config.mts` and a link from `docs/index.md`.
3. ADR heuristic: a change that adds a persisted sidecar field, a new AI code path, or a new
   architectural seam gets a new `## ADR-000N:` entry in `docs/explanation/decisions.md` (newest
   last, `**Decision.**` / `**Why.**` / `**Consequences.**` lead-ins, concrete source paths).
   Draft it for the user to review and say so in your report; never rewrite or renumber existing
   ADRs.

Style and boundaries:

- No em-dashes anywhere; use sentences, commas, colons or parentheses. US spelling (behavior,
  color, organize). The repo deliberately writes "grey" and "cancelled"; leave those alone. Line
  length 110.
- Edit only `docs/`, `README.md` and the allowlist in `scripts/check-docs.mjs`. Never edit `src/`,
  `package.json` or schemas: if the code and doc disagree and the code looks wrong, report the
  mismatch instead of documenting a bug as intended behavior.
- Never commit or push; the committer workflow owns that.

Finish: run `pnpm docs:check` (must pass) and `pnpm docs:build` (must build). Report the findings
fixed, the pages edited, any drafted ADR, and any code-side inconsistency you chose not to paper
over.
