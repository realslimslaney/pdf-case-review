// The one summary prompt template every provider uses, manual hand-off included. The attestation
// parameter is the gate: without an Attestation there is no prompt (a compile error), and a value
// that is not a real attestation throws.

import { countNotes, type Sidecar } from "../sidecar/types";
import { type Attestation, isAttestation } from "./consent";
import type { AiContextScope } from "./contextScope";
import type { DocumentTextResult } from "./documentText";

/**
 * The CLIs run with every tool disabled, but a model that is not told so improvises: given
 * little to work with it has narrated pretend shell commands and their invented output.
 */
export const NO_TOOLS_RULE =
  "You have no tools and cannot run commands or open files; everything you may use is in this " +
  "message. Reply with the summary text only, with no preamble and no tool calls. Write plain " +
  "sentences; use commas, colons or parentheses instead of em-dashes.";

export const SUMMARY_SYSTEM_PROMPT =
  "You are helping a reader synthesize their own reading notes on a document. " +
  "Use only the highlights and notes provided; do not invent facts. " +
  NO_TOOLS_RULE;

/** The document-text scope names its wider payload; claims from the text must carry page citations. */
export const DOCUMENT_TEXT_SYSTEM_PROMPT =
  "You are helping a reader synthesize their own reading notes on a document. " +
  "Use only the highlights, notes and document text provided; when you draw on the document " +
  "text, cite the page markers; do not invent facts. " +
  NO_TOOLS_RULE;

/** Bump when the template wording changes, so cached summaries from the old template read as stale. */
export const SUMMARY_PROMPT_VERSION = 3;

export const DEFAULT_MAX_WORDS = 500;

/** Whether a prompt would carry anything at all; an empty one leaves the model to improvise. */
export function hasSummaryContent(
  sidecar: Sidecar,
  scope: AiContextScope,
  documentText?: Pick<DocumentTextResult, "words">,
): boolean {
  if (sidecar.highlights.length > 0 || countNotes(sidecar) > 0) {
    return true;
  }
  return scope === "document-text" && (documentText?.words ?? 0) > 0;
}

export interface SummaryPrompt {
  system: string;
  user: string;
}

export function buildSummaryPrompt(
  markdownBody: string,
  options: { maxWords: number },
  attestation: Attestation,
  documentText?: DocumentTextResult,
): SummaryPrompt {
  if (!isAttestation(attestation)) {
    throw new Error("An eligibility attestation is required before an AI prompt can be built.");
  }
  const maxWords =
    Number.isInteger(options.maxWords) && options.maxWords > 0 ? options.maxWords : DEFAULT_MAX_WORDS;
  const documentSection = documentText ? `\n\n${documentText.section.trim()}` : "";
  return {
    system: documentText ? DOCUMENT_TEXT_SYSTEM_PROMPT : SUMMARY_SYSTEM_PROMPT,
    user:
      `${markdownBody.trim()}${documentSection}\n\n` +
      `Write an executive summary of at most ${maxWords} words, then 3 to 5 key tensions or open ` +
      "questions as bullets. Plain Markdown, no preamble.",
  };
}
