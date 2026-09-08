// The account behind a gate run. The gate verifies one identity and the spawn must run under that
// same login directory, so both go through here; a rule naming an id the active provider has no
// entry for is refused with the fix spelled out, never silently run on the default login.

import { type AiProvider, accountFor, providersFor } from "../../core/ai/accounts";
import type { ProviderIdentity } from "../../core/ai/identity";
import type { AiSettings } from "../settings";

export class MissingAccountError extends Error {
  constructor(
    readonly accountId: string,
    readonly provider: AiProvider,
    readonly providers: AiProvider[],
  ) {
    super(
      `the matched requiredAccount rule selects account "${accountId}", but pdfCaseReview.ai.accounts ` +
        `has no ${provider} entry with that id (only ${providers.join(", ")}). Add one with ` +
        "Configure > Add an AI Account..., or switch the provider back.",
    );
    this.name = "MissingAccountError";
  }
}

function activeProvider(settings: AiSettings): AiProvider {
  if (settings.provider === "off") {
    throw new Error("no AI provider is configured (pdfCaseReview.ai.provider is off).");
  }
  return settings.provider;
}

function requiredAccount(settings: AiSettings, accountId: string) {
  const provider = activeProvider(settings);
  const account = accountFor(settings.accounts, accountId, provider);
  if (account) {
    return account;
  }
  const providers = providersFor(settings.accounts, accountId);
  if (providers.length > 0) {
    throw new MissingAccountError(accountId, provider, providers);
  }
  throw new Error(
    `a requiredAccount rule names the account "${accountId}", but pdfCaseReview.ai.accounts has no such entry.`,
  );
}

/** The identity a run would execute as: the rule's account for the active provider, else the default login. */
export async function resolveIdentity(
  settings: AiSettings,
  accountId: string | undefined,
): Promise<ProviderIdentity> {
  const desktop = await import("../desktop/identity");
  if (accountId !== undefined) {
    return desktop.whoAmIForAccount(requiredAccount(settings, accountId));
  }
  return activeProvider(settings) === "claude-cli" ? desktop.whoAmIClaude() : desktop.whoAmICodex();
}

/** The login directory for the gate's account; undefined means the provider's default login. */
export function configDirFor(settings: AiSettings, accountId: string | undefined): string | undefined {
  return accountId === undefined ? undefined : requiredAccount(settings, accountId).configDir;
}
