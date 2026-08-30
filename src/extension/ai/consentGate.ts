// The eligibility gate (PLAN §9.4): the one chokepoint every AI path calls before any excerpt can
// leave the machine. Fail closed: an error, refusal or cancel means no attestation, and without an
// attestation the prompt builder will not produce a prompt.

import { type Memento, window, workspace } from "vscode";

import {
  type Attestation,
  CONSENT_WORDING_VERSION,
  checkRule,
  createAttestation,
  ELIGIBILITY_QUESTION,
  extractAuthorizationLine,
  FIRST_USE_TEXT,
  firstMatchingRule,
  needsReconsent,
  RESPONSIBILITY_STATEMENT,
} from "../../core/ai/consent";
import type { ProviderIdentity } from "../../core/ai/identity";
import { type AiConsent, countNotes } from "../../core/sidecar/types";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import type { AiSettings } from "../settings";

const FIRST_USE_KEY = "pdfCaseReview.ai.firstUseAcknowledged";

export interface GateDeps {
  /** The logged-in identity, for `accountId` when a rule names a Layer 2 account; null = manual. */
  whoAmI: (accountId?: string) => Promise<ProviderIdentity | null>;
  /** What the attestation records: `manual`, `claude-cli` or `codex-cli`. */
  provider: string;
  settings: AiSettings;
  globalState: Memento;
  editorProvider: PdfCaseReviewEditorProvider;
}

export type GateResult =
  | { ok: true; attestation: Attestation; accountId?: string }
  | { ok: false; reason: string };

/** Pre-answers the dialogs so integration tests can drive the gate without a human. */
export interface ConsentTestResponder {
  firstUse?: boolean;
  eligibility?: "yes" | "no";
  extraAck?: boolean;
  typedEmail?: string;
}

let testResponder: ConsentTestResponder | undefined;

export function setConsentTestResponder(responder: ConsentTestResponder | undefined): void {
  testResponder = responder;
}

async function typedEmail(): Promise<string | undefined> {
  if (testResponder) {
    return testResponder.typedEmail;
  }
  const entered = await window.showInputBox({
    prompt:
      "The account could not be read. Enter the email of the account that will process the excerpts " +
      "(it is recorded as unverified).",
    validateInput: (value) => (value.includes("@") ? undefined : "Enter an email address."),
  });
  return entered?.trim() || undefined;
}

async function confirmFirstUse(globalState: Memento): Promise<boolean> {
  if (globalState.get<number>(FIRST_USE_KEY) === CONSENT_WORDING_VERSION) {
    return true;
  }
  const accepted = testResponder
    ? (testResponder.firstUse ?? true)
    : (await window.showInformationMessage(
        "Using AI features responsibly",
        { modal: true, detail: FIRST_USE_TEXT },
        "I agree, enable AI features",
      )) !== undefined;
  if (accepted) {
    await globalState.update(FIRST_USE_KEY, CONSENT_WORDING_VERSION);
  }
  return accepted;
}

async function confirmExtraAck(fileName: string): Promise<boolean> {
  if (testResponder) {
    return testResponder.extraAck ?? true;
  }
  const choice = await window.showWarningMessage(
    "Unverified account on a protected document",
    {
      modal: true,
      detail:
        `${fileName} is publisher-protected and the account could not be verified from a CLI login. ` +
        `${RESPONSIBILITY_STATEMENT}`,
    },
    "I understand, continue",
  );
  return choice !== undefined;
}

interface EligibilityFacts {
  email: string;
  organization: string | undefined;
  verified: boolean;
  authorizationLine: string | null;
  authorizationLineAvailable: boolean;
}

async function confirmEligibility(document: PdfDocument, facts: EligibilityFacts): Promise<boolean> {
  if (testResponder) {
    return (testResponder.eligibility ?? "yes") === "yes";
  }
  const model = document.model;
  const account = `${facts.email}${facts.organization ? ` · ${facts.organization}` : ""} (${
    facts.verified ? "verified" : "unverified"
  })`;
  const lineText = facts.authorizationLine
    ? `"${facts.authorizationLine}"`
    : facts.authorizationLineAvailable
      ? "no authorization line found on page 1"
      : "authorization line unavailable (viewer closed)";
  const counts = `${model.highlights.length} highlighted excerpt(s) and ${countNotes(model)} note(s)`;
  const choice = await window.showWarningMessage(
    ELIGIBILITY_QUESTION,
    {
      modal: true,
      detail:
        `Account: ${account}\n` +
        `Document: ${model.source.fileName}${document.protected ? " (publisher-protected)" : ""} · ${lineText}\n` +
        `What will be sent: ${counts}. The PDF itself is never sent.\n\n` +
        `If you answer yes and are wrong, that responsibility is yours. ${RESPONSIBILITY_STATEMENT}`,
    },
    "Yes, this account is allowed to process this document",
  );
  return choice !== undefined;
}

export async function ensureAttestation(document: PdfDocument, deps: GateDeps): Promise<GateResult> {
  if (!workspace.isTrusted) {
    return { ok: false, reason: "AI features are disabled in untrusted workspaces." };
  }

  const pageText = await deps.editorProvider.getPageText(document, 1);
  const authorizationLine = pageText === null ? null : extractAuthorizationLine(pageText);
  const facts = {
    protected: document.protected,
    authorizationLine,
    filePath: document.uri.path,
  };
  const match = firstMatchingRule(deps.settings.requiredAccount, facts);
  if (match.kind === "needsAuthorizationLine") {
    const reason =
      "A required-account rule needs the document's authorization line; open the PDF in the viewer, " +
      "let it load, then retry.";
    void window.showErrorMessage(`PDF Case Review: ${reason}`);
    return { ok: false, reason };
  }

  const accountId = match.kind === "matched" ? match.rule.use : undefined;
  const identity = await deps.whoAmI(accountId);
  let email = identity?.email ?? null;
  let verified = identity?.verified === true && identity.email !== null;
  const organization = identity?.organization ?? undefined;
  if (identity && !identity.loggedIn) {
    email = null;
    verified = false;
  }
  if (email === null) {
    const entered = await typedEmail();
    if (!entered) {
      return { ok: false, reason: "No account was reported and none was entered." };
    }
    email = entered;
    verified = false;
  }

  if (match.kind === "matched") {
    const check = checkRule(match.rule, { email, verified });
    if (!check.ok) {
      const reason =
        `This document requires ${check.requiredEmail}; the current account is ${email}. ` +
        "Log out, sign in with the required account, then retry.";
      void window.showErrorMessage(`PDF Case Review: ${reason}`);
      return { ok: false, reason };
    }
    if (match.rule.email !== undefined && !verified && deps.provider !== "manual") {
      const reason =
        `This document requires the verified account ${match.rule.email}, but the login could not ` +
        "be verified.";
      void window.showErrorMessage(`PDF Case Review: ${reason}`);
      return { ok: false, reason };
    }
  }

  if (document.protected && !verified && deps.settings.requireVerifiedAccountForProtected) {
    if (deps.provider !== "manual") {
      const reason =
        "This protected document requires a verified CLI login. Sign in to the provider CLI, or set " +
        "pdfCaseReview.ai.requireVerifiedAccountForProtected to false.";
      void window.showErrorMessage(`PDF Case Review: ${reason}`);
      return { ok: false, reason };
    }
    if (!(await confirmExtraAck(document.model.source.fileName))) {
      return { ok: false, reason: "Not acknowledged." };
    }
  }

  if (!(await confirmFirstUse(deps.globalState))) {
    return { ok: false, reason: "AI features are not enabled." };
  }

  const stored = document.model.aiConsent;
  const current = {
    provider: deps.provider,
    email,
    documentSha256: document.model.source.sha256,
    protected: document.protected,
  };
  if (!needsReconsent(stored, current) && stored) {
    return { ok: true, attestation: createAttestation(stored), ...(accountId ? { accountId } : {}) };
  }

  const confirmed = await confirmEligibility(document, {
    email,
    organization,
    verified,
    authorizationLine,
    authorizationLineAvailable: pageText !== null,
  });
  if (!confirmed) {
    return { ok: false, reason: "Not confirmed." };
  }

  const record: AiConsent = {
    provider: deps.provider,
    email,
    verified,
    documentSha256: document.model.source.sha256,
    attestedAt: new Date().toISOString(),
    responsibilityAcknowledged: true,
    eligibilityConfirmed: true,
    wordingVersion: CONSENT_WORDING_VERSION,
  };
  if (organization !== undefined) {
    record.organization = organization;
  }
  if (authorizationLine !== null) {
    record.authorizationLine = authorizationLine;
  }
  if (accountId !== undefined) {
    record.accountId = accountId;
  }
  deps.editorProvider.setAiConsent(document, record);
  return { ok: true, attestation: createAttestation(record), ...(accountId ? { accountId } : {}) };
}
