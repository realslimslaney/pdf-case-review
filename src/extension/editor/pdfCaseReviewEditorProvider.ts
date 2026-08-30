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
 * tracks per-document viewer state for tests and the notes views.
 */

import {
  type CustomReadonlyEditorProvider,
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

import {
  type Category,
  DEFAULT_CATEGORIES,
  normalizeCategories,
  toHighlightEditorColors,
  validateCategories,
} from "../../core/categories";
import {
  type EmbeddedAnnotation,
  type HostToWebviewMessage,
  isWebviewToHostMessage,
  type SerializedHighlight,
  type ViewerConfig,
} from "../../shared/protocol";
import { disposeAll } from "../util/disposable";
import { escapeAttribute } from "../util/escapeAttribute";
import { WebviewCollection } from "../util/webviewCollection";
import { contentHash, PdfDocument, parentUri } from "./pdfDocument";

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
}

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

export class PdfCaseReviewEditorProvider implements CustomReadonlyEditorProvider<PdfDocument> {
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
  private readonly states = new Map<string, ViewerState>();
  private readonly _onDidChangeViewerState = new EventEmitter<{ uri: Uri; state: ViewerState }>();
  readonly onDidChangeViewerState = this._onDidChangeViewerState.event;
  private viewerHtmlTemplate: Promise<string> | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: LogOutputChannel,
  ) {}

  getViewerState(uri: Uri): ViewerState | undefined {
    return this.states.get(uri.toString());
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

  async openCustomDocument(uri: Uri): Promise<PdfDocument> {
    const document = new PdfDocument(uri);
    document.contentHash = await contentHash(uri);
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
          this.postMessage(changed, { type: "reload" });
        });
      }),
    );
    document.onDidDelete(() => {
      disposeAll(listeners);
      this.states.delete(uri.toString());
    });
    return document;
  }

  async resolveCustomEditor(document: PdfDocument, webviewPanel: WebviewPanel): Promise<void> {
    this.webviews.add(document.uri, webviewPanel);
    const resourceRoot = parentUri(document.uri);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, this.context.extensionUri],
    };
    this.states.set(document.uri.toString(), {
      loaded: false,
      loads: this.states.get(document.uri.toString())?.loads ?? 0,
      rendered: 0,
      pagesCount: 0,
      annotationEditorMode: -1,
      highlightEditorColors: null,
      annotations: [],
      editors: [],
      existingUnchanged: [],
      lastSave: null,
    });
    webviewPanel.webview.html = await this.getHtmlForWebview(document, webviewPanel.webview, resourceRoot);
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      this.handleMessage(document, webviewPanel.webview, resourceRoot, message);
    });
  }

  private handleMessage(document: PdfDocument, webview: Webview, resourceRoot: Uri, message: unknown): void {
    if (!isWebviewToHostMessage(message)) {
      return;
    }
    const key = document.uri.toString();
    const state = this.states.get(key);
    switch (message.type) {
      case "ready":
        this.output.debug(`webview ready: ${document.uri.fsPath}`);
        return;
      case "viewerLoaded": {
        const next: ViewerState = {
          loaded: true,
          loads: (state?.loads ?? 0) + 1,
          rendered: state?.rendered ?? 0,
          pagesCount: message.pagesCount,
          annotationEditorMode: message.annotationEditorMode,
          highlightEditorColors: message.highlightEditorColors,
          annotations: message.annotations,
          editors: state?.editors ?? [],
          existingUnchanged: state?.existingUnchanged ?? [],
          lastSave: state?.lastSave ?? null,
        };
        this.states.set(key, next);
        this.output.info(
          `viewer loaded: ${document.uri.fsPath} (${message.pagesCount} pages, ${message.annotations.length} embedded highlight(s), editor mode ${message.annotationEditorMode}, colors ${message.highlightEditorColors ?? "none"})`,
        );
        this._onDidChangeViewerState.fire({ uri: document.uri, state: next });
        return;
      }
      case "editorsChanged": {
        const next: ViewerState = {
          loaded: state?.loaded ?? false,
          loads: state?.loads ?? 0,
          rendered: message.rendered,
          pagesCount: state?.pagesCount ?? 0,
          annotationEditorMode: state?.annotationEditorMode ?? -1,
          highlightEditorColors: state?.highlightEditorColors ?? null,
          annotations: state?.annotations ?? [],
          editors: message.editors,
          existingUnchanged: message.existingUnchanged,
          lastSave: state?.lastSave ?? null,
        };
        this.states.set(key, next);
        this.output.info(
          `editors changed: ${message.editors.length} highlight(s), ${message.existingUnchanged.length} unchanged from file, ${message.rendered} drawn`,
        );
        this._onDidChangeViewerState.fire({ uri: document.uri, state: next });
        return;
      }
      case "savedDocument": {
        if (state) {
          const bytes = message.bytes ? new Uint8Array(message.bytes) : null;
          const next: ViewerState = {
            ...state,
            lastSave: { byteLength: bytes?.byteLength ?? 0, error: message.error, bytes },
          };
          this.states.set(key, next);
          this.output.info(
            `saveDocument: ${bytes?.byteLength ?? 0} bytes${message.error ? ` (error: ${message.error})` : ""}`,
          );
          this._onDidChangeViewerState.fire({ uri: document.uri, state: next });
        }
        return;
      }
      case "openLink":
        void this.openLocalLink(webview, resourceRoot, message.url);
        return;
      case "log":
        this.output[message.level](`[webview] ${message.message}`);
        return;
    }
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

  private categoriesFor(uri: Uri): Category[] {
    const configured = workspace
      .getConfiguration("pdfCaseReview", uri)
      .get<Category[]>("categories", [...DEFAULT_CATEGORIES]);
    const errors = validateCategories(configured);
    if (errors.length > 0) {
      const detail = errors.map((error) => `#${error.index + 1}: ${error.message}`).join("; ");
      this.output.warn(`pdfCaseReview.categories is invalid, using defaults: ${detail}`);
      void window.showWarningMessage(
        `PDF Case Review: category settings are invalid (${detail}). Using defaults.`,
      );
      return [...DEFAULT_CATEGORIES];
    }
    return normalizeCategories(configured);
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
      highlightEditorColors: toHighlightEditorColors(this.categoriesFor(document.uri)),
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
