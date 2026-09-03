# Agent instructions

Conventions for this repository live in `.claude/CLAUDE.md`; read that first. This file points at it, lists the easy-to-miss rules, and describes the Codex-specific layout.

## Easy to miss

- `pnpm prepare-pdfjs` must run before anything builds; `vendor/pdfjs/` is gitignored.
- `src/core/` and `src/extension/` (outside `desktop/`) must not use Node built-ins — the extension also targets the web host.
- Never commit without an explicit yes from the user; never on `main`; never `--no-verify`.
- Never write to a user's PDF outside `src/extension/pdfSync/`; never remove encryption or permissions from a PDF.
- Files derived from `mathematic-inc/vscode-pdf` keep their Apache-2.0 header and "Modified by" line.
- Avoid em-dashes in anything you write (docs, comments, commits, PR bodies, report text); rephrase with sentences, commas, colons or parentheses, and use one only where it is genuinely clearest.

## Codex

- **Skills** are in `.agents/skills/` (Codex discovers them from the working directory up to the repo root): `committer` (stage and commit approved work), `pr-manager` (open or repair a draft PR), `docs-maintainer` (bring `docs/` in line with the code before a PR), `pdfjs-upgrader` (upgrade the vendored PDF.js viewer), `post-plan` (turn a plan into a GitHub issue or PR comment). Custom-agent equivalents of all but `post-plan` live in `.codex/agents/` for sessions that use Codex sub-agents.
- **Committing.** Propose the commit, wait for the user's explicit yes, then follow `.agents/skills/committer`. A PreToolUse hook in `.codex/hooks.json` runs the shared commit gate (`.claude/hooks/gate_commit.py --allow-direct`) on every `git commit`; it blocks commits on `main`, `--no-verify`, a staged `pnpm-lock.yaml` without `package.json` staged alongside it, and a red `pnpm run test:unit`. Fix the cause; never work around it. No manual version bumps: release-please derives versions from the commit history. Claude Code runs the same gate through `.claude/settings.json`.
- **Pull requests.** When a pushed branch is ready, run `.agents/skills/docs-maintainer` first (it runs `pnpm docs:check` and fixes doc drift for the branch), then use `.agents/skills/pr-manager`: draft PR, assignee `realslimslaney`, one `area:*` label, `Closes #N`, Codex attribution footer. Never create labels.
- **Style guard.** A PostToolUse hook (`.claude/hooks/style_guard.py`, registered in `.codex/hooks.json`) flags em-dashes and British spellings in freshly written Markdown and code comments; fix what it reports with a follow-up edit.
- `.codex/README.md` explains how the Claude and Codex files map onto each other.
