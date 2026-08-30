// The one place that reads `pdfCaseReview.*` settings, validating at the boundary.

import { type LogOutputChannel, type Uri, window, workspace } from "vscode";

import {
  type Category,
  DEFAULT_CATEGORIES,
  normalizeCategories,
  validateCategories,
} from "../core/categories";

export type SidecarLocation = "beside" | "folder";

export function sidecarLocation(uri: Uri): SidecarLocation {
  const value = workspace.getConfiguration("pdfCaseReview.sidecar", uri).get<string>("location", "beside");
  return value === "folder" ? "folder" : "beside";
}

/** `pdfCaseReview.categories`, or the defaults (with a warning) when the setting is invalid. */
export function configuredCategories(uri: Uri, output: LogOutputChannel): Category[] {
  const configured = workspace
    .getConfiguration("pdfCaseReview", uri)
    .get<Category[]>("categories", [...DEFAULT_CATEGORIES]);
  const errors = validateCategories(configured);
  if (errors.length > 0) {
    const detail = errors.map((error) => `#${error.index + 1}: ${error.message}`).join("; ");
    output.warn(`pdfCaseReview.categories is invalid, using defaults: ${detail}`);
    void window.showWarningMessage(
      `PDF Case Review: category settings are invalid (${detail}). Using defaults.`,
    );
    return [...DEFAULT_CATEGORIES];
  }
  return normalizeCategories(configured);
}
