// The note editor view: one WebviewView mirroring one target (highlight, page or document note).
// The sidecar model in the editor provider stays the single source of truth: this class translates
// view messages into provider mutations and re-sends a load only when the model moved away from
// what the view last knew, so autosave round trips never stomp the textarea.

import {
  type CancellationToken,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  type WebviewViewResolveContext,
  window,
} from "vscode";

import { formatCitation, normalizeQuote } from "../../core/report/model";
import { sortedCategories } from "../../core/sidecar/types";
import { highlightLabel } from "../../core/tree";
import {
  type HostToNoteEditorMessage,
  isNoteEditorToHostMessage,
  type NoteEditorLoad,
  type NoteTarget,
  sameNoteTarget,
} from "../../shared/noteEditorProtocol";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { Disposable } from "../util/disposable";

/** What `pdfCaseReview.debug.getNoteEditorState` returns. */
export interface NoteEditorState {
  target: NoteTarget | null;
  resolved: boolean;
  lastLoad: NoteEditorLoad | null;
  /** How many saveNote messages were applied and acknowledged (the view's live region announces them). */
  saveAcks: number;
}

/** Lets the integration tests answer the delete confirmation without a dialog. */
export type NoteDeleteTestResponder = (target: NoteTarget) => boolean;
let noteDeleteTestResponder: NoteDeleteTestResponder | undefined;
export function setNoteDeleteTestResponder(responder?: NoteDeleteTestResponder): void {
  noteDeleteTestResponder = responder;
}

function deleteQuestion(target: NoteTarget): string {
  switch (target.kind) {
    case "highlight":
      return "Delete this highlight and its note?";
    case "page":
      return `Delete the note on page ${target.page}?`;
    case "document":
      return "Delete this document note?";
  }
}

async function confirmDelete(target: NoteTarget): Promise<boolean> {
  if (noteDeleteTestResponder) {
    return noteDeleteTestResponder(target);
  }
  const choice = await window.showWarningMessage(deleteQuestion(target), { modal: true }, "Delete");
  return choice === "Delete";
}

export class NoteEditorViewProvider extends Disposable implements WebviewViewProvider {
  static readonly viewType = "pdfCaseReview.noteEditor";

  private view: WebviewView | undefined;
  private target: NoteTarget | undefined;
  private documentUri: string | undefined;
  private known: { target: NoteTarget; note: string; categoryId: string | null } | undefined;
  private lastLoad: NoteEditorLoad | undefined;
  private saveAcks = 0;

  constructor(
    private readonly extensionUri: Uri,
    private readonly editorProvider: PdfCaseReviewEditorProvider,
    private readonly tracker: ActiveDocumentTracker,
  ) {
    super();
    this._register(tracker.onDidChange(() => this.refresh()));
  }

  resolveWebviewView(
    view: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, "media"), Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.getHtml(view.webview);
    const listener = view.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
    view.onDidDispose(() => {
      listener.dispose();
      this.view = undefined;
    });
  }

  /** Shows the view's content for `target` (the view itself is revealed by the focus command). */
  open(target: NoteTarget): void {
    const document = this.tracker.active;
    if (!document) {
      return;
    }
    this.target = target;
    this.documentUri = document.uri.toString();
    this.view?.show(true);
    this.refresh();
  }

  state(): NoteEditorState {
    return {
      target: this.target ?? null,
      resolved: this.view !== undefined,
      lastLoad: this.lastLoad ?? null,
      saveAcks: this.saveAcks,
    };
  }

  /**
   * Applies one view message at its own address; the debug seam calls this directly. Messages are
   * never dropped for arriving after the displayed target changed: a save flushed during a target
   * or document switch still lands on the note it was written for.
   */
  handleMessage(raw: unknown): void {
    if (!isNoteEditorToHostMessage(raw)) {
      return;
    }
    if (raw.type === "ready") {
      this.refresh(true);
      return;
    }
    const document = this.editorProvider.getDocument(Uri.parse(raw.documentUri));
    if (!document) {
      return;
    }
    const displayed =
      this.target !== undefined &&
      this.documentUri === raw.documentUri &&
      sameNoteTarget(raw.target, this.target);
    switch (raw.type) {
      case "saveNote": {
        if (displayed) {
          this.known = { target: raw.target, note: raw.note, categoryId: this.known?.categoryId ?? null };
        }
        if (raw.target.kind === "highlight") {
          this.editorProvider.updateHighlight(document, raw.target.id, { note: raw.note });
        } else if (raw.target.kind === "page") {
          if (raw.note.trim() === "") {
            this.editorProvider.removePageNote(document, raw.target.page);
          } else {
            this.editorProvider.setPageNote(document, raw.target.page, raw.note);
          }
        } else {
          this.editorProvider.updateDocumentNote(document, raw.target.id, { note: raw.note });
        }
        this.post({ type: "saved" });
        return;
      }
      case "setCategory": {
        if (raw.target.kind !== "highlight") {
          return;
        }
        const category = document.model.categories.find((entry) => entry.id === raw.categoryId);
        if (!category) {
          return;
        }
        if (displayed) {
          this.known = { target: raw.target, note: this.known?.note ?? "", categoryId: raw.categoryId };
        }
        if (!this.editorProvider.updateHighlight(document, raw.target.id, { categoryId: category.id })) {
          return;
        }
        const viewerId = this.viewerIdFor(document, raw.target.id);
        if (viewerId !== undefined) {
          this.editorProvider.postMessage(document.uri, {
            type: "recolorHighlights",
            items: [{ viewerId, color: category.color }],
          });
        }
        return;
      }
      case "deleteTarget": {
        void this.deleteTarget(document, raw.target, displayed);
        return;
      }
      case "revealTarget": {
        if (raw.target.kind === "highlight") {
          const targetId = raw.target.id;
          const highlight = document.model.highlights.find((entry) => entry.id === targetId);
          if (!highlight) {
            return;
          }
          const message: Parameters<PdfCaseReviewEditorProvider["postMessage"]>[1] = {
            type: "goTo",
            page: highlight.page,
            rect: highlight.rect,
          };
          const viewerId = this.viewerIdFor(document, raw.target.id);
          if (viewerId !== undefined) {
            message.viewerId = viewerId;
          }
          this.editorProvider.postMessage(document.uri, message);
        } else if (raw.target.kind === "page") {
          this.editorProvider.postMessage(document.uri, { type: "goTo", page: raw.target.page });
        }
        return;
      }
    }
  }

  /** Deleting is the one destructive gesture in this view, so it asks first. */
  private async deleteTarget(document: PdfDocument, target: NoteTarget, displayed: boolean): Promise<void> {
    if (!(await confirmDelete(target))) {
      return;
    }
    if (target.kind === "highlight") {
      const viewerId = this.viewerIdFor(document, target.id);
      const item = viewerId === undefined ? { sidecarId: target.id } : { sidecarId: target.id, viewerId };
      const delivered = this.editorProvider.postMessage(document.uri, {
        type: "deleteHighlights",
        items: [item],
      });
      if (delivered === 0) {
        this.editorProvider.removeHighlight(document, target.id);
      }
    } else if (target.kind === "page") {
      this.editorProvider.removePageNote(document, target.page);
    } else {
      this.editorProvider.removeDocumentNote(document, target.id);
    }
    if (displayed) {
      this.target = undefined;
      this.refresh(true);
    }
  }

  /** The id the viewer knows this highlight by, when it has an editor or an embedded annotation. */
  private viewerIdFor(document: PdfDocument, id: string): string | undefined {
    const highlight = document.model.highlights.find((entry) => entry.id === id);
    return document.session.viewerIdFor(id) ?? highlight?.pdfjsId;
  }

  /** Re-sends the target when the model moved away from what the view last knew. */
  private refresh(force = false): void {
    const document = this.tracker.active;
    if (!document) {
      this.target = undefined;
      this.documentUri = undefined;
      this.known = undefined;
      this.post({ type: "clear", reason: "noDocument" });
      return;
    }
    if (this.documentUri !== undefined && document.uri.toString() !== this.documentUri) {
      this.target = undefined;
      this.documentUri = undefined;
      this.known = undefined;
      this.post({ type: "clear", reason: "noTarget" });
      return;
    }
    if (!this.target) {
      this.post({ type: "clear", reason: "noTarget" });
      return;
    }
    const payload = this.loadPayload(document, this.target);
    if (!payload) {
      this.target = undefined;
      this.known = undefined;
      this.post({ type: "clear", reason: "noTarget" });
      return;
    }
    if (
      !force &&
      this.known !== undefined &&
      sameNoteTarget(this.known.target, this.target) &&
      this.known.note === payload.note &&
      this.known.categoryId === payload.categoryId
    ) {
      return;
    }
    this.known = { target: this.target, note: payload.note, categoryId: payload.categoryId };
    this.lastLoad = payload;
    this.post(payload);
  }

  private loadPayload(document: PdfDocument, target: NoteTarget): NoteEditorLoad | undefined {
    const model = document.model;
    switch (target.kind) {
      case "highlight": {
        const highlight = model.highlights.find((entry) => entry.id === target.id);
        if (!highlight) {
          return undefined;
        }
        return {
          type: "load",
          documentUri: document.uri.toString(),
          target,
          title: "Highlight",
          quote: normalizeQuote(highlight.text) || highlightLabel(highlight),
          citation: formatCitation(highlight.page, highlight.pageLabel, true),
          categories: sortedCategories(model.categories).map(({ id, name, color }) => ({ id, name, color })),
          categoryId: highlight.categoryId,
          note: highlight.note,
        };
      }
      case "page": {
        const pageCount = document.info.pageCount || model.source.pageCount;
        if (pageCount > 0 && target.page > pageCount) {
          return undefined;
        }
        const pageNote = model.pageNotes?.find((entry) => entry.page === target.page);
        return {
          type: "load",
          documentUri: document.uri.toString(),
          target,
          title: `Page ${target.page}`,
          quote: null,
          citation: formatCitation(target.page, document.pageLabels?.[target.page - 1], true),
          categories: [],
          categoryId: null,
          note: pageNote?.note ?? "",
        };
      }
      case "document": {
        const documentNote = model.documentNotes?.find((entry) => entry.id === target.id);
        if (!documentNote) {
          return undefined;
        }
        return {
          type: "load",
          documentUri: document.uri.toString(),
          target,
          title: documentNote.title,
          quote: null,
          citation: "",
          categories: [],
          categoryId: null,
          note: documentNote.note,
        };
      }
    }
  }

  private post(message: HostToNoteEditorMessage): void {
    if (message.type === "clear") {
      this.lastLoad = undefined;
    }
    if (message.type === "saved") {
      this.saveAcks += 1;
    }
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: Webview): string {
    const resolve = (...segments: string[]) =>
      webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...segments));
    const cspSource = webview.cspSource;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src ${cspSource}; img-src ${cspSource} data:; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${resolve("media", "noteEditor.css")}">
<title>Note</title>
</head>
<body>
<div id="empty" class="empty">Select a highlight or note in the Highlights view.</div>
<form id="editor" hidden>
  <h1 id="title"></h1>
  <div><span id="citation" aria-label="Page"></span></div>
  <blockquote id="quote" aria-label="Quoted passage" hidden></blockquote>
  <label class="visually-hidden" for="category">Category</label>
  <select id="category" hidden></select>
  <label class="visually-hidden" for="note">Note, in Markdown</label>
  <textarea id="note" placeholder="Add a note (Markdown)"></textarea>
  <div class="actions">
    <button id="reveal" type="button">Reveal</button>
    <button id="delete" type="button">Delete</button>
  </div>
  <div id="saveState" class="visually-hidden" role="status" aria-live="polite"></div>
</form>
<script src="${resolve("dist", "webview", "noteEditor.js")}" type="module"></script>
</body>
</html>`;
  }
}

export function warnNoTarget(): void {
  void window.showInformationMessage(
    "PDF Case Review: select a highlight or note in the Highlights view first.",
  );
}
