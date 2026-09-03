// AI page context (issue #29): a few sentences of AI-written context above a dense cluster of
// lightly-annotated highlights. Pure: which pages qualify, the prompt, and the staleness digest
// live here so they are unit-tested; the extension command only orchestrates.

import { UNCATEGORIZED_CATEGORY } from "../categories";
import type { Sidecar } from "../sidecar/types";
import { type Attestation, isAttestation } from "./consent";
import { fnv1a64 } from "./digest";
import { SUMMARY_SYSTEM_PROMPT, type SummaryPrompt } from "./prompt";

/** Bump when the template wording changes, so cached contexts from the old template read as stale. */
export const PAGE_CONTEXT_PROMPT_VERSION = 1;

export const DEFAULT_PAGE_CONTEXT_MIN_HIGHLIGHTS = 4;

/**
 * Pages worth offering context for: at least `minHighlights` highlights and fewer than half of
 * them carrying a note. A page the reader annotated densely needs no machine help.
 */
export function pagesNeedingContext(sidecar: Sidecar, minHighlights: number): number[] {
  const perPage = new Map<number, { count: number; noted: number }>();
  for (const highlight of sidecar.highlights) {
    const entry = perPage.get(highlight.page) ?? { count: 0, noted: 0 };
    entry.count += 1;
    if (highlight.note.trim() !== "") {
      entry.noted += 1;
    }
    perPage.set(highlight.page, entry);
  }
  return [...perPage.entries()]
    .filter(([, entry]) => entry.count >= minHighlights && entry.noted * 2 < entry.count)
    .map(([page]) => page)
    .sort((left, right) => left - right);
}

interface PageSlice {
  entries: { category: string; text: string; note: string }[];
  pageNote: string;
}

function sliceFor(sidecar: Sidecar, page: number): PageSlice {
  const categoryNames = new Map(sidecar.categories.map((category) => [category.id, category.name]));
  const entries = sidecar.highlights
    .filter((highlight) => highlight.page === page)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((highlight) => ({
      category: categoryNames.get(highlight.categoryId) ?? UNCATEGORIZED_CATEGORY.name,
      text: highlight.text,
      note: highlight.note,
    }));
  const pageNote = (sidecar.pageNotes ?? []).find((note) => note.page === page)?.note ?? "";
  return { entries, pageNote };
}

export function buildPageContextPrompt(
  sidecar: Sidecar,
  page: number,
  pageLabel: string | undefined,
  attestation: Attestation,
): SummaryPrompt {
  if (!isAttestation(attestation)) {
    throw new Error("An eligibility attestation is required before an AI prompt can be built.");
  }
  const slice = sliceFor(sidecar, page);
  const pageName = pageLabel !== undefined && pageLabel !== `${page}` ? `${pageLabel} [${page}]` : `${page}`;
  const lines = slice.entries.map(
    (entry) =>
      `- [${entry.category}] "${entry.text.trim()}"${entry.note.trim() ? ` (note: ${entry.note.trim()})` : ""}`,
  );
  const pageNoteLine = slice.pageNote.trim()
    ? `\nThe reader's note on this page: ${slice.pageNote.trim()}\n`
    : "";
  return {
    system: SUMMARY_SYSTEM_PROMPT,
    user:
      `These are a reader's highlights on page ${pageName} of "${sidecar.source.title ?? sidecar.source.fileName}":\n\n` +
      `${lines.join("\n")}\n${pageNoteLine}\n` +
      "In 2 to 4 sentences, explain what these highlighted passages are about and why they hang " +
      "together, so the list is skimmable without a note on every highlight. Plain prose, no " +
      "preamble, no bullets, no invented facts.",
  };
}

/** Digest over exactly what the page-context prompt is built from; compared per page at report time. */
export function pageContextInputDigest(sidecar: Sidecar, page: number): string {
  const slice = sliceFor(sidecar, page);
  return fnv1a64(
    JSON.stringify({
      promptVersion: PAGE_CONTEXT_PROMPT_VERSION,
      title: sidecar.source.title ?? sidecar.source.fileName,
      page,
      entries: slice.entries,
      pageNote: slice.pageNote,
    }),
  );
}
