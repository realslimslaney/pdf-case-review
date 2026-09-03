// The one summary prompt template every provider uses, manual hand-off included. The attestation
// parameter is the gate: without an Attestation there is no prompt (a compile error), and a value
// that is not a real attestation throws.

import { type Attestation, isAttestation } from "./consent";
import type { DocumentTextResult } from "./documentText";

export const SUMMARY_SYSTEM_PROMPT =
  "You are helping a reader synthesize their own reading notes on a document. " +
  "Use only the highlights and notes provided; do not invent facts.";

/** The document-text scope names its wider payload; claims from the text must carry page citations. */
export const DOCUMENT_TEXT_SYSTEM_PROMPT =
  "You are helping a reader synthesize their own reading notes on a document. " +
  "Use only the highlights, notes and document text provided; when you draw on the document " +
  "text, cite the page markers; do not invent facts.";

/** Bump when the template wording changes, so cached summaries from the old template read as stale. */
export const SUMMARY_PROMPT_VERSION = 1;

export const DEFAULT_MAX_WORDS = 250;

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
