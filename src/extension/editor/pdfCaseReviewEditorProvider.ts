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

import { toHighlightEditorColors } from "../../core/categories";
import { adoptEmbedded, repairPdfjsIds } from "../../core/pdfExport/syncPlan";
import { newHighlightId } from "../../core/sidecar/ids";
import { missingFromFile, toInjectable } from "../../core/sidecar/inject";
import { reconcileSnapshot } from "../../core/sidecar/reconcile";
import { serializeSidecar } from "../../core/sidecar/serialize";
import { emptySidecar, type Sidecar } from "../../core/sidecar/types";
import {
  type EmbeddedAnnotation,
  type HostToWebviewMessage,
  type InjectableHighlight,
  isWebviewToHostMessage,
  type SerializedHighlight,
  type ViewerConfig,
} from "../../shared/protocol";
import { exportCopy, inspectPdf, type SyncContext, syncOnSave } from "../pdfSync/pdfSync";
import { configuredCategories, embedOnSave, sidecarLocation } from "../settings";
import { sidecarUriFor } from "../sidecar/sidecarLocation";
import { readSidecar, type SidecarLoad } from "../sidecar/sidecarStore";
import { disposeAll } from "../util/disposable";
import { escapeAttribute } from "../util/escapeAttribute";
import { WebviewCollection } from "../util/webviewCollection";
import {
  baseName,
  contentHash,
  hashBytes,
  PdfDocument,
  type PdfInfo,
  parentUri,
  sourceFor,
} from "./pdfDocument";

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

const CSP_META_REGEX = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/u;

function withTrailingSlash(uri: Uri): string {
  const value = uri.toString();
  return value.endsWith("/") ? value : `${value}/`;
}

function stripViewerTags(html: string): string {
  return html
    .replace(CSP_META_REGEX, "")
    .replace(/* html */ `<link rel="resource" type="application/l10n" href="locale/locale.json" />`, "")
    .replace(/* html */ `<script src="../build/pdf.mjs" type="module"></script>`, "")
    .replace(/* html */ `<script src="viewer.mjs" type="module"></script>`, "")
    .replace(/* html */ `<link rel="stylesheet" href="viewer.css" />`, "");
}

export class PdfCaseReviewEditorProvider implements CustomEditorProvider<PdfDocument> {
  static readonly viewType = "pdfCaseReview.pdf";

  static register(context: ExtensionContext, output: LogOutputChannel) {
    const provider = new PdfCaseReviewEditorProvider(context, output);
    const registration = window.registerCustomEditorProvider(PdfCaseReviewEditorProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true },
    });
    return { provider, registration };
  }

  private readonly webviews = new WebviewCollection();
  private readonly documents = new Map<string, PdfDocument>();
  private readonly states = new Map<string, ViewerState>();
  private readonly _onDidChangeViewerState = new EventEmitter<{ uri: Uri; state: ViewerState }>();
  readonly onDidChangeViewerState = this._onDidChangeViewerState.event;
  private readonly _onDidChangeCustomDocument = new EventEmitter<
    CustomDocumentContentChangeEvent<PdfDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  /** Fired when a document's model, dirty state or save status changed (the views listen). */
  private readonly _onDidChangeDocument = new EventEmitter<PdfDocument>();
  readonly onDidChangeDocument = this._onDidChangeDocument.event;
  private viewerHtmlTemplate: Promise<string> | undefined;
  private readonly generator: string;

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: LogOutputChannel,
  ) {
    const manifest = context.extension.packageJSON as { version?: unknown };
    this.generator = `pdf-case-review/${typeof manifest.version === "string" ? manifest.version : "0.0.0"}`;
  }

  getViewerState(uri: Uri): ViewerState | undefined {
    return this.states.get(uri.toString());
  }

  getDocument(uri: Uri): PdfDocument | undefined {
    return this.documents.get(uri.toString());
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

  private updateState(uri: Uri, patch: Partial<ViewerState>): ViewerState {
    const key = uri.toString();
    const next = { ...(this.states.get(key) ?? EMPTY_VIEWER_STATE), ...patch };
    this.states.set(key, next);
    this._onDidChangeViewerState.fire({ uri, state: next });
    return next;
  }

  async openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext): Promise<PdfDocument> {
    const bytes = await workspace.fs.readFile(uri);
    const info: PdfInfo = {
      sha256: await hashBytes(bytes),
      byteLength: bytes.byteLength,
      pageCount: 0,
      title: null,
    };
    const sidecarUri = sidecarUriFor(uri, sidecarLocation(uri));
    const onDisk = await this.loadSidecar(sidecarUri);
    const fresh = () =>
      emptySidecar(sourceFor(uri, info), configuredCategories(uri, this.output), this.generator);

    let model: Sidecar;
    let snapshot: string;
    switch (onDisk.kind) {
      case "loaded":
        model = onDisk.model;
        snapshot = onDisk.snapshot;
        if (model.source.sha256 !== info.sha256) {
          this.output.warn(`pdf changed since the sidecar was saved: ${uri.fsPath}`);
        }
        break;
      case "missing":
        model = fresh();
        snapshot = serializeSidecar(model);
        break;
      case "invalid":
        model = fresh();
        snapshot = serializeSidecar(model);
        break;
    }
    if (openContext.backupId) {
      const backup = await this.loadSidecar(Uri.parse(openContext.backupId));
      if (backup.kind === "loaded") {
        model = backup.model;
        this.output.info(`restored unsaved highlights from backup: ${uri.fsPath}`);
      }
    }

    // Look inside the PDF once: protected files are never written, and for the others the
    // annotations we embedded earlier refresh (or rebuild) the sidecar's bookkeeping.
    const inspection =
      model.source.encrypted === true ? { protected: true, embedded: null } : await inspectPdf(bytes);
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
    document.readOnly = onDisk.kind === "invalid";
    document.protected = inspection.protected;
    const key = uri.toString();
    this.documents.set(key, document);
    const listeners: Disposable[] = [];
    listeners.push(
      document.onDidChange((changed) => {
        // The workspace watcher can deliver a write that predates this document (e.g. a file
        // written just before it was opened); only a real content change warrants a reload.
        void contentHash(changed).then((hash) => {
          if (hash === document.contentHash) {
            return;
          }
          document.contentHash = hash;
          this.output.info(`pdf changed on disk, reloading: ${changed.fsPath}`);
          void workspace.fs.stat(changed).then((stat) => {
            document.info = { ...document.info, sha256: hash, byteLength: stat.size };
          });
          this.reloadViewer(document);
        });
      }),
    );
    document.onDidDelete(() => {
      disposeAll(listeners);
      this.states.delete(key);
      this.documents.delete(key);
    });
    return document;
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
    this.updateState(document.uri, { loaded: false });
    this.postMessage(document.uri, { type: "reload" });
  }

  async resolveCustomEditor(document: PdfDocument, webviewPanel: WebviewPanel): Promise<void> {
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
    webviewPanel.onDidDispose(() => listener.dispose());
  }

  private handleMessage(document: PdfDocument, webview: Webview, resourceRoot: Uri, message: unknown): void {
    if (!isWebviewToHostMessage(message)) {
      return;
    }
    const state = this.getViewerState(document.uri);
    switch (message.type) {
      case "ready":
        this.output.debug(`webview ready: ${document.uri.fsPath}`);
        return;
      case "viewerLoaded": {
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
      case "openLink":
        void this.openLocalLink(webview, resourceRoot, message.url);
        return;
      case "log": {
        this.output[message.level](`[webview] ${message.message}`);
        const logs = [...(state?.logs ?? []), `${message.level}: ${message.message}`].slice(-30);
        this.updateState(document.uri, { logs });
        return;
      }
    }
  }

  /** Draws the highlights the file holds no annotation for (protected PDF, embedding off, unsaved). */
  private injectMissing(document: PdfDocument, annotationIdsInFile: readonly string[]): void {
    const injectable = missingFromFile(document.model.highlights, new Set(annotationIdsInFile))
      .map((highlight) => toInjectable(highlight, document.model.categories))
      .filter((entry): entry is InjectableHighlight => entry !== undefined);
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
    const wasDirty = document.isDirty;
    document.model = { ...document.model, highlights: result.highlights };
    this.output.debug(
      `reconciled: +${result.created.length} ~${result.updated.length} -${result.deleted.length} restored ${result.restored.length}${result.derivedOnly ? " (bookkeeping only)" : ""}`,
    );
    if (result.derivedOnly && !wasDirty) {
      // Page labels, late text and annotation ids are facts about the file, not edits: a clean
      // document stays clean and picks them up with the next real save.
      document.savedSnapshot = serializeSidecar(document.model);
      this._onDidChangeDocument.fire(document);
      return;
    }
    this._onDidChangeCustomDocument.fire({ document });
    this._onDidChangeDocument.fire(document);
  }

  async saveCustomDocument(document: PdfDocument, _token: CancellationToken): Promise<void> {
    if (document.readOnly) {
      throw new Error(
        `PDF Case Review: ${baseName(document.sidecarUri)} could not be read when the PDF was opened; fix or remove it, then reopen the PDF.`,
      );
    }
    await syncOnSave(document, this.syncContext(document.uri));
    this._onDidChangeDocument.fire(document);
  }

  /** Save As exports a copy: the PDF (with highlights embedded when allowed) plus a sidecar beside it. */
  async saveCustomDocumentAs(
    document: PdfDocument,
    destination: Uri,
    _token: CancellationToken,
  ): Promise<void> {
    await exportCopy(document, destination, this.syncContext(destination));
  }

  private syncContext(uri: Uri): SyncContext {
    return {
      output: this.output,
      generator: this.generator,
      embedOnSave: embedOnSave(uri),
      onProtected: (document) => this.notifyProtected(document),
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
    await workspace.fs.createDirectory(parentUri(context.destination));
    await workspace.fs.writeFile(
      context.destination,
      new TextEncoder().encode(serializeSidecar(document.model)),
    );
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
      return stripViewerTags(new TextDecoder().decode(bytes));
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
    const cspSource = webview.cspSource;
    const settings = workspace.getConfiguration("pdfCaseReview.viewer", document.uri);

    const config: ViewerConfig = {
      url: `${webview.asWebviewUri(document.uri)}`,
      resourceRoot: withTrailingSlash(webview.asWebviewUri(resourceRoot)),
      defaultZoomValue: settings.get<string>("defaultZoom", "auto"),
      sidebarViewOnLoad: settings.get<number>("sidebarOnLoad", 0),
      // The palette comes from the document's own categories: the sidecar is self-describing.
      highlightEditorColors: toHighlightEditorColors(document.model.categories),
      sandboxBundleSrc: `${pdfjs("build", "pdf.sandbox.mjs")}`,
      cMapUrl: withTrailingSlash(pdfjs("web", "cmaps")),
      iccUrl: withTrailingSlash(pdfjs("web", "iccs")),
      standardFontDataUrl: withTrailingSlash(pdfjs("web", "standard_fonts")),
      wasmUrl: withTrailingSlash(pdfjs("web", "wasm")),
      imageResourcesPath: withTrailingSlash(pdfjs("web", "images")),
    };

    return template
      .replace(
        /* html */ "<title>PDF.js viewer</title>",
        /* html */ `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource} blob: data:; script-src ${cspSource} 'wasm-unsafe-eval'; worker-src ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} blob: data:; font-src ${cspSource} data:; media-src blob:; base-uri 'none'; form-action 'none';">
<meta id="pdf-case-review-config" data-config="${escapeAttribute(config)}">

<title>PDF Case Review</title>

<link rel="stylesheet" href="${pdfjs("web", "viewer.css")}">
<link rel="stylesheet" href="${resolve("media", "webview.css")}">

<script src="${pdfjs("build", "pdf.mjs")}" type="module"></script>
<script src="${resolve("dist", "webview", "main.js")}" type="module"></script>

<link rel="resource" type="application/l10n" href="${pdfjs("web", "locale", "locale.json")}">`,
      )
      .trim();
  }
}
