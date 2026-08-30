// Writes highlights into a PDF as real /Highlight annotations (pdf-lib), and reads them back.
// Pure module: no `vscode`, no DOM, no Node. Used by the dual-write sync (ADR-0002) and by the
// "Export annotated PDF" command; PDF.js loads what this writes as editable highlight editors.
//
// Identity: our highlight UUID is stored in /NM for other readers, but PDF.js does not surface
// /NM; it identifies annotations by object reference (`12R`), which pdf-lib knows at write time
// (`written[].pdfjsId`) and which a full save keeps stable. Every annotation we own also carries a
// /PdfCaseReview true marker so a re-sync can strip and rewrite ours without touching annotations
// made in other tools.

import {
  EncryptedPDFError,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";

export const MARKER_KEY = "PdfCaseReview";
const POPUP_WIDTH = 180;
const POPUP_HEIGHT = 120;

export interface EmbeddableHighlight {
  id: string;
  /** 1-based page number. */
  page: number;
  rect: readonly [number, number, number, number];
  /** PDF user-space quads, 8 numbers each. */
  quadPoints: readonly number[];
  /** `#RRGGBB`. */
  color: string;
  opacity?: number;
  note: string;
  categoryName: string;
  updatedAt: string;
}

export interface EmbeddedHighlight {
  id: string;
  page: number;
  rect: number[];
  quadPoints: number[];
  color: string;
  note: string;
  categoryName: string;
  /** The id PDF.js will give this annotation when it loads the file (`<objectNumber>R`). */
  pdfjsId: string;
}

export interface EmbedResult {
  bytes: Uint8Array;
  written: { id: string; pdfjsId: string }[];
}

/** The PDF is encrypted or permission-restricted; we never modify those (ADR-0002). */
export class ProtectedPdfError extends Error {
  override readonly name = "ProtectedPdfError";
}

export function pdfjsIdForRef(ref: PDFRef): string {
  return ref.generationNumber === 0 ? `${ref.objectNumber}R` : `${ref.objectNumber}R${ref.generationNumber}`;
}

function hexToRgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.replace("#", ""), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function rgbToHex(components: number[]): string {
  return `#${components
    .slice(0, 3)
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

// pdf-lib ships an ES5 build, so `instanceof EncryptedPDFError` is false at runtime; match on
// the message as well.
function isEncryptedError(error: unknown): boolean {
  return (
    error instanceof EncryptedPDFError || (error instanceof Error && /is encrypted/i.test(error.message))
  );
}

async function loadOrThrow(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (isEncryptedError(error)) {
      throw new ProtectedPdfError("The PDF is encrypted; highlights stay in the sidecar only.");
    }
    throw error;
  }
}

function pageAnnots(doc: PDFDocument, pageIndex: number): PDFArray {
  const page = doc.getPage(pageIndex);
  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) {
    return existing;
  }
  const created = doc.context.obj([]);
  page.node.set(PDFName.of("Annots"), created);
  return created;
}

function isOurs(doc: PDFDocument, ref: PDFRef): PDFDict | undefined {
  const dict = doc.context.lookupMaybe(ref, PDFDict);
  return dict?.get(PDFName.of(MARKER_KEY)) === PDFBool.True ? dict : undefined;
}

function stripOurAnnotations(doc: PDFDocument): void {
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex += 1) {
    const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      continue;
    }
    const keep: PDFRef[] = [];
    const remove: PDFRef[] = [];
    for (const entry of annots.asArray()) {
      if (!(entry instanceof PDFRef)) {
        continue;
      }
      const dict = isOurs(doc, entry);
      if (!dict) {
        keep.push(entry);
        continue;
      }
      remove.push(entry);
      const popup = dict.get(PDFName.of("Popup"));
      if (popup instanceof PDFRef) {
        remove.push(popup);
      }
    }
    if (remove.length === 0) {
      continue;
    }
    const removeSet = new Set(remove.map((ref) => ref.toString()));
    const kept = keep.filter((ref) => !removeSet.has(ref.toString()));
    doc.getPage(pageIndex).node.set(PDFName.of("Annots"), doc.context.obj(kept));
    for (const ref of remove) {
      doc.context.delete(ref);
    }
  }
}

function textString(value: string): PDFHexString {
  return PDFHexString.fromText(value);
}

/**
 * Returns a copy of `bytes` with every PdfCaseReview annotation replaced by `highlights`.
 * Throws `ProtectedPdfError` for encrypted input; never strips protection.
 */
export async function embedHighlights(
  bytes: Uint8Array,
  highlights: readonly EmbeddableHighlight[],
  options: { author?: string } = {},
): Promise<EmbedResult> {
  const doc = await loadOrThrow(bytes);
  stripOurAnnotations(doc);
  const author = options.author ?? "PDF Case Review";
  const written: EmbedResult["written"] = [];

  for (const highlight of highlights) {
    if (highlight.page < 1 || highlight.page > doc.getPageCount()) {
      continue;
    }
    const page = doc.getPage(highlight.page - 1);
    const [x1, y1, x2, y2] = highlight.rect;
    const annotation = doc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [x1, y1, x2, y2],
      QuadPoints: [...highlight.quadPoints],
      C: hexToRgb(highlight.color),
      CA: highlight.opacity ?? 1,
      F: 4,
      P: page.ref,
      NM: PDFString.of(highlight.id),
      Contents: textString(highlight.note),
      T: textString(author),
      Subj: textString(highlight.categoryName),
      M: PDFString.fromDate(new Date(highlight.updatedAt)),
      [MARKER_KEY]: true,
    });
    const annotationRef = doc.context.register(annotation);
    const popup = doc.context.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [x2, y2, x2 + POPUP_WIDTH, y2 + POPUP_HEIGHT],
      Parent: annotationRef,
      Open: false,
      F: 28,
      [MARKER_KEY]: true,
    });
    const popupRef = doc.context.register(popup);
    annotation.set(PDFName.of("Popup"), popupRef);
    const annots = pageAnnots(doc, highlight.page - 1);
    annots.push(annotationRef);
    annots.push(popupRef);
    written.push({ id: highlight.id, pdfjsId: pdfjsIdForRef(annotationRef) });
  }

  const saved = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes: saved, written };
}

/** Lists the PdfCaseReview highlight annotations present in `bytes` (Popups excluded). */
export async function readEmbeddedHighlights(bytes: Uint8Array): Promise<EmbeddedHighlight[]> {
  const doc = await loadOrThrow(bytes);
  const result: EmbeddedHighlight[] = [];
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex += 1) {
    const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      continue;
    }
    for (const entry of annots.asArray()) {
      if (!(entry instanceof PDFRef)) {
        continue;
      }
      const dict = isOurs(doc, entry);
      if (!dict || dict.get(PDFName.of("Subtype")) !== PDFName.of("Highlight")) {
        continue;
      }
      const numbers = (key: string) =>
        (dict.lookupMaybe(PDFName.of(key), PDFArray)?.asArray() ?? [])
          .filter((item): item is PDFNumber => item instanceof PDFNumber)
          .map((item) => item.asNumber());
      const text = (key: string) => {
        const value = dict.get(PDFName.of(key));
        return value instanceof PDFHexString || value instanceof PDFString ? value.decodeText() : "";
      };
      result.push({
        id: text("NM"),
        page: pageIndex + 1,
        rect: numbers("Rect"),
        quadPoints: numbers("QuadPoints"),
        color: rgbToHex(numbers("C")),
        note: text("Contents"),
        categoryName: text("Subj"),
        pdfjsId: pdfjsIdForRef(entry),
      });
    }
  }
  return result;
}

/** True when pdf-lib refuses the file for encryption (the sidecar-only path). */
export async function isProtectedPdf(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return false;
  } catch (error) {
    return isEncryptedError(error);
  }
}
