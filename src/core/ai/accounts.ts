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
 * A scoped rule is prepended so it beats an existing catch-all; an always rule is appended so
 * existing scoped rules keep winning and the new account becomes the fallback. Raw values are
 * carried through untouched: the flow must never rewrite entries the user typed by hand.
 */
export function mergeAccountSettings(
  accounts: readonly unknown[],
  rules: readonly unknown[],
  input: NewAccountInput,
): { accounts: unknown[]; rules: unknown[] } {
  const nextAccounts = [...accounts, { id: input.id, provider: input.provider, configDir: input.configDir }];
  switch (input.scope.kind) {
    case "none":
      return { accounts: nextAccounts, rules: [...rules] };
    case "always":
      return { accounts: nextAccounts, rules: [...rules, { use: input.id }] };
    case "folder":
      return {
        accounts: nextAccounts,
        rules: [{ when: { pathGlob: input.scope.pathGlob }, use: input.id }, ...rules],
      };
    case "protected":
      return { accounts: nextAccounts, rules: [{ when: { protected: true }, use: input.id }, ...rules] };
  }
}
