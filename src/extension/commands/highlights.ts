// Commands on highlights: navigate, delete, set category, copy, reveal the sidecar, regroup the view.
// Each takes the tree node it was invoked on, a highlight id, or falls back to the view's selection.

import { commands, type Disposable, env, type TreeView, window } from "vscode";

import { sortedCategories } from "../../core/sidecar/types";
import type { GroupBy, HighlightNode } from "../../core/tree";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { setHighlightsGroupBy } from "../settings";
import type { HighlightsTreeProvider, TreeNode } from "../views/highlightsTree";

export const GROUP_BY_KEY = "pdfCaseReview.groupBy";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  tree: HighlightsTreeProvider;
  treeView: TreeView<TreeNode>;
}

function targetId(target: unknown, treeView: TreeView<TreeNode>): string | undefined {
  if (typeof target === "string") {
    return target;
  }
  if (typeof target === "object" && target !== null && (target as HighlightNode).kind === "highlight") {
    return (target as HighlightNode).id;
  }
  const selected = treeView.selection.find((node) => node.kind === "highlight");
  return selected?.kind === "highlight" ? selected.id : undefined;
}

function resolve(
  context: CommandContext,
  target: unknown,
): { document: PdfDocument; id: string } | undefined {
  const document = context.tracker.active;
  const id = targetId(target, context.treeView);
  if (!document || id === undefined) {
    void window.showInformationMessage("PDF Case Review: select a highlight in the Highlights view first.");
    return undefined;
  }
  if (!document.model.highlights.some((highlight) => highlight.id === id)) {
    return undefined;
  }
  return { document, id };
}

/** The id the viewer knows this highlight by, if it has an editor or an annotation in the file. */
function viewerIdFor(document: PdfDocument, id: string): string | undefined {
  const highlight = document.model.highlights.find((entry) => entry.id === id);
  return document.session.viewerIdFor(id) ?? highlight?.pdfjsId;
}

export function goToHighlight(context: CommandContext, target: unknown): void {
  const resolved = resolve(context, target);
  if (!resolved) {
    return;
  }
  const { document, id } = resolved;
  const highlight = document.model.highlights.find((entry) => entry.id === id);
  if (!highlight) {
    return;
  }
  const message: Parameters<PdfCaseReviewEditorProvider["postMessage"]>[1] = {
    type: "goTo",
    page: highlight.page,
    rect: highlight.rect,
  };
  const viewerId = viewerIdFor(document, id);
  if (viewerId !== undefined) {
    message.viewerId = viewerId;
  }
  context.provider.postMessage(document.uri, message);
}

export function deleteHighlight(context: CommandContext, target: unknown): void {
  const resolved = resolve(context, target);
  if (!resolved) {
    return;
  }
  const { document, id } = resolved;
  const viewerId = viewerIdFor(document, id);
  // The viewer deletes what it holds (undoably) and the next snapshot removes it from the model;
  // it reports back what it could not reach, and the host removes those itself.
  const item = viewerId === undefined ? { sidecarId: id } : { sidecarId: id, viewerId };
  const delivered = context.provider.postMessage(document.uri, { type: "deleteHighlights", items: [item] });
  if (delivered === 0) {
    context.provider.removeHighlight(document, id);
  }
}

export async function setCategory(
  context: CommandContext,
  target: unknown,
  categoryId?: string,
): Promise<void> {
  const resolved = resolve(context, target);
  if (!resolved) {
    return;
  }
  const { document, id } = resolved;
  let chosen = categoryId;
  if (chosen === undefined) {
    const current = document.model.highlights.find((entry) => entry.id === id)?.categoryId;
    const picked = await window.showQuickPick(
      sortedCategories(document.model.categories).map((category) => ({
        label: category.name,
        description: category.id === current ? "current" : category.color,
        id: category.id,
      })),
      { placeHolder: "Category for this highlight" },
    );
    chosen = picked?.id;
  }
  if (chosen === undefined) {
    return;
  }
  const category = document.model.categories.find((entry) => entry.id === chosen);
  if (!category) {
    void window.showWarningMessage(`PDF Case Review: no category "${chosen}" in this document.`);
    return;
  }
  if (!context.provider.updateHighlight(document, id, { categoryId: category.id })) {
    return;
  }
  const viewerId = viewerIdFor(document, id);
  if (viewerId !== undefined) {
    context.provider.postMessage(document.uri, {
      type: "recolorHighlights",
      items: [{ viewerId, color: category.color }],
    });
  }
}

export async function copyQuote(context: CommandContext, target: unknown): Promise<void> {
  const resolved = resolve(context, target);
  if (!resolved) {
    return;
  }
  const highlight = resolved.document.model.highlights.find((entry) => entry.id === resolved.id);
  if (highlight) {
    await env.clipboard.writeText(highlight.text);
  }
}

export async function revealSidecar(context: CommandContext): Promise<void> {
  const document = context.tracker.active;
  if (!document) {
    return;
  }
  try {
    await window.showTextDocument(document.sidecarUri, { preview: true });
  } catch {
    void window.showInformationMessage(
      "PDF Case Review: the sidecar has not been written yet. Save the PDF first.",
    );
  }
}

export async function setGroupBy(context: CommandContext, groupBy: GroupBy): Promise<void> {
  await setHighlightsGroupBy(groupBy);
  await commands.executeCommand("setContext", GROUP_BY_KEY, groupBy);
  context.tree.refresh();
}

export function registerHighlightCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.goToHighlight", (target?: unknown) =>
      goToHighlight(context, target),
    ),
    commands.registerCommand("pdfCaseReview.deleteHighlight", (target?: unknown) =>
      deleteHighlight(context, target),
    ),
    commands.registerCommand("pdfCaseReview.setCategory", (target?: unknown, categoryId?: string) =>
      setCategory(context, target, categoryId),
    ),
    commands.registerCommand("pdfCaseReview.copyQuote", (target?: unknown) => copyQuote(context, target)),
    commands.registerCommand("pdfCaseReview.revealSidecar", () => revealSidecar(context)),
    commands.registerCommand("pdfCaseReview.groupByCategory", () => setGroupBy(context, "category")),
    commands.registerCommand("pdfCaseReview.groupByPage", () => setGroupBy(context, "page")),
  ];
}
