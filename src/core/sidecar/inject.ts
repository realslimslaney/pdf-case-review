// Turns sidecar highlights that are not in the PDF (protected file, embedding off, not saved yet)
// into the data PDF.js's `AnnotationEditorLayer.deserialize` accepts, so the viewer draws them.

import type { InjectableHighlight } from "../../shared/protocol";
import { type Category, hexToRgb, UNCATEGORIZED_CATEGORY } from "../categories";
import type { SidecarHighlight } from "./types";

const ANNOTATION_EDITOR_TYPE_HIGHLIGHT = 9;

/** Highlights the viewer will not draw by itself because the file holds no annotation for them. */
export function missingFromFile(
  highlights: readonly SidecarHighlight[],
  annotationIdsInFile: ReadonlySet<string>,
): SidecarHighlight[] {
  return highlights.filter(
    (highlight) => highlight.pdfjsId === undefined || !annotationIdsInFile.has(highlight.pdfjsId),
  );
}

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
