// The settings changes behind the guided "add an AI account" flow. Pure so the merge order
// (requiredAccount rules apply first-match-wins) is unit-tested.

export interface NewAccountInput {
  id: string;
  provider: "claude-cli" | "codex-cli";
  configDir: string;
  scope: { kind: "always" } | { kind: "folder"; pathGlob: string } | { kind: "protected" } | { kind: "none" };
}

export function validAccountId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

export function defaultConfigDir(provider: NewAccountInput["provider"], id: string): string {
  return provider === "claude-cli" ? `~/.claude-${id}` : `~/.codex-${id}`;
}

export function accountIdsIn(raw: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null) {
      const id = (entry as Record<string, unknown>)["id"];
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }
  return ids;
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
