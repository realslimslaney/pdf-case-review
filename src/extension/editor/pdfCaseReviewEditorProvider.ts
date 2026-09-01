/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by Brennen Slaney for PDF Case Review, 2026. Derived from
 * mathematic-inc/vscode-pdf src/pdf-viewer-provider.ts. Changes: reads viewer.html at
 * runtime instead of bundling it (no Node path APIs, web-host compatible); strips PDF.js's
 * own CSP meta tag at rewrite time instead of patching the vendored file; passes the
 * category palette and highlight-editor options to the viewer; typed message protocol;
 * tracks per-document viewer state for tests and the notes views; editable custom editor
 * (CustomEditorProvider) whose document is the sidecar model: save, save as, revert and
 * hot-exit backup, with highlight editors reconciled into the model on every snapshot.
 */

import {
  type CancellationToken,
  ColorThemeKind,
  type CustomDocumentBackup,
  type CustomDocumentBackupContext,
  type CustomDocumentContentChangeEvent,
  type CustomDocumentOpenContext,
  type CustomEditorProvider,
  commands,
  type Disposable,
  EventEmitter,
  type ExtensionContext,
  type LogOutputChannel,
  Uri,
  type Webview,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";

import { type Category, toHighlightEditorColors } from "../../core/categories";
import { adoptEmbedded, missingFromFile, toEmbeddable, toInjectable } from "../../core/highlight/convert";
import { repairPdfjsIds, syncModeOnOpen } from "../../core/pdfExport/syncPlan";
import { newHighlightId } from "../../core/sidecar/ids";
import { reconcileSnapshot } from "../../core/sidecar/reconcile";
import { serializeSidecar } from "../../core/sidecar/serialize";
import {
  type AiConsent,
  type AiSummary,
  type DocumentNote,
  emptySidecar,
  type Sidecar,
  type SidecarHighlight,
  sortedCategories,
  toSidecarCategories,
} from "../../core/sidecar/types";
import {
  type EmbeddedAnnotation,
  type HostToWebviewMessage,
  type InjectableHighlight,
  isWebviewToHostMessage,
  type SerializedHighlight,
  type ThemeKind,
  type ViewerConfig,
} from "../../shared/protocol";
import { buildViewerHtml } from "../../shared/viewerHtml";
import { exportCopy, inspectPdf, type PdfInspection, type SyncContext, syncOnSave } from "../pdfSync/pdfSync";
import { configuredCategories, embedOnSave, sidecarLocation } from "../settings";
import { sidecarUriFor } from "../sidecar/sidecarLocation";
import { readSidecar, type SidecarLoad, writeSidecar } from "../sidecar/sidecarStore";
import { disposeAll } from "../util/disposable";
import { WebviewCollection } from "../util/webviewCollection";
import { baseName, hashBytes, PdfDocument, type PdfInfo, parentUri, sourceFor } from "./pdfDocument";

export interface ViewerState {
  loaded: boolean;
  /** How many times the webview reported a full load; > 1 means it was rebuilt or reloaded. */
  loads: number;
  /** Highlight editors actually laid out in the page DOM at the last snapshot. */
  rendered: number;
  pagesCount: number;
  annotationEditorMode: number;
  highlightEditorColors: string | null;
  /** Highlight annotations found inside the file when it was loaded. */
  annotations: EmbeddedAnnotation[];
  editors: SerializedHighlight[];
  /** Editor ids (= annotation ids) backing unchanged pre-existing annotations. */
  existingUnchanged: string[];
  /** Result of the last `saveDocument` round-trip, if any. */
  lastSave: { byteLength: number; error: string | null; bytes: Uint8Array | null } | null;
  /** 1-based page the viewer is showing (0 until the first `pageChanged`). */
  currentPage: number;
  /** The last webview log lines, newest last (diagnostics for tests). */
  logs: string[];
}

const EMPTY_VIEWER_STATE: ViewerState = {
  loaded: false,
  loads: 0,
  rendered: 0,
  pagesCount: 0,
  annotationEditorMode: -1,
  highlightEditorColors: null,
  annotations: [],
  editors: [],
  existingUnchanged: [],
  lastSave: null,
  currentPage: 0,
  logs: [],
};

const PROTECTED_NOTICE_KEY = "pdfCaseReview.notices.protectedPdf.dismissed";

/** Lets the integration tests answer the hash-mismatch warning without a dialog. */
export type HashMismatchTestResponder = (fileName: string) => "keep" | "dismiss";
let hashMismatchTestResponder: HashMismatchTestResponder | undefined;
export function setHashMismatchTestResponder(responder?: HashMismatchTestResponder): void {
  hashMismatchTestResponder = responder;
}

function withTrailingSlash(uri: Uri): string {
  const value = uri.toString();
  return value.endsWith("/") ? value : `${value}/`;
}

function themeKindOf(kind: ColorThemeKind): ThemeKind {
  switch (kind) {
    case ColorThemeKind.HighContrast:
      return "high-contrast";
    case ColorThemeKind.HighContrastLight:
      return "high-contrast-light";
    case ColorThemeKind.Light:
      return "light";
    default:
      return "dark";
  }
}

export class PdfCaseReviewEditorProvider implements CustomEditorProvider<PdfDocument> {
  static readonly viewType = "pdfCaseReview.pdf";

  static register(context: ExtensionContext, output: LogOutputChannel) {
    const provider = new PdfCaseReviewEditorProvider(context, output);
    // Read once: webviewOptions cannot change after registration, so the setting is window-scoped
    // and takes effect after a window reload (ADR-0007).
    const retainContextWhenHidden = workspace
      .getConfiguration("pdfCaseReview.viewer")
      .get<boolean>("retainContextWhenHidden", true);
    const registration = window.registerCustomEditorProvider(PdfCaseReviewEditorProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden },
    });
    return { provider, registration };
  }

  private readonly webviews = new WebviewCollection();
  private readonly documents = new Map<string, PdfDocument>();
  private readonly states = new Map<string, ViewerState>();
  private readonly _onDidChangeCustomDocument = new EventEmitter<
    CustomDocumentContentChangeEvent<PdfDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  /** Fired when a document's model, dirty state or save status changed (the views listen). */
  private readonly _onDidChangeDocument = new EventEmitter<PdfDocument>();
  readonly onDidChangeDocument = this._onDidChangeDocument.event;
  /** Fired when a viewer panel is resolved or its active state changes (the active-document tracker listens). */
  private readonly _onDidChangeViewState = new EventEmitter<{ uri: Uri; active: boolean }>();
  readonly onDidChangeViewState = this._onDidChangeViewState.event;
  private viewerHtmlTemplate: Promise<string> | undefined;
  private readonly pageTextRequests = new Map<number, (text: string | null) => void>();
  private pageTextRequestId = 0;
  private readonly pendingRequests = new Map<number, (result: { ok: boolean; error?: string }) => void>();
  private commandRequestId = 0;
  private readonly generator: string;
  /** Recent host-side events (open, resolve, load, save, reload, dispose), newest last; for tests. */
  readonly trace: string[] = [];
  private documentCounter = 0;

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: LogOutputChannel,
  ) {
    const manifest = context.extension.packageJSON as { version?: unknown };
    this.generator = `pdf-case-review/${typeof manifest.version === "string" ? manifest.version : "0.0.0"}`;
  }

  private note(message: string): void {
    this.output.debug(message);
    this.trace.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
    if (this.trace.length > 60) {
      this.trace.splice(0, this.trace.length - 60);
    }
  }

  getViewerState(uri: Uri): ViewerState | undefined {
    return this.states.get(uri.toString());
  }

  getDocument(uri: Uri): PdfDocument | undefined {
    return this.documents.get(uri.toString());
  }

  /** One page's text from the viewer; null when no viewer is open, it times out, or has no text. */
  async getPageText(document: PdfDocument, page: number, timeoutMs = 5000): Promise<string | null> {
    this.pageTextRequestId += 1;
    const requestId = this.pageTextRequestId;
    const promise = new Promise<string | null>((resolve) => {
      this.pageTextRequests.set(requestId, resolve);
      setTimeout(() => {
        if (this.pageTextRequests.delete(requestId)) {
          resolve(null);
        }
      }, timeoutMs);
    });
    if (this.postMessage(document.uri, { type: "getPageText", requestId, page }) === 0) {
      this.pageTextRequests.delete(requestId);
      return null;
    }
    return promise;
  }

  /** Posts a message to every webview showing `uri`; returns how many received it. */
  postMessage(uri: Uri, message: HostToWebviewMessage): number {
    let count = 0;
    for (const panel of this.webviews.get(uri)) {
      void panel.webview.postMessage(message);
      count += 1;
    }
    return count;
  }

  /**
   * Posts a command with a `requestId` and resolves once the viewer acknowledged it with `done`,
   * so callers can surface failures and tests can await completion instead of sleeping.
   */
  async request(
    uri: Uri,
    message: HostToWebviewMessage,
    timeoutMs = 15_000,
  ): Promise<{ delivered: number; ok: boolean; error?: string }> {
    this.commandRequestId += 1;
    const requestId = this.commandRequestId;
    const ack = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      this.pendingRequests.set(requestId, resolve);
      setTimeout(() => {
        if (this.pendingRequests.delete(requestId)) {
          resolve({ ok: false, error: `${message.type} was not acknowledged within ${timeoutMs} ms` });
        }
      }, timeoutMs);
    });
    const delivered = this.postMessage(uri, { ...message, requestId });
    if (delivered === 0) {
      this.pendingRequests.delete(requestId);
      return { delivered, ok: false, error: "no viewer is showing this document" };
    }
    return { delivered, ...(await ack) };
  }

  private updateState(uri: Uri, patch: Partial<ViewerState>): ViewerState {
    const key = uri.toString();
    const next = { ...(this.states.get(key) ?? EMPTY_VIEWER_STATE), ...patch };
    this.states.set(key, next);
    return next;
  }

  async openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext): Promise<PdfDocument> {
    const sidecarUri = sidecarUriFor(uri, sidecarLocation(uri));
    const [{ bytes, info }, onDisk, backup] = await Promise.all([
      (async () => {
        const pdfBytes = await workspace.fs.readFile(uri);
        const pdfInfo: PdfInfo = {
          sha256: await hashBytes(pdfBytes),
          byteLength: pdfBytes.byteLength,
          pageCount: 0,
          title: null,
        };
        return { bytes: pdfBytes, info: pdfInfo };
      })(),
      this.loadSidecar(sidecarUri),
      openContext.backupId ? this.loadSidecar(Uri.parse(openContext.backupId)) : undefined,
    ]);
    const fresh = () =>
      emptySidecar(sourceFor(uri, info), configuredCategories(uri, this.output), this.generator);

    let model: Sidecar;
    let snapshot: string;
    let mismatch = false;
    switch (onDisk.kind) {
      case "loaded":
        model = onDisk.model;
        snapshot = onDisk.snapshot;
        if (model.source.sha256 !== info.sha256) {
          this.output.warn(`pdf changed since the sidecar was saved: ${uri.fsPath}`);
          mismatch = model.highlights.length > 0;
        }
        break;
      case "missing":
      case "invalid":
        model = fresh();
        snapshot = serializeSidecar(model);
        break;
    }
    if (backup?.kind === "loaded") {
      model = backup.model;
      this.output.info(`restored unsaved highlights from backup: ${uri.fsPath}`);
    }

    // Look inside the PDF when the sidecar cannot vouch for it (missing, or written against other
    // bytes): protected files are never written, and the annotations embedded earlier refresh
    // (or rebuild) the sidecar's bookkeeping. An unchanged file is trusted as recorded.
    const unchanged = onDisk.kind === "loaded" && model.source.sha256 === info.sha256;
    const inspection: PdfInspection = unchanged
      ? { protected: model.source.encrypted === true, embedded: null }
      : await inspectPdf(bytes);
    if (inspection.error !== undefined) {
      this.output.warn(`could not inspect ${uri.fsPath} with pdf-lib: ${inspection.error}`);
    }
    if (inspection.embedded !== null) {
      const now = new Date().toISOString();
      const rebuild =
        onDisk.kind === "missing" &&
        !openContext.backupId &&
        model.highlights.length === 0 &&
        inspection.embedded.length > 0;
      if (rebuild) {
        model = {
          ...model,
          highlights: adoptEmbedded(inspection.embedded, model.categories, now, newHighlightId),
        };
        snapshot = serializeSidecar(model);
        this.output.info(
          `no sidecar for ${uri.fsPath}; rebuilt ${model.highlights.length} highlight(s) from its annotations`,
        );
      } else {
        const repaired = repairPdfjsIds(model, inspection.embedded);
        if (repaired.changed) {
          model = repaired.model;
          if (!openContext.backupId) {
            snapshot = serializeSidecar(model);
          }
          this.output.info(`refreshed annotation ids from ${uri.fsPath}`);
        }
      }
    }

    const document = new PdfDocument(uri, sidecarUri, model, snapshot, info);
    document.instance = ++this.documentCounter;
    if (unchanged && model.source.pdfWrite === "synced") {
      document.embeddedFingerprint = JSON.stringify(toEmbeddable(model));
    }
    this.note(
      `open #${document.instance} ${baseName(uri)} (sidecar ${onDisk.kind}, backup ${openContext.backupId ? "yes" : "no"})`,
    );
    document.readOnly = onDisk.kind === "invalid";
    document.syncMode = syncModeOnOpen(inspection, unchanged);
    const key = uri.toString();
    this.documents.set(key, document);
    const listeners: Disposable[] = [];
    listeners.push(document.onDidChange((changed) => void this.onPdfChanged(document, changed)));
    document.onDidDelete(() => {
      this.note(`dispose #${document.instance} ${baseName(uri)}`);
      disposeAll(listeners);
      this.states.delete(key);
      this.documents.delete(key);
    });
    if (mismatch) {
      this.warnHashMismatch(document);
    }
    if (workspace.fs.isWritableFileSystem(uri.scheme) === false) {
      this.note(`readOnlyFs #${document.instance} ${uri.scheme}`);
      void window.showInformationMessage(
        `PDF Case Review: ${baseName(uri)} is on a read-only file system ("${uri.scheme}"); you can read and highlight, but nothing can be saved here.`,
      );
    }
    return document;
  }

  /**
   * The PDF changed outside the extension since the sidecar was saved: highlight positions may no
   * longer line up. "Keep positions" accepts the current bytes (persisted with the next save);
   * dismissing changes nothing, so the warning returns on the next open. Re-anchoring is planned
   * for a later release.
   */
  private warnHashMismatch(document: PdfDocument): void {
    this.note(`hashMismatch #${document.instance} ${baseName(document.uri)}`);
    const keep = "Keep positions";
    const respond = (choice: string | undefined) => {
      if (choice !== keep) {
        return;
      }
      document.model = {
        ...document.model,
        source: {
          ...document.model.source,
          sha256: document.info.sha256,
          byteLength: document.info.byteLength,
        },
      };
      this.note(`keepPositions #${document.instance} ${baseName(document.uri)}`);
      this.markEdited(document);
    };
    if (hashMismatchTestResponder) {
      respond(hashMismatchTestResponder(baseName(document.uri)) === "keep" ? keep : undefined);
      return;
    }
    void window
      .showWarningMessage(
        `PDF Case Review: ${baseName(document.uri)} changed since your highlights were saved. Highlight positions may no longer line up.`,
        keep,
      )
      .then(respond);
  }

  /**
   * The workspace watcher can deliver a write that predates this document (e.g. a file written
   * just before it was opened) and may fire while another program still holds the file; only a
   * readable, real content change warrants a reload.
   */
  private async onPdfChanged(document: PdfDocument, changed: Uri): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await workspace.fs.readFile(changed);
    } catch (error) {
      this.output.warn(
        `could not read ${changed.fsPath} after a change: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const hash = await hashBytes(bytes);
    if (hash === document.contentHash || document.isRecentSelfWrite(hash)) {
      return;
    }
    document.contentHash = hash;
    document.info = { ...document.info, sha256: hash, byteLength: bytes.byteLength };
    document.embeddedFingerprint = null;
    this.output.info(`pdf changed on disk, reloading: ${changed.fsPath}`);
    this.reloadViewer(document);
  }

  private async loadSidecar(uri: Uri): Promise<SidecarLoad> {
    const load = await readSidecar(uri);
    if (load.kind === "invalid") {
      this.output.error(`sidecar ${uri.fsPath} is invalid: ${load.error.message}`);
      void window
        .showWarningMessage(
          `PDF Case Review: ${baseName(uri)} could not be read (${load.error.message}). Highlights will not be saved until it is fixed.`,
          "Open sidecar",
        )
        .then((choice) => {
          if (choice === "Open sidecar") {
            void commands.executeCommand("vscode.open", uri);
          }
        });
    } else if (load.kind === "loaded" && load.migrated) {
      this.output.info(`migrated sidecar ${uri.fsPath} to the current format`);
    }
    return load;
  }

  /** Reloads the PDF in the viewer; snapshots are ignored until the viewer reports the new load. */
  private reloadViewer(document: PdfDocument): void {
    this.note(`reload #${document.instance} ${baseName(document.uri)}`);
    this.updateState(document.uri, { loaded: false });
    this.postMessage(document.uri, { type: "reload" });
  }

  async resolveCustomEditor(document: PdfDocument, webviewPanel: WebviewPanel): Promise<void> {
    this.note(`resolve #${document.instance} ${baseName(document.uri)}`);
    this.webviews.add(document.uri, webviewPanel);
    const resourceRoot = parentUri(document.uri);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, this.context.extensionUri],
    };
    this.updateState(document.uri, {
      ...EMPTY_VIEWER_STATE,
      loads: this.getViewerState(document.uri)?.loads ?? 0,
    });
    webviewPanel.webview.html = await this.getHtmlForWebview(document, webviewPanel.webview, resourceRoot);
    const listener = webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      this.handleMessage(document, webviewPanel.webview, resourceRoot, message);
    });
    const viewState = webviewPanel.onDidChangeViewState((event) => {
      this._onDidChangeViewState.fire({ uri: document.uri, active: event.webviewPanel.active });
    });
    webviewPanel.onDidDispose(() => {
      listener.dispose();
      viewState.dispose();
    });
    this._onDidChangeViewState.fire({ uri: document.uri, active: webviewPanel.active });
  }

  private handleMessage(document: PdfDocument, webview: Webview, resourceRoot: Uri, message: unknown): void {
    if (!isWebviewToHostMessage(message)) {
      return;
    }
    const state = this.getViewerState(document.uri);
    switch (message.type) {
      case "ready":
        this.note(`ready #${document.instance} ${baseName(document.uri)}`);
        return;
      case "viewerLoaded": {
        this.note(
          `viewerLoaded #${document.instance} ${baseName(document.uri)} (${message.annotations.length} annotations)`,
        );
        document.session.reset();
        document.pageLabels = message.pageLabels;
        document.info = { ...document.info, pageCount: message.pagesCount, title: message.title };
        this.updateState(document.uri, {
          loaded: true,
          loads: (state?.loads ?? 0) + 1,
          pagesCount: message.pagesCount,
          annotationEditorMode: message.annotationEditorMode,
          highlightEditorColors: message.highlightEditorColors,
          annotations: message.annotations,
        });
        this.output.info(
          `viewer loaded: ${document.uri.fsPath} (${message.pagesCount} pages, ${message.annotations.length} embedded highlight(s), editor mode ${message.annotationEditorMode}, colors ${message.highlightEditorColors ?? "none"})`,
        );
        this.injectMissing(
          document,
          message.annotations.map((annotation) => annotation.id),
        );
        return;
      }
      case "editorsChanged": {
        const next = this.updateState(document.uri, {
          rendered: message.rendered,
          editors: message.editors,
          existingUnchanged: message.existingUnchanged,
        });
        this.output.info(
          `editors changed: ${message.editors.length} highlight(s), ${message.existingUnchanged.length} unchanged from file, ${message.rendered} drawn`,
        );
        if (next.loaded) {
          this.reconcile(document, message);
        }
        return;
      }
      case "savedDocument": {
        const bytes = message.bytes ? new Uint8Array(message.bytes) : null;
        this.updateState(document.uri, {
          lastSave: { byteLength: bytes?.byteLength ?? 0, error: message.error, bytes },
        });
        this.output.info(
          `saveDocument: ${bytes?.byteLength ?? 0} bytes${message.error ? ` (error: ${message.error})` : ""}`,
        );
        return;
      }
      case "pageChanged":
        this.updateState(document.uri, { currentPage: message.page });
        return;
      case "saveRequested":
        void commands.executeCommand("workbench.action.files.save");
        return;
      case "highlightsDeleted":
        // The viewer had no editor for these (page not rendered yet, or never drawn): the model
        // is the only place they exist, so remove them here; the PDF loses them on the next save.
        for (const id of message.failed) {
          if (this.removeHighlight(document, id)) {
            this.output.info(`removed highlight ${id} from the sidecar (not shown in the viewer)`);
          }
        }
        return;
      case "createFromSelectionResult":
        if (!message.created && !message.recolored) {
          void window.showInformationMessage(
            "PDF Case Review: select some text in the PDF (or a highlight), then press the category shortcut.",
          );
        }
        return;
      case "openLink":
        void this.openLocalLink(webview, resourceRoot, message.url);
        return;
      case "pageText":
        this.pageTextRequests.get(message.requestId)?.(message.text);
        this.pageTextRequests.delete(message.requestId);
        return;
      case "done": {
        const pending = this.pendingRequests.get(message.requestId);
        this.pendingRequests.delete(message.requestId);
        pending?.(
          message.error === undefined ? { ok: message.ok } : { ok: message.ok, error: message.error },
        );
        return;
      }
      case "log": {
        this.output[message.level](`[webview] ${message.message}`);
        const logs = [...(state?.logs ?? []), `${message.level}: ${message.message}`].slice(-30);
        this.updateState(document.uri, { logs });
        return;
      }
    }
  }

  /** Tells VS Code the document is dirty and the views that its model changed. */
  private markEdited(document: PdfDocument): void {
    this._onDidChangeCustomDocument.fire({ document });
    this._onDidChangeDocument.fire(document);
  }

  /** Applies a host-side edit (category, note) to one highlight; returns false when it is unknown. */
  updateHighlight(
    document: PdfDocument,
    id: string,
    changes: Partial<Pick<SidecarHighlight, "categoryId" | "note">>,
  ): boolean {
    const index = document.model.highlights.findIndex((highlight) => highlight.id === id);
    const current = document.model.highlights[index];
    if (!current) {
      return false;
    }
    const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
    const highlights = [...document.model.highlights];
    highlights[index] = next;
    document.model = { ...document.model, highlights };
    this.markEdited(document);
    return true;
  }

  /** Replaces the document's palette (the sidecar is self-describing); the viewer needs a rebuild to show it. */
  replaceCategories(document: PdfDocument, categories: readonly Category[]): void {
    document.model = { ...document.model, categories: toSidecarCategories(categories) };
    this.markEdited(document);
  }

  private lastThemeKind: ThemeKind = themeKindOf(window.activeColorTheme.kind);

  /**
   * High-contrast page colors are baked into the viewer when its HTML is built (PDF.js captures
   * them at construction), so a change of theme kind rebuilds every open viewer.
   */
  async handleThemeChange(): Promise<void> {
    const kind = themeKindOf(window.activeColorTheme.kind);
    if (kind === this.lastThemeKind) {
      return;
    }
    this.lastThemeKind = kind;
    for (const document of this.documents.values()) {
      await this.rebuildWebview(document);
    }
  }

  /** Re-renders the webview HTML (new palette); the viewer reloads and reports `viewerLoaded` again. */
  async rebuildWebview(document: PdfDocument): Promise<void> {
    this.note(`rebuild #${document.instance} ${baseName(document.uri)}`);
    const resourceRoot = parentUri(document.uri);
    for (const panel of this.webviews.get(document.uri)) {
      this.updateState(document.uri, { loaded: false });
      panel.webview.html = await this.getHtmlForWebview(document, panel.webview, resourceRoot);
    }
  }

  /** Removes a highlight the viewer does not hold (no editor, no annotation); otherwise use the viewer. */
  removeHighlight(document: PdfDocument, id: string): boolean {
    if (!document.model.highlights.some((highlight) => highlight.id === id)) {
      return false;
    }
    document.model = {
      ...document.model,
      highlights: document.model.highlights.filter((highlight) => highlight.id !== id),
    };
    document.session.unbind(id);
    this.markEdited(document);
    return true;
  }

  /** Creates or replaces the note on one page; an existing note keeps its creation time. */
  setPageNote(document: PdfDocument, page: number, note: string): void {
    const now = new Date().toISOString();
    const pageNotes = [...(document.model.pageNotes ?? [])];
    const index = pageNotes.findIndex((entry) => entry.page === page);
    const current = pageNotes[index];
    if (current) {
      pageNotes[index] = { ...current, note, updatedAt: now };
    } else {
      pageNotes.push({ page, note, createdAt: now, updatedAt: now });
    }
    document.model = { ...document.model, pageNotes };
    this.markEdited(document);
  }

  removePageNote(document: PdfDocument, page: number): boolean {
    const remaining = (document.model.pageNotes ?? []).filter((entry) => entry.page !== page);
    if (remaining.length === (document.model.pageNotes?.length ?? 0)) {
      return false;
    }
    const { pageNotes: _removed, ...rest } = document.model;
    document.model = remaining.length > 0 ? { ...rest, pageNotes: remaining } : rest;
    this.markEdited(document);
    return true;
  }

  addDocumentNote(document: PdfDocument, title: string, note = ""): DocumentNote {
    const now = new Date().toISOString();
    const documentNote: DocumentNote = { id: newHighlightId(), title, note, createdAt: now, updatedAt: now };
    document.model = {
      ...document.model,
      documentNotes: [...(document.model.documentNotes ?? []), documentNote],
    };
    this.markEdited(document);
    return documentNote;
  }

  updateDocumentNote(
    document: PdfDocument,
    id: string,
    changes: Partial<Pick<DocumentNote, "title" | "note">>,
  ): boolean {
    const documentNotes = [...(document.model.documentNotes ?? [])];
    const index = documentNotes.findIndex((entry) => entry.id === id);
    const current = documentNotes[index];
    if (!current) {
      return false;
    }
    documentNotes[index] = { ...current, ...changes, updatedAt: new Date().toISOString() };
    document.model = { ...document.model, documentNotes };
    this.markEdited(document);
    return true;
  }

  removeDocumentNote(document: PdfDocument, id: string): boolean {
    const remaining = (document.model.documentNotes ?? []).filter((entry) => entry.id !== id);
    if (remaining.length === (document.model.documentNotes?.length ?? 0)) {
      return false;
    }
    const { documentNotes: _removed, ...rest } = document.model;
    document.model = remaining.length > 0 ? { ...rest, documentNotes: remaining } : rest;
    this.markEdited(document);
    return true;
  }

  setAiConsent(document: PdfDocument, consent: AiConsent): void {
    document.model = { ...document.model, aiConsent: consent };
    this.markEdited(document);
  }

  clearAiConsent(document: PdfDocument): boolean {
    if (!document.model.aiConsent) {
      return false;
    }
    const { aiConsent: _removed, ...rest } = document.model;
    document.model = rest;
    this.markEdited(document);
    return true;
  }

  setAiSummary(document: PdfDocument, summary: AiSummary): void {
    document.model = { ...document.model, aiSummary: summary };
    this.markEdited(document);
  }

  /** Draws the highlights the file holds no annotation for (protected PDF, embedding off, unsaved). */
  private injectMissing(document: PdfDocument, annotationIdsInFile: readonly string[]): void {
    const injectable: InjectableHighlight[] = [];
    const undrawable: string[] = [];
    for (const highlight of missingFromFile(document.model.highlights, new Set(annotationIdsInFile))) {
      const entry = toInjectable(highlight, document.model.categories);
      if (entry) {
        injectable.push(entry);
      } else {
        undrawable.push(highlight.id);
      }
    }
    if (undrawable.length > 0) {
      // The highlight stays in the model and the report; it just cannot be drawn in the viewer.
      this.note(`undrawable #${document.instance}: ${undrawable.length} highlight(s)`);
      this.output.warn(
        `${undrawable.length} highlight(s) in ${baseName(document.sidecarUri)} have no quads or outlines and cannot be drawn: ${undrawable.join(", ")}`,
      );
    }
    if (injectable.length === 0) {
      return;
    }
    this.output.info(`drawing ${injectable.length} sidecar-only highlight(s) in the viewer`);
    this.postMessage(document.uri, { type: "loadHighlights", highlights: injectable });
  }

  /** Folds a viewer snapshot into the sidecar model and tells VS Code when that made it dirty. */
  private reconcile(
    document: PdfDocument,
    snapshot: { editors: SerializedHighlight[]; existingUnchanged: string[]; deletedAnnotationIds: string[] },
  ): void {
    const result = reconcileSnapshot(document.model.highlights, snapshot, document.session, {
      categories: document.model.categories,
      now: () => new Date().toISOString(),
      newId: newHighlightId,
      pageLabels: document.pageLabels,
    });
    if (result.ignored.length > 0) {
      this.output.debug(`ignoring ${result.ignored.length} foreign annotation editor(s)`);
    }
    if (!result.changed) {
      return;
    }
    this.note(
      `reconcile #${document.instance}: +${result.created.length} ~${result.updated.length} -${result.deleted.length} restored ${result.restored.length}`,
    );
    const wasDirty = document.isDirty;
    document.model = { ...document.model, highlights: result.highlights };
    const lastCreated = result.created.at(-1);
    if (lastCreated !== undefined) {
      document.lastCreatedHighlightId = lastCreated;
    }
    this.output.debug(
      `reconciled: +${result.created.length} ~${result.updated.length} -${result.deleted.length} restored ${result.restored.length}${result.derivedOnly ? " (bookkeeping only)" : ""}`,
    );
    if (result.derivedOnly && !wasDirty) {
      // Page labels, late text and annotation ids are facts about the file, not edits: a clean
      // document stays clean and picks them up with the next real save.
      document.savedSnapshot = document.serializedModel;
      this._onDidChangeDocument.fire(document);
      return;
    }
    this.markEdited(document);
  }

  async saveCustomDocument(document: PdfDocument, _token: CancellationToken): Promise<void> {
    if (document.readOnly) {
      throw new Error(
        `PDF Case Review: ${baseName(document.sidecarUri)} could not be read when the PDF was opened; fix or remove it, then reopen the PDF.`,
      );
    }
    this.note(`save #${document.instance} ${baseName(document.uri)}`);
    try {
      await syncOnSave(document, this.syncContext(document.uri));
    } finally {
      // The model, snapshot and pdfWrite status changed even when the PDF write failed.
      this._onDidChangeDocument.fire(document);
    }
    this.note(
      `saved #${document.instance} ${baseName(document.uri)} (${document.model.source.pdfWrite ?? "?"})`,
    );
  }

  /** Save As exports a copy: the PDF (with highlights embedded when allowed) plus a sidecar beside it. */
  async saveCustomDocumentAs(
    document: PdfDocument,
    destination: Uri,
    _token: CancellationToken,
  ): Promise<void> {
    await this.exportAnnotatedCopy(document, destination);
  }

  /**
   * Exports a copy of the PDF to `destination` (highlights embedded when allowed) plus a sidecar
   * beside it. A protected source is copied byte-identical, never decrypted, and the user is told
   * so on every export: the one-shot protected notice does not cover this path, which used to
   * write the unmodified copy silently.
   */
  async exportAnnotatedCopy(document: PdfDocument, destination: Uri): Promise<Uri> {
    if (destination.toString() === document.uri.toString()) {
      throw new Error("choose a destination different from the original PDF");
    }
    // An exported copy exists to carry the annotations; the embedOnSave setting governs the
    // source file only (keeping PDFs in git byte-identical), so exports always embed.
    const context: SyncContext = {
      ...this.syncContext(destination),
      embedOnSave: true,
      onProtected: () => {},
    };
    const sidecarUri = await exportCopy(document, destination, context);
    this.note(`export #${document.instance} ${baseName(document.uri)} -> ${baseName(destination)}`);
    if (document.protected) {
      void window.showInformationMessage(
        `PDF Case Review: ${baseName(document.uri)} is protected by its publisher, so ${baseName(destination)} is an identical copy (never decrypted). Your highlights and notes travel beside it in ${baseName(sidecarUri)}.`,
      );
    }
    return sidecarUri;
  }

  private syncContext(uri: Uri): SyncContext {
    return {
      output: this.output,
      generator: this.generator,
      embedOnSave: embedOnSave(uri),
      onProtected: (document) => this.notifyProtected(document),
      onEmbedFailed: (document, detail) => {
        this.output.error(`could not embed highlights into ${document.uri.fsPath}: ${detail}`);
        void window.showWarningMessage(
          `PDF Case Review: highlights were saved to ${baseName(document.sidecarUri)}, but ${baseName(document.uri)} could not be rewritten (${detail}).`,
        );
      },
    };
  }

  /** One notice per document, and none at all once the user has dismissed it for good. */
  private notifyProtected(document: PdfDocument): void {
    if (document.protectedNoticeShown) {
      return;
    }
    document.protectedNoticeShown = true;
    if (this.context.globalState.get<boolean>(PROTECTED_NOTICE_KEY) === true) {
      return;
    }
    const dismiss = "Don't show again";
    void window
      .showInformationMessage(
        `PDF Case Review: ${baseName(document.uri)} is protected by its publisher and is left untouched. Highlights and notes are stored beside it in ${baseName(document.sidecarUri)}.`,
        dismiss,
      )
      .then((choice) => {
        if (choice === dismiss) {
          void this.context.globalState.update(PROTECTED_NOTICE_KEY, true);
        }
      });
  }

  async revertCustomDocument(document: PdfDocument, _token: CancellationToken): Promise<void> {
    const onDisk = await this.loadSidecar(document.sidecarUri);
    document.readOnly = onDisk.kind === "invalid";
    if (onDisk.kind === "invalid") {
      // Nothing usable to revert to; the in-memory model stays (and stays unsaved) until fixed.
      this._onDidChangeDocument.fire(document);
      return;
    }
    document.model =
      onDisk.kind === "loaded"
        ? onDisk.model
        : emptySidecar(
            sourceFor(document.uri, document.info),
            configuredCategories(document.uri, this.output),
            this.generator,
          );
    document.savedSnapshot = serializeSidecar(document.model);
    this.reloadViewer(document);
    this._onDidChangeDocument.fire(document);
  }

  async backupCustomDocument(
    document: PdfDocument,
    context: CustomDocumentBackupContext,
    _token: CancellationToken,
  ): Promise<CustomDocumentBackup> {
    await writeSidecar(context.destination, document.model);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await workspace.fs.delete(context.destination);
        } catch {
          // Already gone.
        }
      },
    };
  }

  /** Opens a link that points inside the PDF's own folder with VS Code; ignores everything else. */
  private async openLocalLink(webview: Webview, resourceRoot: Uri, url: string): Promise<void> {
    try {
      const resourceRootUrl = new URL(withTrailingSlash(webview.asWebviewUri(resourceRoot)));
      const targetUrl = new URL(url);
      if (
        targetUrl.origin !== resourceRootUrl.origin ||
        !targetUrl.pathname.startsWith(resourceRootUrl.pathname)
      ) {
        return;
      }
      const relativePath = decodeURIComponent(targetUrl.pathname.slice(resourceRootUrl.pathname.length));
      const fragment = decodeURIComponent(targetUrl.hash.slice(1));
      await commands.executeCommand(
        "vscode.open",
        Uri.joinPath(resourceRoot, relativePath).with({ fragment }),
      );
    } catch {
      // Malformed or non-local URL: ignore.
    }
  }

  private loadViewerHtmlTemplate(): Promise<string> {
    this.viewerHtmlTemplate ??= (async () => {
      const bytes = await workspace.fs.readFile(
        Uri.joinPath(this.context.extensionUri, "vendor", "pdfjs", "web", "viewer.html"),
      );
      return new TextDecoder().decode(bytes);
    })();
    return this.viewerHtmlTemplate;
  }

  private async getHtmlForWebview(
    document: PdfDocument,
    webview: Webview,
    resourceRoot: Uri,
  ): Promise<string> {
    const template = await this.loadViewerHtmlTemplate();
    const resolve = (...segments: string[]) =>
      webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, ...segments));
    const pdfjs = (...segments: string[]) => resolve("vendor", "pdfjs", ...segments);
    const settings = workspace.getConfiguration("pdfCaseReview.viewer", document.uri);

    const config: ViewerConfig = {
      url: `${webview.asWebviewUri(document.uri)}`,
      resourceRoot: withTrailingSlash(webview.asWebviewUri(resourceRoot)),
      defaultZoomValue: settings.get<string>("defaultZoom", "auto"),
      sidebarViewOnLoad: settings.get<number>("sidebarOnLoad", 0),
      themeKind: themeKindOf(window.activeColorTheme.kind),
      maxCanvasPixels: settings.get<number>("maxCanvasPixels", 0) || null,
      maxImageSize: settings.get<number>("maxImageSize", 0) || null,
      // The palette comes from the document's own categories: the sidecar is self-describing.
      highlightEditorColors: toHighlightEditorColors(document.model.categories),
      categories: sortedCategories(document.model.categories).map(({ id, name, color }) => ({
        id,
        name,
        color,
      })),
      sandboxBundleSrc: `${pdfjs("build", "pdf.sandbox.mjs")}`,
      cMapUrl: withTrailingSlash(pdfjs("web", "cmaps")),
      iccUrl: withTrailingSlash(pdfjs("web", "iccs")),
      standardFontDataUrl: withTrailingSlash(pdfjs("web", "standard_fonts")),
      wasmUrl: withTrailingSlash(pdfjs("web", "wasm")),
      imageResourcesPath: withTrailingSlash(pdfjs("web", "images")),
    };

    return buildViewerHtml(template, {
      config,
      cspSource: webview.cspSource,
      urls: {
        viewerCss: `${pdfjs("web", "viewer.css")}`,
        webviewCss: `${resolve("media", "webview.css")}`,
        pdfMjs: `${pdfjs("build", "pdf.mjs")}`,
        mainJs: `${resolve("dist", "webview", "main.js")}`,
        localeJson: `${pdfjs("web", "locale", "locale.json")}`,
      },
    });
  }
}
