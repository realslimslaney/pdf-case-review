// Every conversion between the four highlight shapes in one place, so a field added to one leg
// (outlines, opacity, rotation) cannot silently be dropped on another:
//
//   SerializedHighlight  (a PDF.js editor, from the viewer)   --createHighlight-->  SidecarHighlight
//   SidecarHighlight     (the model, persisted)               --toEmbeddable----->  EmbeddableHighlight
//   EmbeddedHighlight    (our annotation read back from a PDF) --adoptEmbedded---->  SidecarHighlight
//   SidecarHighlight     (not present in the file)            --toInjectable----->  InjectableHighlight
//
// The round trips are unit-tested in test/unit/highlight-convert.test.ts.

import type { InjectableHighlight, SerializedHighlight } from "../../shared/protocol";
import { type Category, categoryForColor, hexToRgb, UNCATEGORIZED_CATEGORY } from "../categories";
import type { EmbeddableHighlight, EmbeddedHighlight } from "../pdfExport/embedHighlights";
import { UUID_PATTERN } from "../sidecar/ids";
import { type Sidecar, type SidecarHighlight, toRect } from "../sidecar/types";
import { normalizeCapturedText } from "../text/normalize";

const ANNOTATION_EDITOR_TYPE_HIGHLIGHT = 9;

export interface CreateHighlightContext {
  categories: readonly Category[];
  /** ISO 8601 timestamp for `createdAt` / `updatedAt`. */
  now: () => string;
  /** Page labels by page index, when the document defines them. */
  pageLabels?: readonly string[] | null;
}

/** The editor's own text first, then the quad-intersection fallback, normalized either way. */
export function capturedText(editor: SerializedHighlight): string {
  return normalizeCapturedText(editor.text ?? editor.quadText ?? "");
}

/** A new sidecar highlight from a PDF.js editor the viewer reported. */
export function createHighlight(
  id: string,
  editor: SerializedHighlight,
  context: CreateHighlightContext,
): SidecarHighlight {
  const now = context.now();
  const category = categoryForColor(context.categories, editor.color);
  const highlight: SidecarHighlight = {
    id,
    categoryId: category?.id ?? UNCATEGORIZED_CATEGORY.id,
    page: editor.pageIndex + 1,
    rect: toRect(editor.rect) ?? [0, 0, 0, 0],
    quadPoints: [...editor.quadPoints],
    kind: editor.quadPoints.length > 0 ? "text" : "free",
    text: capturedText(editor),
    note: "",
    createdAt: now,
    updatedAt: now,
  };
  const pageLabel = context.pageLabels?.[editor.pageIndex];
  if (pageLabel !== undefined) {
    highlight.pageLabel = pageLabel;
  }
  if (editor.annotationElementId) {
    highlight.pdfjsId = editor.annotationElementId;
  }
  if (editor.rotation !== 0) {
    highlight.rotation = editor.rotation;
  }
  const outlines = editor.raw["outlines"];
  if (highlight.kind === "free" && outlines !== undefined) {
    highlight.outlines = outlines;
  }
  return highlight;
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

/** Highlights the viewer will not draw by itself because the file holds no annotation for them. */
export function missingFromFile(
  highlights: readonly SidecarHighlight[],
  annotationIdsInFile: ReadonlySet<string>,
): SidecarHighlight[] {
  return highlights.filter(
    (highlight) => highlight.pdfjsId === undefined || !annotationIdsInFile.has(highlight.pdfjsId),
  );
}

/**
 * A sidecar highlight in the shape PDF.js's `AnnotationEditorLayer.deserialize` accepts, so the
 * viewer can draw it. Undefined when the highlight has neither quads nor outlines (nothing to
 * draw); callers report those rather than dropping them silently.
 */
export function toInjectable(
  highlight: SidecarHighlight,
  categories: readonly Category[],
): InjectableHighlight | undefined {
  const category = categories.find((candidate) => candidate.id === highlight.categoryId);
  const base = {
    annotationType: ANNOTATION_EDITOR_TYPE_HIGHLIGHT,
    color: hexToRgb(category?.color ?? UNCATEGORIZED_CATEGORY.color),
    opacity: 1,
    rect: highlight.rect,
    rotation: highlight.rotation ?? 0,
  };
  if (highlight.quadPoints.length > 0) {
    return {
      sidecarId: highlight.id,
      pageIndex: highlight.page - 1,
      data: { ...base, quadPoints: highlight.quadPoints },
    };
  }
  if (highlight.outlines !== undefined) {
    return {
      sidecarId: highlight.id,
      pageIndex: highlight.page - 1,
      data: { ...base, outlines: highlight.outlines },
    };
  }
  return undefined;
}
