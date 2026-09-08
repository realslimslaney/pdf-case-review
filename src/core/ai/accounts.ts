// Layer 2 accounts: separate CLI login directories, selected by `requiredAccount` rules through
// `use`. An id is unique per provider, not globally, so `use: "school"` keeps working when the
// provider changes: the entry for the active provider is the one that runs. Pure, so the merge
// order of the guided "add an AI account" flow and the resolution kinds are unit-tested.

import { firstMatchingRule, type RequiredAccountRule, type RuleFacts } from "./consent";

export type AiProvider = "claude-cli" | "codex-cli";

export interface AiAccount {
  id: string;
  provider: AiProvider;
  configDir: string;
}

export interface NewAccountInput {
  id: string;
  provider: AiProvider;
  configDir: string;
  scope: { kind: "always" } | { kind: "folder"; pathGlob: string } | { kind: "protected" } | { kind: "none" };
}

export function validAccountId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

export function defaultConfigDir(provider: AiProvider, id: string): string {
  return provider === "claude-cli" ? `~/.claude-${id}` : `~/.codex-${id}`;
}

function isProvider(value: unknown): value is AiProvider {
  return value === "claude-cli" || value === "codex-cli";
}

/** The key an account is unique under. */
export function accountKey(id: string, provider: AiProvider): string {
  return `${provider}:${id}`;
}

/** Validates raw setting entries. A repeated (id, provider) pair warns and the first entry wins. */
export function parseAccounts(raw: unknown, warnings: string[]): AiAccount[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push("accounts must be a list");
    return [];
  }
  const accounts: AiAccount[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      warnings.push("account entries must be objects");
      continue;
    }
    const source = entry as Record<string, unknown>;
    const id = source["id"];
    const provider = source["provider"];
    const configDir = source["configDir"];
    if (
      typeof id !== "string" ||
      id === "" ||
      !isProvider(provider) ||
      typeof configDir !== "string" ||
      configDir === ""
    ) {
      warnings.push(`account "${typeof id === "string" ? id : "?"}" needs id, provider and configDir`);
      continue;
    }
    const key = accountKey(id, provider);
    if (seen.has(key)) {
      warnings.push(`account "${id}" is listed twice for ${provider}; the first entry wins`);
      continue;
    }
    seen.add(key);
    accounts.push({ id, provider, configDir });
  }
  return accounts;
}

export function accountFor(
  accounts: readonly AiAccount[],
  id: string,
  provider: AiProvider,
): AiAccount | undefined {
  return accounts.find((account) => account.id === id && account.provider === provider);
}

/** The providers an id is registered for, in settings order. */
export function providersFor(accounts: readonly AiAccount[], id: string): AiProvider[] {
  return accounts.filter((account) => account.id === id).map((account) => account.provider);
}

/** The (id, provider) keys present in raw entries, for the guided flow's uniqueness check. */
export function accountKeysIn(raw: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null) {
      const { id, provider } = entry as Record<string, unknown>;
      if (typeof id === "string" && isProvider(provider)) {
        keys.add(accountKey(id, provider));
      }
    }
  }
  return keys;
}

/** How many raw rules select the account `id` through `use`. */
export function rulesUsing(rawRules: readonly unknown[], id: string): number {
  let count = 0;
  for (const rule of rawRules) {
    if (typeof rule === "object" && rule !== null && (rule as Record<string, unknown>)["use"] === id) {
      count += 1;
    }
  }
  return count;
}

export type AccountResolution =
  /** No rule matched, or the matched rule names no account: the provider's default login runs. */
  | { kind: "none" }
  | { kind: "needsAuthorizationLine" }
  | { kind: "resolved"; accountId: string; account: AiAccount; rule: RequiredAccountRule }
  /** The id exists, but not for this provider: the run must be refused with a named fix. */
  | { kind: "missingForProvider"; accountId: string; providers: AiProvider[] }
  | { kind: "unknownId"; accountId: string };

/** The account a document runs under for `provider`, following the first matching rule. */
export function resolveAccount(
  rules: readonly RequiredAccountRule[],
  accounts: readonly AiAccount[],
  provider: AiProvider,
  facts: RuleFacts,
): AccountResolution {
  const match = firstMatchingRule(rules, facts);
  if (match.kind === "needsAuthorizationLine") {
    return { kind: "needsAuthorizationLine" };
  }
  if (match.kind === "none" || match.rule.use === undefined) {
    return { kind: "none" };
  }
  const accountId = match.rule.use;
  const account = accountFor(accounts, accountId, provider);
  if (account) {
    return { kind: "resolved", accountId, account, rule: match.rule };
  }
  const providers = providersFor(accounts, accountId);
  return providers.length > 0
    ? { kind: "missingForProvider", accountId, providers }
    : { kind: "unknownId", accountId };
}

/**
 * A scoped rule is prepended so it beats an existing catch-all. An always rule goes in front of the
 * first existing catch-all (rules are first-match-wins, so appending it behind one would make the
 * new account unreachable) and after every scoped rule, which keep winning. Raw values are carried
 * through untouched: the flow must never rewrite entries the user typed by hand.
 */
export function mergeAccountSettings(
  accounts: readonly unknown[],
  rules: readonly unknown[],
  input: NewAccountInput,
): { accounts: unknown[]; rules: unknown[] } {
  const nextAccounts = [...accounts, { id: input.id, provider: input.provider, configDir: input.configDir }];
  const placed = ruleFor(input);
  const nextRules =
    placed === undefined
      ? [...rules]
      : placed.prepend
        ? [placed.rule, ...rules]
        : insertBeforeCatchAll(rules, placed.rule);
  return { accounts: nextAccounts, rules: nextRules };
}

function isCatchAll(rule: unknown): boolean {
  if (typeof rule !== "object" || rule === null) {
    return false;
  }
  const when = (rule as Record<string, unknown>)["when"];
  return when === undefined || when === null || (typeof when === "object" && Object.keys(when).length === 0);
}

function insertBeforeCatchAll(rules: readonly unknown[], rule: object): unknown[] {
  const index = rules.findIndex(isCatchAll);
  return index === -1 ? [...rules, rule] : [...rules.slice(0, index), rule, ...rules.slice(index)];
}

function ruleFor(input: NewAccountInput): { rule: object; prepend: boolean } | undefined {
  switch (input.scope.kind) {
    case "none":
      return undefined;
    case "always":
      return { rule: { use: input.id }, prepend: false };
    case "folder":
      return { rule: { when: { pathGlob: input.scope.pathGlob }, use: input.id }, prepend: true };
    case "protected":
      return { rule: { when: { protected: true }, use: input.id }, prepend: true };
  }
}
