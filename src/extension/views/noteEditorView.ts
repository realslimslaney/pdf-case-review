// The note editor view: one WebviewView mirroring one target (highlight, page or document note).
// The sidecar model in the editor provider stays the single source of truth: this class translates
// view messages into provider mutations and re-sends a load only when the model moved away from
// what the view last knew, so autosave round trips never stomp the textarea.

import {
  type CancellationToken,
  commands,
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
}

export class NoteEditorViewProvider extends Disposable implements WebviewViewProvider {
  static readonly viewType = "pdfCaseReview.noteEditor";

  private view: WebviewView | undefined;
  private target: NoteTarget | undefined;
  private documentUri: string | undefined;
  private known: { note: string; categoryId: string | null } | undefined;
  private lastLoad: NoteEditorLoad | undefined;

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
    };
  }

  /** Applies one view message against the current model; the debug seam calls this directly. */
  handleMessage(raw: unknown): void {
    if (!isNoteEditorToHostMessage(raw)) {
      return;
    }
    if (raw.type === "ready") {
      this.refresh(true);
      return;
    }
    const document = this.tracker.active;
    if (
      !document ||
      document.uri.toString() !== this.documentUri ||
      !this.target ||
      !sameNoteTarget(raw.target, this.target)
    ) {
      return;
    }
    switch (raw.type) {
      case "saveNote": {
        this.known = { note: raw.note, categoryId: this.known?.categoryId ?? null };
        if (raw.target.kind === "highlight") {
          this.editorProvider.updateHighlight(document, raw.target.id, { note: raw.note });
        } else if (raw.target.kind === "page") {
          if (raw.note.trim() === "") {
            this.known = { ...this.known, note: "" };
            this.editorProvider.removePageNote(document, raw.target.page);
          } else {
            this.editorProvider.setPageNote(document, raw.target.page, raw.note);
          }
        } else {
          this.editorProvider.updateDocumentNote(document, raw.target.id, { note: raw.note });
        }
        return;
      }
      case "setCategory": {
        if (raw.target.kind !== "highlight") {
          return;
        }
        this.known = { note: this.known?.note ?? "", categoryId: raw.categoryId };
        void commands.executeCommand("pdfCaseReview.setCategory", raw.target.id, raw.categoryId);
        return;
      }
      case "deleteTarget": {
        if (raw.target.kind === "highlight") {
          void commands.executeCommand("pdfCaseReview.deleteHighlight", raw.target.id);
        } else if (raw.target.kind === "page") {
          this.editorProvider.removePageNote(document, raw.target.page);
        } else {
          this.editorProvider.removeDocumentNote(document, raw.target.id);
        }
        this.target = undefined;
        this.refresh(true);
        return;
      }
      case "revealTarget": {
        if (raw.target.kind === "highlight") {
          void commands.executeCommand("pdfCaseReview.goToHighlight", raw.target.id);
        } else if (raw.target.kind === "page") {
          this.editorProvider.postMessage(document.uri, { type: "goTo", page: raw.target.page });
        }
        return;
      }
    }
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
    if (!force && this.known?.note === payload.note && this.known.categoryId === payload.categoryId) {
      return;
    }
    this.known = { note: payload.note, categoryId: payload.categoryId };
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
<div id="editor" hidden>
  <div id="title"></div>
  <div><span id="citation"></span></div>
  <blockquote id="quote" hidden></blockquote>
  <select id="category" hidden></select>
  <textarea id="note" placeholder="Add a note (Markdown)"></textarea>
  <div class="actions">
    <button id="reveal">Reveal</button>
    <button id="delete">Delete</button>
  </div>
</div>
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
