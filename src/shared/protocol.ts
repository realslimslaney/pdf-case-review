// Messages exchanged between the extension host and the PDF.js webview.
// Shared by both bundles; keep it dependency-free.

/** A PDF.js highlight editor as returned by `editor.serialize()`, plus our own bookkeeping. */
export interface SerializedHighlight {
  id: string;
  pageIndex: number;
  /** `#RRGGBB`, uppercased. PDF.js serializes `[r, g, b]`; the webview converts. */
  color: string;
  quadPoints: number[];
  rect: number[];
  rotation: number;
  /** Text captured from the selection when the highlight was created, when available. */
  text: string | null;
  /** PDF.js annotation id when the editor backs an annotation already in the file, else null. */
  annotationElementId: string | null;
  /** Our highlight uuid when the host created or injected this editor (see core/sidecar/reconcile). */
  sidecarId?: string;
  /** Text recovered by intersecting `quadPoints` with the page's text content, when computed. */
  quadText?: string;
  /** Raw serialize() payload, kept so it can be replayed via deserialize() verbatim. */
  raw: Record<string, unknown>;
}

/** A highlight annotation that already exists inside the PDF, as PDF.js reports it on load. */
export interface EmbeddedAnnotation {
  /** PDF.js annotation id: the object reference, e.g. `12R`. Becomes the editor id when edited. */
  id: string;
  pageIndex: number;
  rect: number[];
  quadPoints: number[];
  color: string | null;
  contents: string;
  modificationDate: string | null;
}

/** A sidecar highlight the file holds no annotation for, in the shape PDF.js can deserialize. */
export interface InjectableHighlight {
  sidecarId: string;
  pageIndex: number;
  /** `AnnotationEditorLayer.deserialize` payload: annotationType 9, color, opacity, rect, quads or outlines. */
  data: Record<string, unknown>;
}

export interface ViewerConfig {
  url: string;
  resourceRoot: string;
  defaultZoomValue: string;
  sidebarViewOnLoad: number;
  highlightEditorColors: string;
  sandboxBundleSrc: string;
  cMapUrl: string;
  iccUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
  imageResourcesPath: string;
}

export type WebviewToHostMessage =
  | { type: "ready" }
  | {
      type: "viewerLoaded";
      pagesCount: number;
      /** PDF page labels by page index (`["i", "ii", "1", ...]`), or null when the file has none. */
      pageLabels: string[] | null;
      /** Document title from the PDF metadata, when present. */
      title: string | null;
      annotationEditorMode: number;
      highlightEditorColors: string | null;
      /** Highlight annotations found in the file itself. */
      annotations: EmbeddedAnnotation[];
    }
  | {
      type: "editorsChanged";
      editors: SerializedHighlight[];
      /** Editors backing unchanged pre-existing annotations (`serialize()` returned null). */
      existingUnchanged: string[];
      /** Annotation ids (from `viewerLoaded.annotations`) that PDF.js now reports as deleted. */
      deletedAnnotationIds: string[];
      /** Highlight editor elements actually laid out in the page DOM (width > 0). */
      rendered: number;
    }
  | { type: "savedDocument"; bytes: Uint8Array | null; error: string | null }
  /** The viewer scrolled to another page (1-based). */
  | { type: "pageChanged"; page: number; pageLabel: string | null }
  /** Ctrl+S / Cmd+S pressed inside the viewer; the host runs VS Code's save. */
  | { type: "saveRequested" }
  /** Outcome of `deleteHighlights`: `failed` ids had no editor the viewer could delete. */
  | { type: "highlightsDeleted"; deleted: string[]; failed: string[] }
  /** Outcome of `createFromSelection`: a new highlight, or the selected editors recolored, or neither. */
  | { type: "createFromSelectionResult"; id: string; created: boolean; recolored: boolean }
  | { type: "openLink"; url: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export type HostToWebviewMessage =
  | { type: "reload" }
  | { type: "dumpEditors" }
  /** PDF.js AnnotationEditorType: 0 = none (floating button only), 9 = highlight tool active. */
  | { type: "setEditorMode"; mode: number }
  /** Ask PDF.js to serialize the document with its annotation edits applied (incremental save). */
  | { type: "saveDocument" }
  /** Draw sidecar highlights the file holds no annotation for; each page is injected once rendered. */
  | { type: "loadHighlights"; highlights: InjectableHighlight[] }
  /** Delete highlights through PDF.js (undoable there); pending injections are cancelled too. */
  | { type: "deleteHighlights"; items: { sidecarId: string; viewerId?: string }[] }
  /** Recolor editors (category change from the host). */
  | { type: "recolorHighlights"; items: { viewerId: string; color: string }[] }
  /** Highlight the text selection with this uuid and color, or recolor the selected editors. */
  | { type: "createFromSelection"; id: string; color: string }
  /** Scroll to a highlight (1-based page; rect in PDF user space) and flash its editor when it has one. */
  | { type: "goTo"; page: number; rect?: [number, number, number, number]; viewerId?: string }
  /** Spike instrumentation: select `spanCount` text-layer spans on `page` without creating anything. */
  | { type: "spike.selectText"; page: number; spanCount: number }
  /** Spike instrumentation: select an editor (as a focused viewer does after creating one). */
  | { type: "spike.selectEditor"; viewerId: string }
  /** Spike instrumentation: PDF.js undo / redo. */
  | { type: "spike.undo" }
  | { type: "spike.redo" }
  /** Spike instrumentation: select `spanCount` text-layer spans on `page` and highlight them. */
  | { type: "spike.highlightText"; page: number; spanCount: number; color: string }
  /** Spike instrumentation: recolor an existing editor (id = PDF.js editor / annotation id). */
  | { type: "spike.recolorEditor"; id: string; color: string };

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return (
    typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
  );
}
