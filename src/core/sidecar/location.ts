// Where a PDF's sidecar lives, as pure path arithmetic (the extension turns these into Uris).

import { SIDECAR_SUFFIX } from "./types";

/** Folder under the workspace root that collects sidecars when `sidecar.location` is `folder`. */
export const SIDECAR_FOLDER = ".pdf-case-review";

/** `case.pdf` gets `case.pdf.review.json` beside it. */
export function sidecarFileName(pdfFileName: string): string {
  return `${pdfFileName}${SIDECAR_SUFFIX}`;
}

/**
 * Workspace-relative sidecar path for the `folder` location: `.pdf-case-review/<relative path>.review.json`,
 * always with forward slashes. Spaces and non-ASCII characters pass through untouched.
 */
export function sidecarFolderPath(relativePdfPath: string): string {
  const normalized = relativePdfPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${SIDECAR_FOLDER}/${sidecarFileName(normalized)}`;
}

export function isSidecarFileName(fileName: string): boolean {
  return fileName.endsWith(SIDECAR_SUFFIX);
}
