// Deterministic sidecar text so git diffs stay readable: sorted keys, 2-space indent, LF,
// highlights in reading order.

import { type DocumentNote, type Sidecar, type SidecarHighlight, sortedCategories } from "./types";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Recursively sorts object keys and drops `undefined` values; arrays keep their order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareStrings(left, right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeysDeep(entry)]));
  }
  return value;
}

/** JSON with sorted keys at every level, `indent` spaces, LF line endings and a trailing newline. */
export function stableStringify(value: unknown, indent = 2): string {
  return `${JSON.stringify(sortKeysDeep(value), null, indent)}\n`;
}

/** Reading order: page, then top edge descending (PDF y grows upward), then left edge, then id. */
export function compareHighlights(left: SidecarHighlight, right: SidecarHighlight): number {
  return (
    left.page - right.page ||
    right.rect[3] - left.rect[3] ||
    left.rect[0] - right.rect[0] ||
    compareStrings(left.id, right.id)
  );
}

export function sortHighlights(highlights: readonly SidecarHighlight[]): SidecarHighlight[] {
  return [...highlights].sort(compareHighlights);
}

/** Creation order; ids break the (unlikely) tie so the order is total. */
export function compareDocumentNotes(left: DocumentNote, right: DocumentNote): number {
  return compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);
}

export function sortDocumentNotes(notes: readonly DocumentNote[]): DocumentNote[] {
  return [...notes].sort(compareDocumentNotes);
}

export function serializeSidecar(sidecar: Sidecar): string {
  const ordered: Sidecar = {
    ...sidecar,
    categories: sortedCategories(sidecar.categories),
    highlights: sortHighlights(sidecar.highlights),
  };
  if (sidecar.pageNotes) {
    ordered.pageNotes = [...sidecar.pageNotes].sort((left, right) => left.page - right.page);
  }
  if (sidecar.documentNotes) {
    ordered.documentNotes = sortDocumentNotes(sidecar.documentNotes);
  }
  return stableStringify(ordered);
}
