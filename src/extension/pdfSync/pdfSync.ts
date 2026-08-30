// The dual-write sync (ADR-0002) and the only code that writes a user's PDF. On save the sidecar
// is written first; the PDF is rewritten in memory with pdf-lib and written atomically only when
// it is unencrypted and `pdfCaseReview.pdf.embedOnSave` is on. Protected PDFs are never touched.

import { type LogOutputChannel, type Uri, workspace } from "vscode";

import {
  type EmbeddedHighlight,
  embedHighlights,
  ProtectedPdfError,
  readEmbeddedHighlights,
} from "../../core/pdfExport/embedHighlights";
import {
  applyEmbedOutcome,
  type EmbedOutcome,
  markPdfWriteFailed,
  staleIdPairs,
  toEmbeddable,
} from "../../core/pdfExport/syncPlan";
import { baseName, hashBytes, type PdfDocument, sourceFor } from "../editor/pdfDocument";
import { sidecarLocation } from "../settings";
import { sidecarUriFor } from "../sidecar/sidecarLocation";
import { writeSidecar } from "../sidecar/sidecarStore";
import { writeBytes } from "../util/writeBytes";

/** PDFs above this size are not parsed with pdf-lib on open; the stored `pdfjsId`s are trusted. */
export const INSPECT_LIMIT_BYTES = 50 * 1024 * 1024;

export interface SyncContext {
  output: LogOutputChannel;
  generator: string;
  embedOnSave: boolean;
  /** Called (at most once per save) when the PDF turns out to be protected. */
  onProtected: (document: PdfDocument) => void;
}

export interface PdfInspection {
  protected: boolean;
  /** Our annotations found in the file; null when the file was not inspected. */
  embedded: EmbeddedHighlight[] | null;
}

/** Looks inside a PDF once, on open: is it protected, and which of our annotations does it hold? */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.byteLength > INSPECT_LIMIT_BYTES) {
    return { protected: false, embedded: null };
  }
  try {
    return { protected: false, embedded: await readEmbeddedHighlights(bytes) };
  } catch (error) {
    if (error instanceof ProtectedPdfError) {
      return { protected: true, embedded: null };
    }
    throw error;
  }
}

const SKIPPED_PROTECTED: EmbedOutcome = { status: "skipped-protected", bytes: null, written: [] };

async function embedStep(
  document: PdfDocument,
  bytes: Uint8Array,
  context: SyncContext,
): Promise<EmbedOutcome> {
  if (!context.embedOnSave) {
    return { status: "skipped-setting", bytes: null, written: [] };
  }
  if (document.protected) {
    context.onProtected(document);
    return SKIPPED_PROTECTED;
  }
  const { model } = document;
  if (model.highlights.length === 0 && model.source.lastEmbeddedAt === undefined) {
    // Nothing to write and nothing of ours to strip: leave the file byte-identical.
    return { status: "synced", bytes: null, written: [] };
  }
  try {
    const result = await embedHighlights(bytes, toEmbeddable(model));
    return { status: "synced", bytes: result.bytes, written: result.written };
  } catch (error) {
    if (error instanceof ProtectedPdfError) {
      document.protected = true;
      context.onProtected(document);
      return SKIPPED_PROTECTED;
    }
    throw error;
  }
}

/**
 * Saves the document: sidecar first, then the PDF. The document's hash is set to the new bytes
 * before the PDF write so the file watcher recognizes the self-write and does not reload the
 * viewer. If the PDF write fails, the sidecar is rewritten to say so and the error propagates.
 */
export async function syncOnSave(document: PdfDocument, context: SyncContext): Promise<void> {
  const bytes = await workspace.fs.readFile(document.uri);
  const outcome = await embedStep(document, bytes, context);
  const before = document.model;
  const previousInfo = document.info;
  const embedded = outcome.bytes
    ? {
        sha256: await hashBytes(outcome.bytes),
        byteLength: outcome.bytes.byteLength,
        at: new Date().toISOString(),
      }
    : null;

  document.model = applyEmbedOutcome(
    before,
    sourceFor(document.uri, document.info),
    outcome,
    embedded,
    context.generator,
  );
  document.savedSnapshot = await writeSidecar(document.sidecarUri, document.model);

  if (!outcome.bytes || !embedded) {
    context.output.info(
      `saved ${baseName(document.sidecarUri)} (${document.model.highlights.length} highlight(s)); pdf ${outcome.status}`,
    );
    return;
  }

  document.contentHash = embedded.sha256;
  document.info = { ...document.info, sha256: embedded.sha256, byteLength: embedded.byteLength };
  try {
    await writeBytes(document.uri, outcome.bytes);
  } catch (error) {
    document.contentHash = previousInfo.sha256;
    document.info = previousInfo;
    document.model = markPdfWriteFailed(document.model, before, previousInfo);
    document.savedSnapshot = await writeSidecar(document.sidecarUri, document.model);
    const detail = error instanceof Error ? error.message : String(error);
    context.output.error(`pdf write failed for ${document.uri.fsPath}: ${detail}`);
    throw new Error(
      `PDF Case Review: highlights were saved to ${baseName(document.sidecarUri)}, but the PDF could not be updated: ${detail}`,
    );
  }
  // The viewer still uses the annotation ids of the bytes it loaded; alias them until it reloads.
  for (const { oldPdfjsId, id } of staleIdPairs(before.highlights, document.model.highlights)) {
    if (document.session.uuidFor(oldPdfjsId) === undefined) {
      document.session.bind(oldPdfjsId, id, true);
    }
  }
  context.output.info(
    `saved ${baseName(document.sidecarUri)} and embedded ${outcome.written.length} highlight(s) into ${baseName(document.uri)}`,
  );
}

/** Save As: a copy of the PDF (with highlights embedded when allowed) plus a sidecar beside it. */
export async function exportCopy(
  document: PdfDocument,
  destination: Uri,
  context: SyncContext,
): Promise<Uri> {
  const bytes = await workspace.fs.readFile(document.uri);
  const outcome = await embedStep(document, bytes, context);
  const output = outcome.bytes ?? bytes;
  await writeBytes(destination, output);
  const embedded = outcome.bytes
    ? {
        sha256: await hashBytes(outcome.bytes),
        byteLength: outcome.bytes.byteLength,
        at: new Date().toISOString(),
      }
    : null;
  const info = {
    ...document.info,
    sha256: embedded?.sha256 ?? document.info.sha256,
    byteLength: output.byteLength,
  };
  const model = applyEmbedOutcome(
    document.model,
    sourceFor(destination, info),
    outcome,
    embedded,
    context.generator,
  );
  const sidecarUri = sidecarUriFor(destination, sidecarLocation(destination));
  await writeSidecar(sidecarUri, model);
  context.output.info(`exported copy: ${destination.fsPath} + ${sidecarUri.fsPath} (pdf ${outcome.status})`);
  return sidecarUri;
}
