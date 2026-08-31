---
name: committer
description: Stage and commit already-approved work as clean Conventional Commits on a feature branch. Use only after the user has explicitly said yes to committing ("commit this", "commit and push"). Not for deciding whether to commit, creating pull requests, merging, or fixing failing code.
---

# Committer

## Workflow

Turn the current working tree into clean, reviewable commits. Run this workflow only after the
user has explicitly approved committing in their own words. Auto-approve or sandbox modes are
not approval.

Hard rules:

- Never commit to `main`. If HEAD is on main, first run `git switch -c <type>/<slug> --no-track`.
  Publish the branch with `git push -u origin <type>/<slug>` only when the user asks for a push.
- Stage explicit paths only. Never `git add -A`, `git add .`, or `git add -u`. Read the diff
  before staging anything.
- Never stage `*.vsix`, `.env*`, `vendor/`, `dist/`, `test/fixtures/generated/`, `PLAN.local.md`,
  or anything gitignored.
- Never use `--no-verify`. Never amend or force-push anything already pushed.
- pnpm only; never npm or yarn.

1. Survey the tree: `git status`, `git diff --stat`, `git diff`, and `git log --oneline -5` to
   match message style.
2. A repository-level Codex hook (`.codex/hooks.json`) runs the shared commit gate
   (`.claude/hooks/gate_commit.py --allow-direct`) on every `git commit`. It blocks a commit on
   `main`, with `--no-verify`, staging `pnpm-lock.yaml` without `package.json` staged alongside it, or
   with a red `pnpm run test:unit`, and it runs the unit suite itself. Do not re-run the full
   suite; run only targeted tests (`pnpm exec vitest run test/unit/<file>.test.ts`) when you need
   confidence while splitting. If the gate blocks, fix the cause (red tests: do not fix or delete
   tests inside this workflow; report the failure instead) and never work around it.
3. Plan the split: one logical change per commit; a reviewer should be able to read each commit
   standalone. If the tree mixes approved work with changes the user did not mention, commit only
   what was approved and flag the rest.
4. Commit each slice. Stage its paths, then commit with a `type(scope): imperative summary`
   message (72 characters or fewer). Types: `feat`, `fix`, `docs`, `ci`, `refactor`, `test`,
   `chore`. Scopes: `viewer`, `notes`, `report`, `ai`, `sidecar`, `pdfsync`, `release`, `docs`,
   `deps`. Add a body only when the why is not obvious. release-please derives versions and the
   changelog from these messages.
5. Never bump `"version"` in `package.json` by hand: release-please owns versions. When
   `pnpm-lock.yaml` changed, stage it together with the `package.json` change that caused it.
6. If Biome rewrites files, re-stage the same paths and retry once. On any other failure, stop
   and report.
7. Report each commit hash and message, and note anything left uncommitted and why. Push only if
   the user asked for a push.
