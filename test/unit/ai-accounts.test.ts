import { describe, expect, it } from "vitest";

import {
  accountFor,
  accountKey,
  accountKeysIn,
  defaultConfigDir,
  mergeAccountSettings,
  parseAccounts,
  providersFor,
  resolveAccount,
  rulesUsing,
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

describe("accountKeysIn", () => {
  it("collects (id, provider) keys and ignores malformed entries", () => {
    const keys = accountKeysIn([
      { id: "a", provider: "claude-cli" },
      { id: "a", provider: "codex-cli" },
      { id: "b" },
      { id: 3, provider: "codex-cli" },
      "junk",
      null,
    ]);
    expect(keys).toEqual(new Set([accountKey("a", "claude-cli"), accountKey("a", "codex-cli")]));
  });
});

describe("parseAccounts", () => {
  it("accepts the same id under two providers", () => {
    const warnings: string[] = [];
    const accounts = parseAccounts(
      [
        { id: "school", provider: "claude-cli", configDir: "~/.claude-school" },
        { id: "school", provider: "codex-cli", configDir: "~/.codex-school" },
      ],
      warnings,
    );
    expect(accounts).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it("drops malformed entries with a warning each", () => {
    const warnings: string[] = [];
    const accounts = parseAccounts(
      [
        { id: "", provider: "claude-cli", configDir: "x" },
        { id: "a", provider: "gemini", configDir: "x" },
        7,
      ],
      warnings,
    );
    expect(accounts).toEqual([]);
    expect(warnings).toHaveLength(3);
  });

  it("keeps the first of a repeated (id, provider) pair and warns", () => {
    const warnings: string[] = [];
    const accounts = parseAccounts(
      [
        { id: "school", provider: "claude-cli", configDir: "~/.first" },
        { id: "school", provider: "claude-cli", configDir: "~/.second" },
      ],
      warnings,
    );
    expect(accounts).toEqual([{ id: "school", provider: "claude-cli", configDir: "~/.first" }]);
    expect(warnings[0]).toMatch(/listed twice for claude-cli/);
  });

  it("returns nothing for an unset or non-list value", () => {
    const warnings: string[] = [];
    expect(parseAccounts(undefined, warnings)).toEqual([]);
    expect(parseAccounts({}, warnings)).toEqual([]);
    expect(warnings).toEqual(["accounts must be a list"]);
  });
});

const twoProviders = [
  { id: "school", provider: "claude-cli" as const, configDir: "~/.claude-school" },
  { id: "school", provider: "codex-cli" as const, configDir: "~/.codex-school" },
  { id: "work", provider: "claude-cli" as const, configDir: "~/.claude-work" },
];

describe("accountFor and providersFor", () => {
  it("selects by id and provider", () => {
    expect(accountFor(twoProviders, "school", "codex-cli")?.configDir).toBe("~/.codex-school");
    expect(accountFor(twoProviders, "work", "codex-cli")).toBeUndefined();
  });
  it("lists the providers an id is registered for, in settings order", () => {
    expect(providersFor(twoProviders, "school")).toEqual(["claude-cli", "codex-cli"]);
    expect(providersFor(twoProviders, "work")).toEqual(["claude-cli"]);
    expect(providersFor(twoProviders, "nobody")).toEqual([]);
  });
});

describe("rulesUsing", () => {
  it("counts only rules whose use names the id", () => {
    const rules = [
      { use: "school" },
      { when: { protected: true }, use: "school" },
      { use: "work" },
      { email: "x@y.z" },
      null,
    ];
    expect(rulesUsing(rules, "school")).toBe(2);
    expect(rulesUsing(rules, "nobody")).toBe(0);
  });
});

describe("resolveAccount", () => {
  const facts = { protected: false, authorizationLine: null, filePath: "/cases/TOM/case.pdf" };

  it("resolves the rule's id for the active provider", () => {
    const rules = [{ when: { pathGlob: "**/TOM/**" }, use: "school" }];
    const resolved = resolveAccount(rules, twoProviders, "codex-cli", facts);
    expect(resolved).toMatchObject({ kind: "resolved", accountId: "school", rule: rules[0] });
    expect(resolved.kind === "resolved" && resolved.account.configDir).toBe("~/.codex-school");
  });

  it("reports an id that exists only for other providers", () => {
    expect(resolveAccount([{ use: "work" }], twoProviders, "codex-cli", facts)).toEqual({
      kind: "missingForProvider",
      accountId: "work",
      providers: ["claude-cli"],
    });
  });

  it("reports an unknown id", () => {
    expect(resolveAccount([{ use: "nobody" }], twoProviders, "claude-cli", facts)).toEqual({
      kind: "unknownId",
      accountId: "nobody",
    });
  });

  it("is none when no rule matches or the matched rule names no account", () => {
    expect(
      resolveAccount([{ when: { protected: true }, use: "school" }], twoProviders, "claude-cli", facts),
    ).toEqual({
      kind: "none",
    });
    expect(resolveAccount([{ email: "x@y.z" }], twoProviders, "claude-cli", facts)).toEqual({ kind: "none" });
  });

  it("asks for the authorization line only when such a rule is reached", () => {
    const lineRule = { when: { authorizationLineMatches: "review" }, use: "school" };
    expect(resolveAccount([lineRule], twoProviders, "claude-cli", facts)).toEqual({
      kind: "needsAuthorizationLine",
    });
    const first = { when: { pathGlob: "**/TOM/**" }, use: "work" };
    expect(resolveAccount([first, lineRule], twoProviders, "claude-cli", facts)).toMatchObject({
      kind: "resolved",
      accountId: "work",
    });
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
