// The Highlights view as data: groups (by category or by page) of highlight rows, plus the
// document-notes group and per-page note rows. Pure so the labels, ordering and buckets are
// unit-tested; the extension turns these into TreeItems.

import { UNCATEGORIZED_CATEGORY } from "./categories";
import { formatCitation, normalizeQuote, truncateQuote } from "./report/model";
import { sortDocumentNotes, sortHighlights } from "./sidecar/serialize";
import {
  type DocumentNote,
  type PageNote,
  type Sidecar,
  type SidecarHighlight,
  sortedCategories,
} from "./sidecar/types";

export type GroupBy = "category" | "page";

export const LABEL_MAX_CHARS = 60;
export const IMAGE_REGION_LABEL = "[image region]";
export const NO_TEXT_LABEL = "(no text captured)";
export const DOCUMENT_NOTES_LABEL = "Document notes";
export const PAGE_NOTE_DESCRIPTION = "page note";

export interface HighlightNode {
  kind: "highlight";
  id: string;
  label: string;
  /** `p. 12` or `p. iv [4]`. */
  description: string;
  tooltip: string;
  color: string;
  page: number;
  categoryId: string;
}

export interface PageNoteNode {
  kind: "pageNote";
  /** The page number as a string. */
  id: string;
  page: number;
  label: string;
  description: string;
  tooltip: string;
}

export interface DocumentNoteNode {
  kind: "documentNote";
  id: string;
  label: string;
  description: string;
  tooltip: string;
}

export type LeafNode = HighlightNode | PageNoteNode | DocumentNoteNode;

export interface GroupNode {
  kind: "category" | "page" | "documentNotes";
  /** Category id, the page number as a string, or `documentNotes`. */
  id: string;
  label: string;
  description: string;
  /** Category color; null for page and document-notes groups. */
  color: string | null;
  children: LeafNode[];
}

export function highlightLabel(highlight: SidecarHighlight, quote = normalizeQuote(highlight.text)): string {
  if (quote === "") {
    return highlight.kind === "free" ? IMAGE_REGION_LABEL : NO_TEXT_LABEL;
  }
  return truncateQuote(quote, LABEL_MAX_CHARS);
}

function countLabel(count: number): string {
  return `${count} highlight${count === 1 ? "" : "s"}`;
}

function noteCountLabel(count: number): string {
  return `${count} note${count === 1 ? "" : "s"}`;
}

function toNode(highlight: SidecarHighlight, color: string): HighlightNode {
  const quote = normalizeQuote(highlight.text);
  const note = highlight.note.trim();
  return {
    kind: "highlight",
    id: highlight.id,
    label: highlightLabel(highlight),
    description: formatCitation(highlight.page, highlight.pageLabel, true),
    tooltip:
      note === "" ? quote || highlightLabel(highlight) : `${quote || highlightLabel(highlight)}\n\n${note}`,
    color,
    page: highlight.page,
    categoryId: highlight.categoryId,
  };
}

function toPageNoteNode(pageNote: PageNote): PageNoteNode {
  return {
    kind: "pageNote",
    id: String(pageNote.page),
    page: pageNote.page,
    label: truncateQuote(normalizeQuote(pageNote.note), LABEL_MAX_CHARS),
    description: PAGE_NOTE_DESCRIPTION,
    tooltip: pageNote.note,
  };
}

function toDocumentNoteNode(documentNote: DocumentNote): DocumentNoteNode {
  const note = documentNote.note.trim();
  return {
    kind: "documentNote",
    id: documentNote.id,
    label: documentNote.title,
    description: truncateQuote(normalizeQuote(documentNote.note), LABEL_MAX_CHARS),
    tooltip: note === "" ? documentNote.title : `${documentNote.title}\n\n${note}`,
  };
}

function documentNotesGroup(model: Sidecar): GroupNode | undefined {
  const notes = model.documentNotes ?? [];
  if (notes.length === 0) {
    return undefined;
  }
  return {
    kind: "documentNotes",
    id: "documentNotes",
    label: DOCUMENT_NOTES_LABEL,
    description: noteCountLabel(notes.length),
    color: null,
    children: sortDocumentNotes(notes).map(toDocumentNoteNode),
  };
}

export function buildTree(model: Sidecar, groupBy: GroupBy): GroupNode[] {
  const categories = sortedCategories(model.categories);
  const colorOf = new Map(categories.map((category) => [category.id, category.color]));
  const highlights = sortHighlights(model.highlights);
  const color = (highlight: SidecarHighlight) =>
    colorOf.get(highlight.categoryId) ?? UNCATEGORIZED_CATEGORY.color;
  const groups: GroupNode[] = [];
  const documentNotes = documentNotesGroup(model);
  if (documentNotes) {
    groups.push(documentNotes);
  }

  if (groupBy === "category") {
    for (const category of categories) {
      const own = highlights.filter((highlight) => highlight.categoryId === category.id);
      if (own.length === 0) {
        continue;
      }
      groups.push({
        kind: "category",
        id: category.id,
        label: category.name,
        description: countLabel(own.length),
        color: category.color,
        children: own.map((highlight) => toNode(highlight, category.color)),
      });
    }
    const orphans = highlights.filter((highlight) => !colorOf.has(highlight.categoryId));
    if (orphans.length > 0) {
      groups.push({
        kind: "category",
        id: UNCATEGORIZED_CATEGORY.id,
        label: UNCATEGORIZED_CATEGORY.name,
        description: countLabel(orphans.length),
        color: UNCATEGORIZED_CATEGORY.color,
        children: orphans.map((highlight) => toNode(highlight, UNCATEGORIZED_CATEGORY.color)),
      });
    }
    return groups;
  }

  const noteOf = new Map((model.pageNotes ?? []).map((pageNote) => [pageNote.page, pageNote]));
  const pages = [...new Set([...highlights.map((highlight) => highlight.page), ...noteOf.keys()])].sort(
    (left, right) => left - right,
  );
  for (const page of pages) {
    const own = highlights.filter((highlight) => highlight.page === page);
    const label = formatCitation(page, own[0]?.pageLabel, true).replace(/^p\. /, "Page ");
    const pageNote = noteOf.get(page);
    const children: LeafNode[] = pageNote ? [toPageNoteNode(pageNote)] : [];
    children.push(...own.map((highlight) => toNode(highlight, color(highlight))));
    groups.push({
      kind: "page",
      id: String(page),
      label,
      description: own.length > 0 ? countLabel(own.length) : noteCountLabel(1),
      color: null,
      children,
    });
  }
  return groups;
}
