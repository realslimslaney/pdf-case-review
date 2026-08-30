// The one place that reads `pdfCaseReview.*` settings, validating at the boundary.

import { ConfigurationTarget, type LogOutputChannel, type Uri, window, workspace } from "vscode";

import {
  type Category,
  DEFAULT_CATEGORIES,
  normalizeCategories,
  validateCategories,
} from "../core/categories";

import type { GroupBy } from "../core/tree";

export type SidecarLocation = "beside" | "folder";

export function highlightsGroupBy(): GroupBy {
  const value = workspace.getConfiguration("pdfCaseReview.highlights").get<string>("groupBy", "category");
  return value === "page" ? "page" : "category";
}

export async function setHighlightsGroupBy(groupBy: GroupBy): Promise<void> {
  await workspace
    .getConfiguration("pdfCaseReview.highlights")
    .update("groupBy", groupBy, ConfigurationTarget.Global);
}

export function sidecarLocation(uri: Uri): SidecarLocation {
  const value = workspace.getConfiguration("pdfCaseReview.sidecar", uri).get<string>("location", "beside");
  return value === "folder" ? "folder" : "beside";
}

/** `pdfCaseReview.pdf.embedOnSave`: rewrite unencrypted PDFs with real annotations on save. */
export function embedOnSave(uri: Uri): boolean {
  return workspace.getConfiguration("pdfCaseReview.pdf", uri).get<boolean>("embedOnSave", true);
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
