// The save-time bookkeeping of the dual-write sync (ADR-0002), as pure functions: what to embed,
// how the model changes once the embed step has decided, how to roll back when the PDF write
// fails, and how to repair or rebuild the sidecar from the annotations found in a PDF on open.

import { type Category, categoryForColor, UNCATEGORIZED_CATEGORY } from "../categories";
import { UUID_PATTERN } from "../sidecar/ids";
import {
  type PdfWriteStatus,
  type Sidecar,
  type SidecarHighlight,
  type SidecarSource,
  toRect,
} from "../sidecar/types";
import type { EmbeddableHighlight, EmbeddedHighlight } from "./embedHighlights";

/** What the embed step decided. `bytes` is null when the PDF is left alone. */
export interface EmbedOutcome {
  status: PdfWriteStatus;
  bytes: Uint8Array | null;
  written: readonly { id: string; pdfjsId: string }[];
}

/** Facts about the bytes that were embedded, known only once they exist. */
export interface EmbeddedBytesInfo {
  sha256: string;
  byteLength: number;
  at: string;
}

/** Highlights as the PDF writer wants them. Free highlights have no quads and are not embedded. */
export function toEmbeddable(model: Sidecar): EmbeddableHighlight[] {
  const categories = new Map(model.categories.map((category) => [category.id, category]));
  return model.highlights
    .filter((highlight) => highlight.quadPoints.length > 0)
    .map((highlight) => {
      const category = categories.get(highlight.categoryId);
      return {
        id: highlight.id,
        page: highlight.page,
        rect: highlight.rect,
        quadPoints: highlight.quadPoints,
        color: category?.color ?? UNCATEGORIZED_CATEGORY.color,
        note: highlight.note,
        categoryName: category?.name ?? UNCATEGORIZED_CATEGORY.name,
        updatedAt: highlight.updatedAt,
      };
    });
}

function withoutPdfjsId(highlight: SidecarHighlight): SidecarHighlight {
  const { pdfjsId: _stale, ...rest } = highlight;
  return rest;
}

function withPdfjsId(highlight: SidecarHighlight, pdfjsId: string | undefined): SidecarHighlight {
  if (pdfjsId === undefined) {
    return highlight.pdfjsId === undefined ? highlight : withoutPdfjsId(highlight);
  }
  return highlight.pdfjsId === pdfjsId ? highlight : { ...highlight, pdfjsId };
}

/**
 * The model as it should be saved: fresh `source` facts, the embed status, refreshed `pdfjsId`s
 * when the PDF was rewritten (annotations not written this time, such as free highlights, lose
 * theirs), and the previous embed timestamp carried forward when the PDF was left alone.
 */
export function applyEmbedOutcome(
  model: Sidecar,
  source: SidecarSource,
  outcome: EmbedOutcome,
  embedded: EmbeddedBytesInfo | null,
  generator: string,
): Sidecar {
  const next: SidecarSource = { ...source, pdfWrite: outcome.status };
  if (embedded) {
    next.sha256 = embedded.sha256;
    next.byteLength = embedded.byteLength;
    next.lastEmbeddedAt = embedded.at;
  } else if (model.source.lastEmbeddedAt !== undefined) {
    next.lastEmbeddedAt = model.source.lastEmbeddedAt;
  }
  if (outcome.status === "skipped-protected") {
    next.encrypted = true;
  } else if (outcome.status !== "synced" && model.source.encrypted !== undefined) {
    next.encrypted = model.source.encrypted;
  }
  let highlights = model.highlights;
  if (outcome.bytes) {
    const pdfjsIds = new Map(outcome.written.map((entry) => [entry.id, entry.pdfjsId]));
    highlights = model.highlights.map((highlight) => withPdfjsId(highlight, pdfjsIds.get(highlight.id)));
  }
  return { ...model, generator, source: next, highlights };
}

/**
 * After the sidecar was written but the PDF write failed: the bytes on disk are still `onDisk`
 * and the annotation ids of `previous` are still the ones in the file.
 */
export function markPdfWriteFailed(
  saved: Sidecar,
  previous: Sidecar,
  onDisk: { sha256: string; byteLength: number },
): Sidecar {
  const source: SidecarSource = {
    ...saved.source,
    sha256: onDisk.sha256,
    byteLength: onDisk.byteLength,
    pdfWrite: "failed",
  };
  if (previous.source.lastEmbeddedAt !== undefined) {
    source.lastEmbeddedAt = previous.source.lastEmbeddedAt;
  } else {
    delete source.lastEmbeddedAt;
  }
  const previousIds = new Map(previous.highlights.map((highlight) => [highlight.id, highlight.pdfjsId]));
  return {
    ...saved,
    source,
    highlights: saved.highlights.map((highlight) => withPdfjsId(highlight, previousIds.get(highlight.id))),
  };
}

/** Annotation ids the current viewer load may still use after an embed changed them. */
export function staleIdPairs(
  before: readonly SidecarHighlight[],
  after: readonly SidecarHighlight[],
): { oldPdfjsId: string; id: string }[] {
  const current = new Map(after.map((highlight) => [highlight.id, highlight.pdfjsId]));
  const pairs: { oldPdfjsId: string; id: string }[] = [];
  for (const highlight of before) {
    if (highlight.pdfjsId !== undefined && current.get(highlight.id) !== highlight.pdfjsId) {
      pairs.push({ oldPdfjsId: highlight.pdfjsId, id: highlight.id });
    }
  }
  return pairs;
}

/**
 * Aligns `pdfjsId`s with what is actually in the PDF: refreshed where the file has the highlight,
 * dropped where it no longer does (someone removed the annotation in another tool; the highlight
 * becomes sidecar-only and is embedded again on the next save).
 */
export function repairPdfjsIds(
  model: Sidecar,
  embedded: readonly EmbeddedHighlight[],
): { model: Sidecar; changed: boolean } {
  const inFile = new Map(embedded.map((entry) => [entry.id, entry.pdfjsId]));
  let changed = false;
  const highlights = model.highlights.map((highlight) => {
    const next = withPdfjsId(highlight, inFile.get(highlight.id));
    changed ||= next !== highlight;
    return next;
  });
  return changed ? { model: { ...model, highlights }, changed } : { model, changed };
}

/**
 * Rebuilds highlights from the annotations we wrote into a PDF whose sidecar has gone missing.
 * Category comes from the color, then the recorded category name; text is unknown until the
 * viewer captures it again.
 */
export function adoptEmbedded(
  embedded: readonly EmbeddedHighlight[],
  categories: readonly Category[],
  now: string,
  newId: () => string,
): SidecarHighlight[] {
  const highlights: SidecarHighlight[] = [];
  for (const entry of embedded) {
    const rect = toRect(entry.rect);
    if (!rect || entry.quadPoints.length === 0 || entry.quadPoints.length % 8 !== 0) {
      continue;
    }
    const category =
      categoryForColor(categories, entry.color) ??
      categories.find((candidate) => candidate.name === entry.categoryName);
    highlights.push({
      id: UUID_PATTERN.test(entry.id) ? entry.id : newId(),
      categoryId: category?.id ?? UNCATEGORIZED_CATEGORY.id,
      page: entry.page,
      pdfjsId: entry.pdfjsId,
      rect,
      quadPoints: [...entry.quadPoints],
      kind: "text",
      text: "",
      note: entry.note,
      createdAt: now,
      updatedAt: now,
    });
  }
  return highlights;
}
