// The one place that reads `pdfCaseReview.*` settings, validating at the boundary.

import { ConfigurationTarget, type LogOutputChannel, type Uri, window, workspace } from "vscode";

import {
  CATEGORY_PRESETS,
  type Category,
  DEFAULT_CATEGORIES,
  isCategoryList,
  normalizeCategories,
  validateCategories,
  validatePresets,
} from "../core/categories";

import type { GroupBy } from "../core/tree";

export type SidecarLocation = "beside" | "folder";

export function highlightsGroupBy(): GroupBy {
  const value = workspace.getConfiguration("pdfCaseReview.highlights").get<string>("groupBy", "category");
  return value === "page" ? "page" : "category";
}

/** Writes where the setting is defined (a workspace override would otherwise win over a user write). */
export async function setHighlightsGroupBy(groupBy: GroupBy): Promise<void> {
  const configuration = workspace.getConfiguration("pdfCaseReview.highlights");
  const inspected = configuration.inspect<string>("groupBy");
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? ConfigurationTarget.Workspace
        : ConfigurationTarget.Global;
  await configuration.update("groupBy", groupBy, target);
}

export function sidecarLocation(uri: Uri): SidecarLocation {
  const value = workspace.getConfiguration("pdfCaseReview.sidecar", uri).get<string>("location", "beside");
  return value === "folder" ? "folder" : "beside";
}

/** `pdfCaseReview.pdf.embedOnSave`: rewrite unencrypted PDFs with real annotations on save. */
export function embedOnSave(uri: Uri): boolean {
  return workspace.getConfiguration("pdfCaseReview.pdf", uri).get<boolean>("embedOnSave", true);
}

/** Built-in presets plus `pdfCaseReview.categoryPresets`; invalid presets are dropped with a warning. */
export function categoryPresets(output: LogOutputChannel): Record<string, Category[]> {
  const configured = workspace.getConfiguration("pdfCaseReview").get<unknown>("categoryPresets", {});
  const { presets, errors } = validatePresets(configured);
  if (errors.length > 0) {
    const detail = errors.map((error) => `${error.preset || "(setting)"}: ${error.message}`).join("; ");
    output.warn(`pdfCaseReview.categoryPresets has invalid entries, ignoring them: ${detail}`);
    void window.showWarningMessage(`PDF Case Review: some category presets are invalid (${detail}).`);
  }
  const merged: Record<string, Category[]> = {};
  for (const [name, categories] of Object.entries(CATEGORY_PRESETS)) {
    merged[name] = [...categories];
  }
  return { ...merged, ...presets };
}

/** `pdfCaseReview.categories`, or the defaults (with a warning) when the setting is invalid. */
export function configuredCategories(uri: Uri, output: LogOutputChannel): Category[] {
  const configured = workspace
    .getConfiguration("pdfCaseReview", uri)
    .get<unknown>("categories", [...DEFAULT_CATEGORIES]);
  if (!isCategoryList(configured)) {
    output.warn("pdfCaseReview.categories is not a list of {id, name, color} objects, using defaults");
    void window.showWarningMessage(
      "PDF Case Review: category settings must be a list of {id, name, color} objects. Using defaults.",
    );
    return [...DEFAULT_CATEGORIES];
  }
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
