// The eligibility gate's pure logic (the §9.4 design): wording, required-account rule evaluation,
// authorization-line extraction, re-consent triggers, and the branded attestation object that the
// prompt builder demands. Nothing here talks to a CLI, a dialog or a file.

import type { AiConsent } from "../sidecar/types";
import { scopeRank } from "./contextScope";

/** Bump when any consent wording changes; stored acknowledgments re-prompt. */
export const CONSENT_WORDING_VERSION = 1;

export const RESPONSIBILITY_STATEMENT =
  "I am responsible for using this tool on appropriate content, and the developers of this " +
  "extension are not liable for misuse.";

export const ELIGIBILITY_QUESTION = "May this document be fed into AI context on this account?";

export const FIRST_USE_TITLE = "Using AI features responsibly";

export const FIRST_USE_TEXT =
  "PDF Case Review can send excerpts of the documents you highlight, plus your notes, to the AI " +
  "provider you choose. Many documents (purchased cases, licensed articles, confidential material) " +
  `restrict who may read them and whether they may be shared with third-party services. ${RESPONSIBILITY_STATEMENT}`;

declare const attestationBrand: unique symbol;

/** Proof that the eligibility gate ran; only `createAttestation` can produce one. */
export interface Attestation {
  readonly [attestationBrand]: true;
  readonly record: AiConsent;
}

export function createAttestation(record: AiConsent): Attestation {
  if (
    typeof record.email !== "string" ||
    record.email === "" ||
    typeof record.attestedAt !== "string" ||
    record.responsibilityAcknowledged !== true
  ) {
    throw new Error("An attestation needs an email, a timestamp and the acknowledged responsibility.");
  }
  return { record } as unknown as Attestation;
}

export function isAttestation(value: unknown): value is Attestation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = (value as { record?: unknown }).record;
  if (typeof record !== "object" || record === null) {
    return false;
  }
  const consent = record as Partial<AiConsent>;
  return (
    typeof consent.email === "string" &&
    consent.email !== "" &&
    typeof consent.attestedAt === "string" &&
    consent.responsibilityAcknowledged === true
  );
}

const AUTHORIZATION_PATTERN = /authorized for use only by|licensed to|for the personal use of/i;

/** The document's own eligibility statement, from page-1 text; null when there is none. */
export function extractAuthorizationLine(pageText: string): string | null {
  const normalized = pageText.replace(/\s+/g, " ").trim();
  const match = AUTHORIZATION_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  const rest = normalized.slice(match.index);
  const period = rest.indexOf(". ");
  const line = period > 0 && period < 200 ? rest.slice(0, period + 1) : rest.slice(0, 160);
  return line.trim();
}

/** Concrete steps to get the right account signed in, shown wherever the wrong one appears. */
export function switchAccountInstructions(provider: string, requiredEmail?: string): string {
  const account = requiredEmail ?? "the right account";
  const steps =
    provider === "claude-cli"
      ? `In a terminal run claude, type /logout, sign in with ${account}, then retry.`
      : provider === "codex-cli"
        ? `In a terminal run codex logout, then codex login and sign in with ${account}, then retry.`
        : `Retry and enter ${account} when asked, or sign in to a provider CLI so the account can be verified.`;
  return (
    `${steps} If you switch accounts often, register a separate login directory under ` +
    "pdfCaseReview.ai.accounts instead."
  );
}

export interface RequiredAccountRule {
  when?: { protected?: boolean; authorizationLineMatches?: string; pathGlob?: string };
  /** The account that must be logged in when the rule matches. */
  email?: string;
  /** A `pdfCaseReview.ai.accounts` id to run under (Layer 2). */
  use?: string;
}

export interface RuleFacts {
  protected: boolean;
  /** null = no line found, or the page text was unavailable. */
  authorizationLine: string | null;
  /** Forward slashes; matched case-insensitively. */
  filePath: string;
}

function globToRegExp(glob: string): RegExp | null {
  try {
    const escaped = glob
      .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
      .split("**")
      .map((part) => part.replaceAll("*", "[^/]*").replaceAll("?", "[^/]"))
      .join(".*");
    return new RegExp(`(^|/)${escaped}$`, "i");
  } catch {
    return null;
  }
}

export type RuleMatch =
  | { kind: "matched"; rule: RequiredAccountRule }
  | { kind: "none" }
  | { kind: "needsAuthorizationLine"; rule: RequiredAccountRule };

/** The first rule whose conditions hold. A line-conditioned rule with no line available blocks. */
export function firstMatchingRule(rules: readonly RequiredAccountRule[], facts: RuleFacts): RuleMatch {
  for (const rule of rules) {
    const when = rule.when ?? {};
    if (when.protected !== undefined && when.protected !== facts.protected) {
      continue;
    }
    if (when.pathGlob !== undefined) {
      const pattern = globToRegExp(when.pathGlob);
      if (!pattern?.test(facts.filePath.replaceAll("\\", "/"))) {
        continue;
      }
    }
    if (when.authorizationLineMatches !== undefined) {
      if (facts.authorizationLine === null) {
        return { kind: "needsAuthorizationLine", rule };
      }
      let pattern: RegExp;
      try {
        pattern = new RegExp(when.authorizationLineMatches, "i");
      } catch {
        continue;
      }
      if (!pattern.test(facts.authorizationLine)) {
        continue;
      }
    }
    return { kind: "matched", rule };
  }
  return { kind: "none" };
}

export interface RuleIdentity {
  email: string | null;
  verified: boolean;
}

export type RuleCheck = { ok: true } | { ok: false; requiredEmail: string };

/** A matched rule with an email refuses any other (or unknown) login. No override. */
export function checkRule(rule: RequiredAccountRule, identity: RuleIdentity): RuleCheck {
  if (rule.email === undefined) {
    return { ok: true };
  }
  if (identity.email === null || identity.email.toLowerCase() !== rule.email.toLowerCase()) {
    return { ok: false, requiredEmail: rule.email };
  }
  return { ok: true };
}

export interface ReconsentFacts {
  provider: string;
  email: string;
  documentSha256: string;
  protected: boolean;
  /** The AI context scope about to be used; a change of scope always re-asks. */
  contextScope?: string;
}

/** Protected documents re-ask every run; otherwise any change of login, provider, file or wording. */
export function needsReconsent(stored: AiConsent | undefined, current: ReconsentFacts): boolean {
  if (!stored || current.protected) {
    return true;
  }
  return (
    stored.provider !== current.provider ||
    stored.email.toLowerCase() !== current.email.toLowerCase() ||
    stored.documentSha256 !== current.documentSha256 ||
    // A wider consent covers narrower runs: document-text consent also authorizes a notes-only
    // run (page context, say) without re-asking; only widening the scope re-asks.
    scopeRank(current.contextScope) > scopeRank(stored.contextScope) ||
    stored.wordingVersion !== CONSENT_WORDING_VERSION ||
    stored.eligibilityConfirmed !== true
  );
}
