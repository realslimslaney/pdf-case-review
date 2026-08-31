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

/** VS Code's active color theme, as the viewer needs to know it. */
export type ThemeKind = "light" | "dark" | "high-contrast" | "high-contrast-light";

export interface ViewerConfig {
  url: string;
  resourceRoot: string;
  defaultZoomValue: string;
  sidebarViewOnLoad: number;
  /** High-contrast kinds force PDF.js page colors; baked at load, a change rebuilds the webview. */
  themeKind: ThemeKind;
  /** PDF.js `maxCanvasPixels`; null keeps the vendored default. */
  maxCanvasPixels: number | null;
  /** PDF.js `maxImageSize`; null keeps the vendored default. */
  maxImageSize: number | null;
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
  /** Answer to `getPageText`; text is null when the page has no text layer or the read failed. */
  | { type: "pageText"; requestId: number; page: number; text: string | null }
  /** Acknowledges a host command that carried a `requestId`, after its handler finished. */
  | { type: "done"; requestId: number; ok: boolean; error?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

type HostCommand =
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
  /**
   * Highlight the text selection with this uuid and color; failing that, recolor the editors
   * PDF.js has selected, or the host's target (`fallbackViewerId`: tree selection or the
   * last created highlight), so the fallback survives a window without focus.
   */
  | { type: "createFromSelection"; id: string; color: string; fallbackViewerId?: string }
  /** Scroll to a highlight (1-based page; rect in PDF user space) and flash its editor when it has one. */
  | { type: "goTo"; page: number; rect?: [number, number, number, number]; viewerId?: string }
  /** Read one page's text content (1-based page); answered with `pageText`. */
  | { type: "getPageText"; requestId: number; page: number }
  /** Spike instrumentation: select `spanCount` text-layer spans on `page` without creating anything. */
  | { type: "spike.selectText"; page: number; spanCount: number }
  /** Spike instrumentation: acknowledged ok only once `page`'s text layer is laid out (no selection). */
  | { type: "spike.probeTextLayer"; page: number }
  /** Spike instrumentation: PDF.js undo / redo. */
  | { type: "spike.undo" }
  | { type: "spike.redo" }
  /** Spike instrumentation: select `spanCount` text-layer spans on `page` and highlight them. */
  | { type: "spike.highlightText"; page: number; spanCount: number; color: string }
  /** Spike instrumentation: recolor an existing editor (id = PDF.js editor / annotation id). */
  | { type: "spike.recolorEditor"; id: string; color: string };

/** Every host command may carry a `requestId`; the webview answers it with a `done` message. */
export type HostToWebviewMessage = HostCommand & { requestId?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isArrayOf<T>(value: unknown, check: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}

function isSerializedHighlight(value: unknown): value is SerializedHighlight {
  return (
    isRecord(value) &&
    isString(value["id"]) &&
    isNumber(value["pageIndex"]) &&
    isString(value["color"]) &&
    isArrayOf(value["quadPoints"], isNumber) &&
    isArrayOf(value["rect"], isNumber) &&
    isNumber(value["rotation"]) &&
    isStringOrNull(value["text"]) &&
    isStringOrNull(value["annotationElementId"]) &&
    (value["sidecarId"] === undefined || isString(value["sidecarId"])) &&
    (value["quadText"] === undefined || isString(value["quadText"])) &&
    isRecord(value["raw"])
  );
}

function isEmbeddedAnnotation(value: unknown): value is EmbeddedAnnotation {
  return (
    isRecord(value) &&
    isString(value["id"]) &&
    isNumber(value["pageIndex"]) &&
    isArrayOf(value["rect"], isNumber) &&
    isArrayOf(value["quadPoints"], isNumber) &&
    isStringOrNull(value["color"]) &&
    isString(value["contents"]) &&
    isStringOrNull(value["modificationDate"])
  );
}

/**
 * Full boundary validation: every field the host folds into the sidecar model or the viewer
 * state is checked, not just the discriminant.
 */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["type"]) {
    case "ready":
    case "saveRequested":
      return true;
    case "viewerLoaded":
      return (
        isNumber(value["pagesCount"]) &&
        (value["pageLabels"] === null || isArrayOf(value["pageLabels"], isString)) &&
        isStringOrNull(value["title"]) &&
        isNumber(value["annotationEditorMode"]) &&
        isStringOrNull(value["highlightEditorColors"]) &&
        isArrayOf(value["annotations"], isEmbeddedAnnotation)
      );
    case "editorsChanged":
      return (
        isArrayOf(value["editors"], isSerializedHighlight) &&
        isArrayOf(value["existingUnchanged"], isString) &&
        isArrayOf(value["deletedAnnotationIds"], isString) &&
        isNumber(value["rendered"])
      );
    case "savedDocument":
      // The bytes cross the webview boundary as a typed array or a structured-clone stand-in;
      // the host re-wraps them, so "object or null" is the honest boundary check.
      return (
        (value["bytes"] === null || typeof value["bytes"] === "object") && isStringOrNull(value["error"])
      );
    case "pageChanged":
      return isNumber(value["page"]) && isStringOrNull(value["pageLabel"]);
    case "highlightsDeleted":
      return isArrayOf(value["deleted"], isString) && isArrayOf(value["failed"], isString);
    case "createFromSelectionResult":
      return isString(value["id"]) && isBoolean(value["created"]) && isBoolean(value["recolored"]);
    case "openLink":
      return isString(value["url"]);
    case "pageText":
      return isNumber(value["requestId"]) && isNumber(value["page"]) && isStringOrNull(value["text"]);
    case "done":
      return (
        isNumber(value["requestId"]) &&
        isBoolean(value["ok"]) &&
        (value["error"] === undefined || isString(value["error"]))
      );
    case "log":
      return (
        (value["level"] === "info" || value["level"] === "warn" || value["level"] === "error") &&
        isString(value["message"])
      );
    default:
      return false;
  }
}
