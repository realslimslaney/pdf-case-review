import { describe, expect, it } from "vitest";
import { spawnPlan } from "../../src/extension/desktop/aiProviders";

describe("spawnPlan", () => {
  it("builds the claude argv with every tool disabled, prompt on stdin and optional model", () => {
    expect(spawnPlan("claude-cli", {})).toEqual({
      binary: "claude",
      args: ["-p", "--output-format", "text", "--tools="],
      env: {},
    });
    expect(spawnPlan("claude-cli", { model: "claude-opus-5" }).args).toEqual([
      "-p",
      "--output-format",
      "text",
      "--tools=",
      "--model",
      "claude-opus-5",
    ]);
  });

  it("builds the codex argv with the strictest sandbox, stdin last and the last-message file", () => {
    const plan = spawnPlan("codex-cli", { model: "gpt-5", lastMessageFile: "C:/tmp/last.txt" });
    expect(plan.binary).toBe("codex");
    expect(plan.args).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--model",
      "gpt-5",
      "--output-last-message",
      "C:/tmp/last.txt",
      "-",
    ]);
    expect(plan.args[plan.args.length - 1]).toBe("-");
  });

  it("routes Layer 2 config dirs into the provider's own environment variable", () => {
    expect(spawnPlan("claude-cli", { configDir: "C:/logins/school" }).env).toEqual({
      CLAUDE_CONFIG_DIR: "C:/logins/school",
    });
    expect(spawnPlan("codex-cli", { configDir: "C:/logins/school" }).env).toEqual({
      CODEX_HOME: "C:/logins/school",
    });
    expect(spawnPlan("claude-cli", {}).env).toEqual({});
  });
});
