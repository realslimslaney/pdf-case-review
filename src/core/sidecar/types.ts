// The sidecar file model (`<file>.pdf.review.json`), mirroring schemas/review.schema.json.
// Pure module: no `vscode`, no DOM, no Node.

import { type Category, normalizeCategories } from "../categories";

export const SIDECAR_VERSION = 1;
export const SIDECAR_SCHEMA_URL =
  "https://raw.githubusercontent.com/realslimslaney/pdf-case-review/main/schemas/review.schema.json";
export const SIDECAR_SUFFIX = ".review.json";

/** What happened to the PDF on the last save (ADR-0002). */
export type PdfWriteStatus = "synced" | "skipped-protected" | "skipped-setting" | "failed";

export interface SidecarSource {
  fileName: string;
  /** SHA-256 (lowercase hex) of the PDF bytes the sidecar was last saved against. */
  sha256: string;
  byteLength: number;
  pageCount: number;
  title?: string;
  encrypted?: boolean;
  lastEmbeddedAt?: string;
  pdfWrite?: PdfWriteStatus;
}

export interface SidecarCategory extends Category {
  order: number;
}

/** Display order of a document's palette: `order`, then id for stability. */
export function sortedCategories(categories: readonly SidecarCategory[]): SidecarCategory[] {
  return [...categories].sort(
    (left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** PDF user-space `[x1, y1, x2, y2]`. */
export type Rect = [number, number, number, number];

export function toRect(values: readonly number[]): Rect | undefined {
  const [x1, y1, x2, y2] = values;
  if (values.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }
  return [x1, y1, x2, y2];
}

export type HighlightKind = "text" | "free";

export interface HighlightContext {
  before?: string;
  after?: string;
}

export interface SidecarHighlight {
  /** UUID assigned by the host when the highlight first appears; also written to the PDF as `/NM`. */
  id: string;
  categoryId: string;
  /** 1-based page number. */
  page: number;
  pageLabel?: string;
  /** The id PDF.js gives the embedded annotation (`<objectNumber>R`); refreshed on every sync. */
  pdfjsId?: string;
  rect: Rect;
  /** Groups of 8 numbers; empty for a `free` highlight drawn over an image. */
  quadPoints: number[];
  /** PDF.js `serialize()` outlines, kept verbatim so the highlight can be re-created in the viewer. */
  outlines?: unknown;
  rotation?: number;
  kind: HighlightKind;
  text: string;
  context?: HighlightContext;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageNote {
  page: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentNote {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiConsent {
  accountId?: string;
  provider: string;
  email: string;
  organization?: string;
  verified: boolean;
  documentSha256: string;
  authorizationLine?: string;
  attestedAt: string;
  responsibilityAcknowledged: boolean;
  /** The user's explicit yes to "may this document be fed into AI context on this account?". */
  eligibilityConfirmed?: boolean;
  wordingVersion?: number;
}

export interface AiSummary {
  provider: string;
  model?: string;
  account?: string;
  generatedAt: string;
  text: string;
}

export interface Sidecar {
  $schema?: string;
  version: typeof SIDECAR_VERSION;
  generator?: string;
  source: SidecarSource;
  categories: SidecarCategory[];
  highlights: SidecarHighlight[];
  pageNotes?: PageNote[];
  documentNotes?: DocumentNote[];
  aiConsent?: AiConsent;
  aiSummary?: AiSummary;
}

/** Notes with content: non-empty highlight and page notes, plus every document note. */
export function countNotes(sidecar: Sidecar): number {
  return (
    sidecar.highlights.filter((highlight) => highlight.note.trim() !== "").length +
    (sidecar.pageNotes ?? []).filter((pageNote) => pageNote.note.trim() !== "").length +
    (sidecar.documentNotes?.length ?? 0)
  );
}

/** Copies categories into the self-describing sidecar shape, numbering them in the given order. */
export function toSidecarCategories(categories: readonly Category[]): SidecarCategory[] {
  return normalizeCategories(categories).map((category, order) => ({ ...category, order }));
}

export function emptySidecar(
  source: SidecarSource,
  categories: readonly Category[],
  generator?: string,
): Sidecar {
  const sidecar: Sidecar = {
    $schema: SIDECAR_SCHEMA_URL,
    version: SIDECAR_VERSION,
    source,
    categories: toSidecarCategories(categories),
    highlights: [],
  };
  if (generator !== undefined) {
    sidecar.generator = generator;
  }
  return sidecar;
}
