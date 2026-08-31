// The save-time bookkeeping of the dual-write sync (ADR-0002), as pure functions: how the PDF is
// treated at save time (SyncMode), how the model changes once the embed step has decided, how to
// roll back when the PDF write fails, and how to repair the sidecar's annotation ids on open.
// The highlight shape conversions live in ../highlight/convert.

import type { PdfWriteStatus, Sidecar, SidecarHighlight, SidecarSource } from "../sidecar/types";
import type { EmbeddedHighlight } from "./embedHighlights";

/**
 * How one document's PDF is treated at save time: written with our annotations (`embed`), never
 * written (`sidecar-only:protected`), left alone by the `pdf.embedOnSave` setting
 * (`sidecar-only:setting`), or not yet inspected (too large, or pdf-lib could not parse it), in
 * which case a save attempts the embed and protection is discovered then (`uninspected`).
 */
export type SyncMode = "embed" | "sidecar-only:protected" | "sidecar-only:setting" | "uninspected";

/** The document's inherent mode, decided on open from what the inspection could see. */
export function syncModeOnOpen(
  inspection: { protected: boolean; embedded: unknown },
  trustedUnchanged: boolean,
): SyncMode {
  if (inspection.protected) {
    return "sidecar-only:protected";
  }
  if (!trustedUnchanged && inspection.embedded === null) {
    return "uninspected";
  }
  return "embed";
}

/** The mode one save runs under: the `embedOnSave` setting is resolved per save, not per document. */
export function resolveSyncMode(mode: SyncMode, embedOnSave: boolean): SyncMode {
  return embedOnSave ? mode : "sidecar-only:setting";
}

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
