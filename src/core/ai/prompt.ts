// The one summary prompt template every provider uses, manual hand-off included. The attestation
// parameter is the gate: without an Attestation there is no prompt (a compile error), and a value
// that is not a real attestation throws.

import { type Attestation, isAttestation } from "./consent";

export const SUMMARY_SYSTEM_PROMPT =
  "You are helping a reader synthesize their own reading notes on a document. " +
  "Use only the highlights and notes provided; do not invent facts.";

export const DEFAULT_MAX_WORDS = 250;

export interface SummaryPrompt {
  system: string;
  user: string;
}

export function buildSummaryPrompt(
  markdownBody: string,
  options: { maxWords: number },
  attestation: Attestation,
): SummaryPrompt {
  if (!isAttestation(attestation)) {
    throw new Error("An eligibility attestation is required before an AI prompt can be built.");
  }
  const maxWords =
    Number.isInteger(options.maxWords) && options.maxWords > 0 ? options.maxWords : DEFAULT_MAX_WORDS;
  return {
    system: SUMMARY_SYSTEM_PROMPT,
    user:
      `${markdownBody.trim()}\n\n` +
      `Write an executive summary of at most ${maxWords} words, then 3 to 5 key tensions or open ` +
      "questions as bullets. Plain Markdown, no preamble.",
  };
}
