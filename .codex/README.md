# Codex configuration

Codex and Claude Code follow the same policy in this repository; the files differ only in where each tool looks.

| Concern | Claude Code | Codex |
|---|---|---|
| Repo instructions | `.claude/CLAUDE.md` | `AGENTS.md` (root; points at `CLAUDE.md` and adds the Codex specifics) |
| Commit gate | `.claude/settings.json` → `.claude/hooks/gate_commit.py` | `.codex/hooks.json` → the **same script** with `--allow-direct` |
| Commit workflow | `.claude/agents/committer.md` (subagent) | `.agents/skills/committer/` (skill) and `.codex/agents/committer.toml` (custom agent) |
| Pull requests | `.claude/agents/pr-manager.md` | `.agents/skills/pr-manager/` and `.codex/agents/pr-manager.toml` |
| Post a plan to GitHub | `.claude/skills/post-plan/` | `.agents/skills/post-plan/` |

Why `--allow-direct`: Claude hook payloads identify the calling subagent, so the gate can insist that only the `committer` agent commits. Codex payloads have no such field, so for Codex the gate drops that one rule and keeps the rest (never on `main`, never `--no-verify`, `package.json` version bump when `pnpm-lock.yaml` is staged, green `pnpm run test:unit`). The Codex committer skill carries the "explicit approval quoted verbatim" rule in prose instead.

Repository skills live in `.agents/skills/` because that is where Codex discovers them (it scans `.agents/skills` from the working directory up to the repo root). Keep them committed so every contributor and machine shares the same workflows; personal skills go in `~/.agents/skills`, never here.

Note for the maintainer: the Codex desktop app's "external agent import sync" can spray auto-generated mirrors of `.claude/` into `.agents/skills` and `.codex/agents`. Those mirrors are not reviewed; if one shows up as a modification to a tracked file here, diff it and keep the reviewed version.

The gate needs a `python` on PATH (any 3.10+; stdlib only). No secrets or machine-specific settings belong in this folder.
