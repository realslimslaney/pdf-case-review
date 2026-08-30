// The commit gate is a stdlib-only Python script shared by Claude Code and Codex. Its commit
// detection is regex-critical and untested regexes rot, so drive it here through the same
// stdin/exit-code contract the harnesses use. Skipped when no python is on PATH.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gate = resolve(__dirname, "../../.claude/hooks/gate_commit.py");

function findPython(): string | undefined {
  for (const candidate of ["python", "python3", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && /Python 3/.test(`${probe.stdout}${probe.stderr}`)) {
      return candidate;
    }
  }
  return undefined;
}

const python = findPython();

interface GateRun {
  status: number | null;
  stderr: string;
}

function runGate(command: string, extra: { agentType?: string; args?: string[] } = {}): GateRun {
  if (!python) {
    throw new Error("python missing");
  }
  const payload = {
    cwd: resolve(__dirname, "../.."),
    tool_input: { command },
    ...(extra.agentType ? { agent_type: extra.agentType } : {}),
  };
  const result = spawnSync(python, [gate, ...(extra.args ?? [])], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

describe.skipIf(!python)("gate_commit.py", () => {
  it.each([
    "git commit -m 'x'",
    "git  commit",
    "cd repo && git commit -am x",
    "sudo git commit",
    "git -c user.name=me commit -m x",
    "git --git-dir=.git commit",
    "echo start; git commit; echo done",
    "git.exe commit -m x",
  ])("blocks a direct commit: %s", (command) => {
    const run = runGate(command);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/committer/);
  });

  it.each([
    "git status",
    "git log --oneline -5",
    "git commit-tree abc",
    "echo 'git commit' > notes.txt",
    "pnpm run test:unit",
    "git diff --cached --name-only",
  ])("ignores non-commit commands: %s", (command) => {
    expect(runGate(command).status).toBe(0);
  });

  it("refuses --no-verify even from the committer agent", () => {
    const run = runGate("git commit --no-verify -m x", { agentType: "committer" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--no-verify/);
  });

  it("with --allow-direct (Codex) skips only the committer rule", () => {
    const run = runGate("git commit -n -m x", { args: ["--allow-direct"] });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--no-verify/);
    expect(run.stderr).not.toMatch(/subagent/);
  });
});
