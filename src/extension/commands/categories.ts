// Commands around categories: highlight the current selection with category N (the Ctrl+Alt+N
// keybindings), apply a preset palette to the settings, and copy the settings palette into the
// open document.

import { ConfigurationTarget, commands, type Disposable, window, workspace } from "vscode";

import { type Category, categoryAt } from "../../core/categories";
import { newHighlightId } from "../../core/sidecar/ids";
import { sortedCategories } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { categoryPresets, configuredCategories } from "../settings";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  output: Parameters<typeof configuredCategories>[1];
}

function paletteOf(document: PdfDocument): Category[] {
  return sortedCategories(document.model.categories);
}

async function pickCategory(document: PdfDocument, placeHolder: string): Promise<Category | undefined> {
  const picked = await window.showQuickPick(
    paletteOf(document).map((category, index) => ({
      label: `${index + 1}. ${category.name}`,
      description: category.color,
      category,
    })),
    { placeHolder },
  );
  return picked?.category;
}

/** `Ctrl+Alt+N`: turn the viewer's current text selection into a highlight of category N. */
export async function highlightWithCategory(
  context: CommandContext,
  args?: { index?: number } | number,
): Promise<void> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return;
  }
  const index = typeof args === "number" ? args : args?.index;
  const palette = paletteOf(document);
  let category = index === undefined ? undefined : categoryAt(palette, index);
  if (!category) {
    if (index !== undefined) {
      void window.showInformationMessage(
        `PDF Case Review: this document has ${palette.length} categories; there is no category ${index}.`,
      );
      return;
    }
    category = await pickCategory(document, "Highlight the selection as");
    if (!category) {
      return;
    }
  }
  context.provider.postMessage(document.uri, {
    type: "createFromSelection",
    id: newHighlightId(),
    color: category.color,
  });
}

/** Replaces `pdfCaseReview.categories` with a preset; new documents pick it up. */
export async function applyCategoryPreset(
  context: CommandContext,
  presetName?: string,
  target?: "global" | "workspace",
): Promise<void> {
  const presets = categoryPresets(context.output);
  const names = Object.keys(presets);
  let name = presetName;
  if (name === undefined) {
    const picked = await window.showQuickPick(
      names.map((entry) => ({
        label: entry,
        description: (presets[entry] ?? []).map((category) => category.name).join(", "),
      })),
      { placeHolder: "Category preset to apply to your settings" },
    );
    name = picked?.label;
  }
  const categories = name === undefined ? undefined : presets[name];
  if (name === undefined || !categories) {
    if (name !== undefined) {
      void window.showWarningMessage(`PDF Case Review: no category preset named "${name}".`);
    }
    return;
  }
  let configurationTarget: ConfigurationTarget;
  if (target === "workspace") {
    configurationTarget = ConfigurationTarget.Workspace;
  } else if (target === "global" || !workspace.workspaceFolders?.length) {
    configurationTarget = ConfigurationTarget.Global;
  } else {
    const picked = await window.showQuickPick(
      [
        { label: "User settings", description: "every workspace", target: ConfigurationTarget.Global },
        {
          label: "Workspace settings",
          description: "this workspace only",
          target: ConfigurationTarget.Workspace,
        },
      ],
      { placeHolder: `Where to apply the "${name}" preset` },
    );
    if (!picked) {
      return;
    }
    configurationTarget = picked.target;
  }
  await workspace.getConfiguration("pdfCaseReview").update(
    "categories",
    categories.map(({ id, name: categoryName, color }) => ({ id, name: categoryName, color })),
    configurationTarget,
  );
  void window.showInformationMessage(
    `PDF Case Review: "${name}" is now the palette for new documents. For an open PDF, run "Sync Categories from Settings".`,
  );
}

/** Copies the settings palette into the active document (its sidecar is self-describing). */
export async function syncCategoriesFromSettings(
  context: CommandContext,
  reload?: "reload" | "no-reload",
): Promise<void> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return;
  }
  const categories = configuredCategories(document.uri, context.output);
  context.provider.replaceCategories(document, categories);
  const choice =
    reload === "reload"
      ? "Save and reload"
      : reload === "no-reload"
        ? undefined
        : await window.showInformationMessage(
            "PDF Case Review: categories updated. The viewer shows the new palette after a save and reload.",
            "Save and reload",
          );
  if (choice === "Save and reload") {
    await commands.executeCommand("workbench.action.files.save");
    await context.provider.rebuildWebview(document);
  }
}

export function registerCategoryCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.highlightWithCategory", (args?: { index?: number } | number) =>
      highlightWithCategory(context, args),
    ),
    commands.registerCommand(
      "pdfCaseReview.applyCategoryPreset",
      (presetName?: string, target?: "global" | "workspace") =>
        applyCategoryPreset(context, presetName, target),
    ),
    commands.registerCommand("pdfCaseReview.syncCategoriesFromSettings", (reload?: "reload" | "no-reload") =>
      syncCategoriesFromSettings(context, reload),
    ),
  ];
}
