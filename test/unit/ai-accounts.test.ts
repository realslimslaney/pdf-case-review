import { describe, expect, it } from "vitest";

import {
  accountIdsIn,
  defaultConfigDir,
  mergeAccountSettings,
  validAccountId,
} from "../../src/core/ai/accounts";

describe("validAccountId", () => {
  it("accepts lowercase ids with digits and dashes", () => {
    expect(validAccountId("school")).toBe(true);
    expect(validAccountId("work-2")).toBe(true);
  });
  it("rejects empty, spaced, uppercase and leading-dash ids", () => {
    expect(validAccountId("")).toBe(false);
    expect(validAccountId("my school")).toBe(false);
    expect(validAccountId("School")).toBe(false);
    expect(validAccountId("-x")).toBe(false);
  });
});

describe("defaultConfigDir", () => {
  it("derives a per-provider dotted home directory", () => {
    expect(defaultConfigDir("claude-cli", "school")).toBe("~/.claude-school");
    expect(defaultConfigDir("codex-cli", "school")).toBe("~/.codex-school");
  });
});

describe("accountIdsIn", () => {
  it("collects string ids and ignores malformed entries", () => {
    expect(accountIdsIn([{ id: "a" }, { id: 3 }, "junk", null, { id: "b" }])).toEqual(new Set(["a", "b"]));
  });
});

describe("mergeAccountSettings", () => {
  const existingAccounts = [{ id: "personal", provider: "claude-cli", configDir: "~/.claude" }];
  const existingRules = [{ use: "personal" }];
  const account = { id: "school", provider: "claude-cli" as const, configDir: "~/.claude-school" };

  it("appends the account and puts an always rule in front of the existing catch-all", () => {
    const merged = mergeAccountSettings(existingAccounts, existingRules, {
      ...account,
      scope: { kind: "always" },
    });
    expect(merged.accounts).toEqual([...existingAccounts, account]);
    expect(merged.rules).toEqual([{ use: "school" }, { use: "personal" }]);
  });

  it("keeps an always rule behind scoped rules and appends it when no catch-all exists", () => {
    const scoped = { when: { protected: true }, use: "vault" };
    const withCatchAll = mergeAccountSettings([], [scoped, { use: "personal" }], {
      ...account,
      scope: { kind: "always" },
    });
    expect(withCatchAll.rules).toEqual([scoped, { use: "school" }, { use: "personal" }]);
    const withoutCatchAll = mergeAccountSettings([], [scoped], { ...account, scope: { kind: "always" } });
    expect(withoutCatchAll.rules).toEqual([scoped, { use: "school" }]);
  });

  it("prepends a folder rule so it beats an existing catch-all", () => {
    const merged = mergeAccountSettings(existingAccounts, existingRules, {
      ...account,
      scope: { kind: "folder", pathGlob: "**/cases/**" },
    });
    expect(merged.rules).toEqual([{ when: { pathGlob: "**/cases/**" }, use: "school" }, { use: "personal" }]);
  });

  it("prepends a protected rule", () => {
    const merged = mergeAccountSettings(existingAccounts, existingRules, {
      ...account,
      scope: { kind: "protected" },
    });
    expect(merged.rules[0]).toEqual({ when: { protected: true }, use: "school" });
  });

  it("leaves rules alone for scope none and never mutates the inputs", () => {
    const merged = mergeAccountSettings(existingAccounts, existingRules, {
      ...account,
      scope: { kind: "none" },
    });
    expect(merged.rules).toEqual(existingRules);
    expect(merged.rules).not.toBe(existingRules);
    expect(existingAccounts).toHaveLength(1);
  });

  it("carries hand-written raw entries through untouched", () => {
    const oddRule = { when: { authorizationLineMatches: "review" }, email: "x@y.z" };
    const merged = mergeAccountSettings([], [oddRule], { ...account, scope: { kind: "always" } });
    expect(merged.rules[0]).toBe(oddRule);
  });
});
