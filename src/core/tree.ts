// The Highlights view as data: groups (by category or by page) of highlight rows. Pure so the
// labels, ordering and buckets are unit-tested; the extension turns these into TreeItems.

import { UNCATEGORIZED_COLOR } from "./categories";
import { formatCitation, normalizeQuote, truncateQuote } from "./report/model";
import { UNCATEGORIZED_ID } from "./sidecar/reconcile";
import { sortHighlights } from "./sidecar/serialize";
import type { Sidecar, SidecarHighlight } from "./sidecar/types";

export type GroupBy = "category" | "page";

export const LABEL_MAX_CHARS = 60;
export const IMAGE_REGION_LABEL = "[image region]";
export const NO_TEXT_LABEL = "(no text captured)";

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

export interface GroupNode {
  kind: "category" | "page";
  /** Category id, or the page number as a string. */
  id: string;
  label: string;
  description: string;
  /** Category color; null for page groups. */
  color: string | null;
  children: HighlightNode[];
}

export function highlightLabel(highlight: SidecarHighlight): string {
  const quote = normalizeQuote(highlight.text);
  if (quote === "") {
    return highlight.kind === "free" ? IMAGE_REGION_LABEL : NO_TEXT_LABEL;
  }
  return truncateQuote(quote, LABEL_MAX_CHARS);
}

function countLabel(count: number): string {
  return `${count} highlight${count === 1 ? "" : "s"}`;
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

export function buildTree(model: Sidecar, groupBy: GroupBy): GroupNode[] {
  const categories = [...model.categories].sort((left, right) => left.order - right.order);
  const colorOf = new Map(categories.map((category) => [category.id, category.color]));
  const highlights = sortHighlights(model.highlights);
  const color = (highlight: SidecarHighlight) => colorOf.get(highlight.categoryId) ?? UNCATEGORIZED_COLOR;

  if (groupBy === "category") {
    const groups: GroupNode[] = [];
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
        id: UNCATEGORIZED_ID,
        label: "Uncategorized",
        description: countLabel(orphans.length),
        color: UNCATEGORIZED_COLOR,
        children: orphans.map((highlight) => toNode(highlight, UNCATEGORIZED_COLOR)),
      });
    }
    return groups;
  }

  const pages = [...new Set(highlights.map((highlight) => highlight.page))].sort(
    (left, right) => left - right,
  );
  return pages.map((page) => {
    const own = highlights.filter((highlight) => highlight.page === page);
    const label = formatCitation(page, own[0]?.pageLabel, true).replace(/^p\. /, "Page ");
    return {
      kind: "page",
      id: String(page),
      label,
      description: countLabel(own.length),
      color: null,
      children: own.map((highlight) => toNode(highlight, color(highlight))),
    };
  });
}
