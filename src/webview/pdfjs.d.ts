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

  /** One page's AnnotationEditorLayer; exists once the page has been rendered. */
  export interface PdfJsEditorLayer {
    readonly pageIndex: number;
    readonly div: HTMLElement;
    deserialize(data: Record<string, unknown>): Promise<PdfJsEditor | null>;
    add(editor: PdfJsEditor): void;
  }

  export interface PdfJsUiManager {
    getEditors(pageIndex: number): Iterable<PdfJsEditor>;
    getEditor(id: string): PdfJsEditor | undefined;
    getLayer(pageIndex: number): PdfJsEditorLayer | undefined;
    highlightSelection(methodOfCreation?: string, comment?: boolean): void;
    updateParams(type: number, value: unknown): void;
    setSelected(editor: PdfJsEditor): void;
    unselectAll(): void;
    unselect(editor: PdfJsEditor): void;
    /** Deletes the selected editors as one undoable command. */
    delete(): void;
    undo(): void;
    redo(): void;
    /** True once a file-backed editor was deleted (the annotation is dropped on save). */
    isDeletedAnnotationElement(annotationElementId: string): boolean;
    getMode(): number;
    /** True while at least one editor is selected. */
    readonly hasSelection: boolean;
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
    getTextContent(): Promise<{ items: Record<string, unknown>[] }>;
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
    /** PDF.js "save" = download the (edited) file; replaced with no-ops, saving is VS Code's job. */
    download(): Promise<void>;
    save(): Promise<void>;
    downloadOrSave(): Promise<void>;
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
