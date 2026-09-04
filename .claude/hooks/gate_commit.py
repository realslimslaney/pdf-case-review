"""PreToolUse gate: blocks `git commit` unless committer/verify/branch/lockfile/test rules pass.

One script, two harnesses:
  - Claude Code: .claude/settings.json (matcher Bash|PowerShell). Claude hook payloads carry
    `agent_type`, so direct commits are refused unless they come from the `committer` subagent.
  - Codex: .codex/hooks.json (matcher Bash, with --allow-direct). Codex has no subagent concept
    and its payloads have no `agent_type`, so --allow-direct skips only that first rule; the
    branch, --no-verify, lockfile and green-test rules still apply.

Exit 0 allows the tool call, exit 2 blocks it and feeds stderr back to the model. Stdlib-only so
a broken toolchain can never break the gate itself. Ported from realslimslaney/bslaney; the
lockfile rule diverges from the source repo, see check_lockfile_pairing.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

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
FILE_ARG_RE = re.compile(r"""(?:^|\s)(?:-F|--file)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))""")
EM_DASH = "—"

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
MSG_LOCKFILE_ALONE = (
    f"BLOCKED: {LOCKFILE} is staged without package.json; a lockfile change must ride with the "
    "package.json change that caused it. Stage both in one commit (or unstage the lockfile), then retry."
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
MSG_EM_DASH = (
    "BLOCKED: the commit message contains an em-dash; the repository's writing rule (CLAUDE.md) "
    "avoids them in commit messages. Rephrase with a comma, colon or parentheses, then retry."
)


def looks_like_git_commit(command: str) -> bool:
    return bool(GIT_COMMIT_RE.search(command))


def uses_no_verify(command: str) -> bool:
    return bool(NO_VERIFY_RE.search(command))


def run_git(args: list[str], cwd: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, errors="replace")


def block(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def commit_message_has_em_dash(command: str, cwd: str) -> bool:
    # Nothing in a git commit command but its message carries an em-dash, so scanning the whole
    # command covers -m, here-strings, heredocs and stdin alike; -F/--file needs the file read.
    if EM_DASH in command:
        return True
    for match in FILE_ARG_RE.finditer(command):
        path = match.group(1) or match.group(2) or match.group(3) or ""
        try:
            candidate = Path(path)
            if not candidate.is_absolute():
                candidate = Path(cwd) / candidate
            if candidate.is_file() and EM_DASH in candidate.read_text(encoding="utf-8", errors="replace"):
                return True
        except OSError:
            continue
    return False


def check_lockfile_pairing(cwd: str) -> str | None:
    # The source repo required a manual version bump whenever the lockfile changed. Here
    # release-please owns versions (they are derived from Conventional Commits at release time),
    # so a dependency change needs no bump; what the rule still catches is the real footgun,
    # lockfile churn staged without the package.json change that explains it.
    staged = run_git(["diff", "--cached", "--name-only"], cwd).stdout.splitlines()
    if LOCKFILE in staged and "package.json" not in staged:
        return MSG_LOCKFILE_ALONE
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
    if commit_message_has_em_dash(command, cwd):
        return block(MSG_EM_DASH)
    # symbolic-ref (not rev-parse) so an unborn branch (a repo before its first commit) still
    # reports "main" instead of an empty string that would slip past this rule.
    if run_git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).stdout.strip() == DEFAULT_BRANCH:
        return block(MSG_ON_MAIN)
    lockfile_message = check_lockfile_pairing(cwd)
    if lockfile_message:
        return block(lockfile_message)
    return run_tests(cwd)


def main() -> int:
    payload = json.load(sys.stdin)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not looks_like_git_commit(command):
        return 0
    # Past detection the gate must fail CLOSED: an uncaught crash exits 1, which the harness
    # treats as non-blocking: a buggy gate would silently wave commits through.
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
