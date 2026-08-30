// Text normalization shared by text capture, the sidecar and the report.

/** Re-joins words that were hyphenated across a line break (`mar-\ngin` becomes `margin`). */
export function joinHyphenatedBreaks(text: string): string {
  return text.replace(/(\w)-\s*\n\s*(\w)/g, "$1$2");
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Text as it goes into the sidecar and the report: hyphenation undone, whitespace collapsed. */
export function normalizeCapturedText(text: string): string {
  return normalizeWhitespace(joinHyphenatedBreaks(text));
}
