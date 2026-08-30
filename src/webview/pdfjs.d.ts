// Minimal typings for the parts of the vendored PDF.js viewer we touch. `pdfjs-viewer` is
// rewritten by tsup to the runtime URL ../../vendor/pdfjs/web/viewer.mjs (see tsup.config.ts).
// Everything here is PDF.js internals, not a public API; keep the surface small and keep every
// use inside src/webview/ so an upgrade only ever breaks one place.

declare module "pdfjs-viewer" {
  export interface PdfJsEventBus {
    on(name: string, listener: (event: Record<string, unknown>) => void): void;
    off(name: string, listener: (event: Record<string, unknown>) => void): void;
    dispatch(name: string, data: Record<string, unknown>): void;
  }

  export interface PdfJsEditor {
    id: string;
    pageIndex: number;
    /** Set when the editor was created from an annotation already in the file. */
    annotationElementId: string | null;
    /** The editor's DOM element once rendered; highlight editors carry their text as aria-label. */
    div?: HTMLElement | null;
    color?: string | number[];
    serialize(isForCopying?: boolean): Record<string, unknown> | null;
    updateParams(type: number, value: unknown): void;
  }

  export interface PdfJsUiManager {
    getEditors(pageIndex: number): Iterable<PdfJsEditor>;
    getEditor(id: string): PdfJsEditor | undefined;
    highlightSelection(methodOfCreation?: string, comment?: boolean): void;
    updateParams(type: number, value: unknown): void;
    setSelected(editor: PdfJsEditor): void;
    /** True once a file-backed editor was deleted (the annotation is dropped on save). */
    isDeletedAnnotationElement(annotationElementId: string): boolean;
    getMode(): number;
    readonly highlightColors: Map<string, string> | null;
  }

  export interface PdfJsViewer {
    readonly pagesPromise: Promise<unknown>;
    readonly pagesCount: number;
    currentPageNumber: number;
    annotationEditorMode: number;
    scrollPageIntoView(params: { pageNumber: number; destArray?: unknown[] | null }): void;
  }

  export interface PdfJsPageProxy {
    getAnnotations(): Promise<Record<string, unknown>[]>;
  }

  export interface PdfJsDocumentProxy {
    readonly numPages: number;
    getPage(pageNumber: number): Promise<PdfJsPageProxy>;
    getPageLabels(): Promise<string[] | null>;
    getMetadata(): Promise<{ info: Record<string, unknown> }>;
    saveDocument(): Promise<Uint8Array>;
  }

  export interface PdfJsApplication {
    readonly initializedPromise: Promise<void>;
    readonly eventBus: PdfJsEventBus;
    readonly pdfViewer: PdfJsViewer;
    readonly pdfDocument: PdfJsDocumentProxy | null;
    readonly pdfLinkService: { setHash(hash: string): void };
    open(args: Record<string, unknown>): Promise<void>;
  }

  export const PDFViewerApplication: PdfJsApplication;
  export const PDFViewerApplicationOptions: {
    set(name: string, value: unknown): void;
    get(name: string): unknown;
  };
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
