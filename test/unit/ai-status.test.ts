import { describe, expect, it } from "vitest";

import type { AccountResolution } from "../../src/core/ai/accounts";
import { aiStatusText, describeRule } from "../../src/core/ai/status";

const school = { id: "school", provider: "codex-cli" as const, configDir: "~/.codex-school" };

describe("aiStatusText", () => {
  it("says AI off regardless of resolution", () => {
    expect(aiStatusText({ provider: "off", resolution: undefined, desktop: true })).toEqual({
      text: "$(sparkle) AI off",
      warning: false,
    });
  });

  it("names the provider alone when no rule selects an account", () => {
    expect(aiStatusText({ provider: "claude-cli", resolution: { kind: "none" }, desktop: true }).text).toBe(
      "$(sparkle) Claude Code",
    );
  });

  it("appends the resolved account id", () => {
    const resolution: AccountResolution = {
      kind: "resolved",
      accountId: "school",
      account: school,
      rule: {},
    };
    expect(aiStatusText({ provider: "codex-cli", resolution, desktop: true }).text).toBe(
      "$(sparkle) Codex · school",
    );
  });

  it("warns when the id has no entry for the provider or is unknown", () => {
    const missing: AccountResolution = {
      kind: "missingForProvider",
      accountId: "school",
      providers: ["claude-cli"],
    };
    expect(aiStatusText({ provider: "codex-cli", resolution: missing, desktop: true })).toEqual({
      text: '$(warning) Codex · no "school" login',
      warning: true,
    });
    const unknown: AccountResolution = { kind: "unknownId", accountId: "nobody" };
    expect(aiStatusText({ provider: "claude-cli", resolution: unknown, desktop: true })).toEqual({
      text: '$(warning) Claude Code · "nobody" unknown',
      warning: true,
    });
  });

  it("marks a pending authorization-line rule and the web host", () => {
    const pending: AccountResolution = { kind: "needsAuthorizationLine" };
    expect(aiStatusText({ provider: "codex-cli", resolution: pending, desktop: true }).text).toBe(
      "$(sparkle) Codex · rule pending",
    );
    expect(aiStatusText({ provider: "claude-cli", resolution: { kind: "none" }, desktop: false }).text).toBe(
      "$(sparkle) Claude Code · desktop only",
    );
  });
});

describe("describeRule", () => {
  it("words each condition and falls back to always", () => {
    expect(describeRule({})).toBe("always");
    expect(describeRule({ when: {} })).toBe("always");
    expect(describeRule({ when: { pathGlob: "**/TOM/**" } })).toBe("pathGlob **/TOM/**");
    expect(describeRule({ when: { protected: true, authorizationLineMatches: "review" } })).toBe(
      "protected documents, authorization line matches /review/",
    );
  });
});
