// The facts a `requiredAccount` rule is evaluated against, computed the same way for the gate, the
// status bar and the provider picker. Page 1 is only read from the viewer when asked for, because
// the read needs a live webview and waits for its answer.

import { type AccountResolution, type AiProvider, resolveAccount } from "../../core/ai/accounts";
import { extractAuthorizationLine, type RuleFacts } from "../../core/ai/consent";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import type { AiSettings } from "../settings";

export interface DocumentRuleFacts {
  facts: RuleFacts;
  /** Page 1 text when it was requested and available; null otherwise. */
  pageText: string | null;
}

export async function documentRuleFacts(
  document: PdfDocument,
  editorProvider: PdfCaseReviewEditorProvider,
  options: { needsLine: boolean; timeoutMs?: number },
): Promise<DocumentRuleFacts> {
  const pageText = options.needsLine
    ? await editorProvider.getPageText(document, 1, options.timeoutMs)
    : null;
  const authorizationLine = pageText === null ? null : extractAuthorizationLine(pageText);
  return {
    facts: { protected: document.protected, authorizationLine, filePath: document.uri.path },
    pageText,
  };
}

const LINE_TIMEOUT_MS = 2000;

/** The account resolution for `document` under `provider`, reading page 1 only when a rule needs it. */
export async function resolveDocumentAccount(
  document: PdfDocument,
  editorProvider: PdfCaseReviewEditorProvider,
  settings: AiSettings,
  provider: AiProvider,
): Promise<AccountResolution> {
  const cheap = await documentRuleFacts(document, editorProvider, { needsLine: false });
  const first = resolveAccount(settings.requiredAccount, settings.accounts, provider, cheap.facts);
  if (first.kind !== "needsAuthorizationLine") {
    return first;
  }
  const withLine = await documentRuleFacts(document, editorProvider, {
    needsLine: true,
    timeoutMs: LINE_TIMEOUT_MS,
  });
  return resolveAccount(settings.requiredAccount, settings.accounts, provider, withLine.facts);
}
