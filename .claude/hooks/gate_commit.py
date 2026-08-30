"""PreToolUse gate: blocks `git commit` unless committer/verify/branch/version/test rules pass.

One script, two harnesses:
  - Claude Code: .claude/settings.json (matcher Bash|PowerShell). Claude hook payloads carry
    `agent_type`, so direct commits are refused unless they come from the `committer` subagent.
  - Codex: .codex/hooks.json (matcher Bash, with --allow-direct). Codex has no subagent concept
    and its payloads have no `agent_type`, so --allow-direct skips only that first rule; the
    branch, --no-verify, version-bump and green-test rules still apply.

Exit 0 allows the tool call, exit 2 blocks it and feeds stderr back to the model. Stdlib-only so
a broken toolchain can never break the gate itself. Ported from realslimslaney/bslaney.
"""

import json
import re
import shutil
import subprocess
import sys

REQUIRE_COMMITTER_AGENT = "--allow-direct" not in sys.argv[1:]
# Must beat the 300s hook timeout in settings.json: a harness-killed hook is non-blocking,
# so the gate has to be the one that times out and exits 2.
TEST_TIMEOUT_S = 240
TAIL_LINES = 30
DEFAULT_BRANCH = "main"
LOCKFILE = "pnpm-lock.yaml"

QUOTED_OR_BARE = r"""(?:\S*"[^"]*"|\S*'[^']*'|\S+)"""
GIT_COMMIT_RE = re.compile(
    rf"""(?:^|[;&|(\n])\s*
         (?:command\s+|sudo\s+)?
         git(?:\.exe)?\s+
         (?:
             (?:-[cC]|--git-dir|--work-tree|--namespace|--exec-path|--config-env)
                 (?:=\S+|\s+{QUOTED_OR_BARE})\s+
           | --?[A-Za-z][\w-]*\s+
         )*
         commit(?![\w-])""",
    re.VERBOSE | re.IGNORECASE,
)
NO_VERIFY_RE = re.compile(r"(?:^|\s)(?:--no-verify|-n)(?![\w-])")

MSG_DELEGATE = (
    "BLOCKED: direct commits from this session are disabled. Delegate to the 'committer' subagent "
    "(Agent tool, subagent_type: committer) with a summary of the approved changes and whether to "
    "push. Do not retry git commit here."
)
MSG_NO_VERIFY = (
    "BLOCKED: --no-verify is not allowed; pre-commit hooks must run. Retry without it. If a hook "
    "fails, fix the underlying issue instead of bypassing it."
)
MSG_ON_MAIN = (
    f"BLOCKED: HEAD is on '{DEFAULT_BRANCH}'; never commit to {DEFAULT_BRANCH}. Create a feature "
    "branch first: git switch -c <type>/<slug> --no-track && git push -u origin <type>/<slug>, then retry."
)
MSG_VERSION = (
    f"BLOCKED: {LOCKFILE} is staged but package.json's version matches {DEFAULT_BRANCH}; dependency "
    "changes require a version bump. Bump \"version\" in package.json, run pnpm install, stage both, then retry."
)
MSG_TEST_FAILED = (
    "BLOCKED: test suite is red; commits require a green 'pnpm run test:unit'. Fix the failures below; "
    "if they look pre-existing or unrelated, stop and tell the user instead of committing. If the "
    "failures are module-resolution errors the install may be stale: run 'pnpm install' and retry."
)
MSG_TEST_TIMEOUT = (
    f"BLOCKED: tests exceeded {TEST_TIMEOUT_S}s inside the commit gate. Investigate the hang; "
    "do not commit until the suite completes green."
)
MSG_NO_PNPM = "BLOCKED: pnpm was not found on PATH, so the commit gate cannot run the tests. Install pnpm and retry."


def looks_like_git_commit(command: str) -> bool:
    return bool(GIT_COMMIT_RE.search(command))


def uses_no_verify(command: str) -> bool:
    return bool(NO_VERIFY_RE.search(command))


def package_version(text: str) -> str | None:
    try:
        value = json.loads(text).get("version")
    except (json.JSONDecodeError, AttributeError):
        return None
    return value if isinstance(value, str) else None


def run_git(args: list[str], cwd: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, errors="replace")


def block(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def check_version_bump(cwd: str) -> str | None:
    staged = run_git(["diff", "--cached", "--name-only"], cwd).stdout.splitlines()
    if LOCKFILE not in staged:
        return None
    main_manifest = run_git(["show", f"{DEFAULT_BRANCH}:package.json"], cwd)
    staged_manifest = run_git(["show", ":package.json"], cwd)
    if main_manifest.returncode != 0 or staged_manifest.returncode != 0:
        return None
    main_version = package_version(main_manifest.stdout)
    staged_version = package_version(staged_manifest.stdout)
    if main_version and staged_version and main_version == staged_version:
        return MSG_VERSION
    return None


def run_tests(cwd: str) -> int:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        return block(MSG_NO_PNPM)
    try:
        result = subprocess.run(
            [pnpm, "run", "test:unit"],
            cwd=cwd,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=TEST_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return block(MSG_TEST_TIMEOUT)
    if result.returncode != 0:
        tail = "\n".join((result.stdout + "\n" + result.stderr).strip().splitlines()[-TAIL_LINES:])
        return block(f"{MSG_TEST_FAILED}\n--- last {TAIL_LINES} lines ---\n{tail}")
    return 0


def run_checks(payload: dict, command: str) -> int:
    cwd = payload.get("cwd") or "."
    if REQUIRE_COMMITTER_AGENT and payload.get("agent_type") != "committer":
        return block(MSG_DELEGATE)
    if uses_no_verify(command):
        return block(MSG_NO_VERIFY)
    # symbolic-ref (not rev-parse) so an unborn branch (a repo before its first commit) still
    # reports "main" instead of an empty string that would slip past this rule.
    if run_git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).stdout.strip() == DEFAULT_BRANCH:
        return block(MSG_ON_MAIN)
    version_message = check_version_bump(cwd)
    if version_message:
        return block(version_message)
    return run_tests(cwd)


def main() -> int:
    payload = json.load(sys.stdin)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not looks_like_git_commit(command):
        return 0
    # Past detection the gate must fail CLOSED: an uncaught crash exits 1, which the harness
    # treats as non-blocking — a buggy gate would silently wave commits through.
    try:
        return run_checks(payload, command)
    except Exception as exc:
        return block(
            f"BLOCKED: commit gate crashed while checking ({exc!r}). Fix .claude/hooks/gate_commit.py "
            "or ask the user how to proceed; do not retry the commit as-is."
        )


if __name__ == "__main__":
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        sys.exit(main())
    except Exception as exc:
        print(
            f"gate_commit.py internal error before commit detection ({exc!r}): the gate did NOT run; "
            "do not commit until this is fixed.",
            file=sys.stderr,
        )
        sys.exit(1)
