// Commands for page and document notes: quick capture through input boxes. The note editor view
// (added later in M2) takes over rich editing.

import { commands, type Disposable, type TreeView, window } from "vscode";

import { sortDocumentNotes } from "../../core/sidecar/serialize";
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

function editTarget(context: CommandContext, target: unknown): NoteTarget | undefined {
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
  return undefined;
}

/**
 * With nothing selected, the destination is a choice, not a surprise: a note silently landing on
 * the current page confused more than it helped.
 */
async function pickFallbackTarget(
  context: CommandContext,
  document: PdfDocument,
): Promise<NoteTarget | "createDocumentNote" | undefined> {
  interface DestinationItem {
    label: string;
    description: string;
    action: NoteTarget | "createDocumentNote";
  }
  const items: DestinationItem[] = [];
  const page = context.provider.getViewerState(document.uri)?.currentPage;
  if (page !== undefined && page >= 1) {
    items.push({
      label: "Page note",
      description: `For page ${page}, the page in view.`,
      action: { kind: "page", page },
    });
  }
  const newest = sortDocumentNotes(document.model.documentNotes ?? []).at(-1);
  items.push(
    newest
      ? {
          label: "Document note",
          description: `Open "${newest.title}".`,
          action: { kind: "document", id: newest.id },
        }
      : {
          label: "Document note",
          description: "Create a note for the whole document.",
          action: "createDocumentNote",
        },
  );
  const picked = await window.showQuickPick(items, {
    placeHolder: "No highlight or note is selected. Where should this note go?",
  });
  return picked?.action;
}

export async function editNote(context: CommandContext, target?: unknown): Promise<void> {
  const document = activeDocument(context);
  if (!document) {
    return;
  }
  let resolved = editTarget(context, target);
  if (!resolved) {
    const choice = await pickFallbackTarget(context, document);
    if (choice === undefined) {
      return;
    }
    if (choice === "createDocumentNote") {
      return addDocumentNote(context);
    }
    resolved = choice;
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
