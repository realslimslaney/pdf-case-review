// Staleness detection for cached AI summaries: a stable digest over exactly the content the
// summary prompt is built from. The rendered Markdown body cannot be digested directly because
// it embeds the generation timestamp, so the digest canonicalizes the underlying sidecar content.

import { sortDocumentNotes } from "../sidecar/serialize";
import { type Sidecar, sortedCategories } from "../sidecar/types";
import { DEFAULT_MAX_WORDS, SUMMARY_PROMPT_VERSION } from "./prompt";

/** FNV-1a 64-bit as a hex string. Change detection only, no security properties. */
export function fnv1a64(text: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Digests everything the summary prompt depends on: title, categories, highlights with their
 * quotes and notes, page and document notes, the word budget, and the prompt template version.
 * Arrays are sorted first so reordering without a content change never reads as stale.
 */
export function summaryInputDigest(sidecar: Sidecar, maxWords: number = DEFAULT_MAX_WORDS): string {
  const canonical = {
    promptVersion: SUMMARY_PROMPT_VERSION,
    maxWords,
    title: sidecar.source.title ?? sidecar.source.fileName,
    categories: sortedCategories(sidecar.categories).map(({ id, name }) => ({ id, name })),
    highlights: [...sidecar.highlights]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ id, categoryId, page, kind, text, note }) => ({ id, categoryId, page, kind, text, note })),
    pageNotes: [...(sidecar.pageNotes ?? [])]
      .sort((a, b) => a.page - b.page)
      .map(({ page, note }) => ({ page, note })),
    documentNotes: sortDocumentNotes(sidecar.documentNotes ?? []).map(({ title, note }) => ({
      title,
      note,
    })),
  };
  return fnv1a64(JSON.stringify(canonical));
}
