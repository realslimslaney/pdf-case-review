// Commands for page and document notes: quick capture through input boxes. The note editor view
// (added later in M2) takes over rich editing.

import { commands, type Disposable, type TreeView, window } from "vscode";

import type { DocumentNoteNode, PageNoteNode } from "../../core/tree";
import { isNoteTarget, type NoteTarget } from "../../shared/noteEditorProtocol";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import type { TreeNode } from "../views/highlightsTree";
import type { NoteEditorViewProvider } from "../views/noteEditorView";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  treeView: TreeView<TreeNode>;
  noteEditor: NoteEditorViewProvider;
}

function activeDocument(context: CommandContext): PdfDocument | undefined {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
  }
  return document;
}

export async function addPageNote(context: CommandContext, page?: number, note?: string): Promise<void> {
  const document = activeDocument(context);
  if (!document) {
    return;
  }
  // The model's pageCount is 0 until the first save; the viewer reports the live count on load.
  const pageCount = document.info.pageCount || document.model.source.pageCount;
  let target = page ?? context.provider.getViewerState(document.uri)?.currentPage;
  if (target === undefined || target < 1) {
    const range = pageCount > 0 ? ` (1 to ${pageCount})` : "";
    const entered = await window.showInputBox({
      prompt: `Page number${range}`,
      validateInput: (value) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed >= 1 && (pageCount === 0 || parsed <= pageCount)
          ? undefined
          : `Enter a page number${range}.`;
      },
    });
    if (entered === undefined) {
      return;
    }
    target = Number.parseInt(entered, 10);
  }
  if (!Number.isInteger(target) || target < 1 || (pageCount > 0 && target > pageCount)) {
    void window.showWarningMessage(`PDF Case Review: page ${target} is not in this document.`);
    return;
  }
  const existing = document.model.pageNotes?.find((entry) => entry.page === target);
  const value =
    note ??
    (await window.showInputBox({
      prompt: `Note for page ${target} (Markdown; empty removes the note)`,
      value: existing?.note ?? "",
    }));
  if (value === undefined) {
    return;
  }
  if (value.trim() === "") {
    context.provider.removePageNote(document, target);
    return;
  }
  context.provider.setPageNote(document, target, value);
}

export async function addDocumentNote(context: CommandContext, title?: string, note?: string): Promise<void> {
  const document = activeDocument(context);
  if (!document) {
    return;
  }
  const heading =
    title ??
    (await window.showInputBox({
      prompt: "Document note title (for example: Thesis)",
      validateInput: (value) => (value.trim() === "" ? "A title is required." : undefined),
    }));
  if (heading === undefined || heading.trim() === "") {
    return;
  }
  const body = note ?? (await window.showInputBox({ prompt: `Note for "${heading.trim()}" (Markdown)` }));
  if (body === undefined) {
    return;
  }
  context.provider.addDocumentNote(document, heading.trim(), body);
}

function noteTarget(
  target: unknown,
  treeView: TreeView<TreeNode>,
): PageNoteNode | DocumentNoteNode | undefined {
  if (typeof target === "object" && target !== null) {
    const kind = (target as { kind?: unknown }).kind;
    if (kind === "pageNote" || kind === "documentNote") {
      return target as PageNoteNode | DocumentNoteNode;
    }
  }
  const selected = treeView.selection.find(
    (node) => node.kind === "pageNote" || node.kind === "documentNote",
  );
  return selected?.kind === "pageNote" || selected?.kind === "documentNote" ? selected : undefined;
}

export function deleteNote(context: CommandContext, target: unknown): void {
  const document = context.tracker.active;
  if (!document) {
    return;
  }
  const node = noteTarget(target, context.treeView);
  if (!node) {
    void window.showInformationMessage("PDF Case Review: select a note in the Highlights view first.");
    return;
  }
  if (node.kind === "pageNote") {
    context.provider.removePageNote(document, node.page);
  } else {
    context.provider.removeDocumentNote(document, node.id);
  }
}

function toNoteTarget(node: TreeNode): NoteTarget | undefined {
  switch (node.kind) {
    case "highlight":
      return { kind: "highlight", id: node.id };
    case "pageNote":
      return { kind: "page", page: node.page };
    case "documentNote":
      return { kind: "document", id: node.id };
    default:
      return undefined;
  }
}

function editTarget(context: CommandContext, document: PdfDocument, target: unknown): NoteTarget | undefined {
  if (typeof target === "string") {
    return { kind: "highlight", id: target };
  }
  if (isNoteTarget(target)) {
    return target;
  }
  if (typeof target === "object" && target !== null && "kind" in target) {
    const fromNode = toNoteTarget(target as TreeNode);
    if (fromNode) {
      return fromNode;
    }
  }
  for (const selected of context.treeView.selection) {
    const fromSelection = toNoteTarget(selected);
    if (fromSelection) {
      return fromSelection;
    }
  }
  const page = context.provider.getViewerState(document.uri)?.currentPage;
  return page !== undefined && page >= 1 ? { kind: "page", page } : undefined;
}

export async function editNote(context: CommandContext, target?: unknown): Promise<void> {
  const document = activeDocument(context);
  if (!document) {
    return;
  }
  const resolved = editTarget(context, document, target);
  if (!resolved) {
    void window.showInformationMessage("PDF Case Review: select a highlight or note first.");
    return;
  }
  await commands.executeCommand("pdfCaseReview.noteEditor.focus");
  context.noteEditor.open(resolved);
}

export function registerNoteCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.addPageNote", (page?: number, note?: string) =>
      addPageNote(context, page, note),
    ),
    commands.registerCommand("pdfCaseReview.addDocumentNote", (title?: string, note?: string) =>
      addDocumentNote(context, title, note),
    ),
    commands.registerCommand("pdfCaseReview.deleteNote", (target?: unknown) => deleteNote(context, target)),
    commands.registerCommand("pdfCaseReview.editNote", (target?: unknown) => editNote(context, target)),
  ];
}
