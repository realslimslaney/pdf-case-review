// Everything that touches PDF.js editor internals lives here (ADR-0003). If an upgrade breaks
// the highlight editor, this is the one file to fix — or to swap for an overlay-based adapter.

import type { PdfJsApplication, PdfJsEditor, PdfJsUiManager } from "pdfjs-viewer";

import { rgbToHex } from "../core/categories";
import type { EmbeddedAnnotation, SerializedHighlight, WebviewToHostMessage } from "../shared/protocol";

// PDF.js constants (src/shared/util.js). Hard-coded because the viewer does not export them;
// the spike log in docs/explanation/decisions.md records the vendored build they were checked against.
const ANNOTATION_EDITOR_TYPE_HIGHLIGHT = 9;
const PARAMS_HIGHLIGHT_COLOR = 31;

const SNAPSHOT_DEBOUNCE_MS = 150;
/** A selection made this long before an editor appears is assumed to be its source text. */
const SELECTION_PAIRING_WINDOW_MS = 2_000;

type Options = { get(name: string): unknown };

function toPlain(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toPlain(entry)]),
    );
  }
  return value;
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number") ? value : [];
}

function colorToHex(value: unknown): string | null {
  const components = numberList(toPlain(value));
  return components.length === 3 ? rgbToHex(components as [number, number, number]) : null;
}

export class PdfjsAdapter {
  private uiManager: PdfJsUiManager | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSnapshotJson = "";
  private readonly textById = new Map<string, string>();
  private lastSelection: { text: string; at: number } | null = null;

  constructor(
    private readonly app: PdfJsApplication,
    private readonly options: Options,
    private readonly post: (message: WebviewToHostMessage) => void,
  ) {}

  /** Call after `initializedPromise` and before `open()` so the UI-manager event is not missed. */
  attach(): void {
    const { eventBus } = this.app;
    eventBus.on("annotationeditoruimanager", (event) => {
      this.uiManager = (event["uiManager"] as PdfJsUiManager | undefined) ?? null;
    });
    for (const name of [
      "editingstateschanged",
      "annotationeditormodechanged",
      "pagerendered",
      "editorsrendered",
    ]) {
      eventBus.on(name, () => this.scheduleSnapshot());
    }
    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) {
        const text = selection.toString();
        if (text.trim() !== "") {
          this.lastSelection = { text, at: Date.now() };
        }
      }
    });
  }

  async reportLoaded(): Promise<void> {
    const colors = this.options.get("highlightEditorColors");
    this.post({
      type: "viewerLoaded",
      pagesCount: this.app.pdfViewer.pagesCount,
      annotationEditorMode: this.app.pdfViewer.annotationEditorMode,
      highlightEditorColors: typeof colors === "string" ? colors : null,
      annotations: await this.collectHighlightAnnotations(),
    });
    this.scheduleSnapshot();
  }

  /** Highlight annotations already present in the file, straight from the PDF.js document proxy. */
  private async collectHighlightAnnotations(): Promise<EmbeddedAnnotation[]> {
    const pdfDocument = this.app.pdfDocument;
    if (!pdfDocument) {
      return [];
    }
    const result: EmbeddedAnnotation[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      for (const annotation of await page.getAnnotations()) {
        if (annotation["subtype"] !== "Highlight" || typeof annotation["id"] !== "string") {
          continue;
        }
        const contents = annotation["contentsObj"] as { str?: unknown } | undefined;
        result.push({
          id: annotation["id"],
          pageIndex: pageNumber - 1,
          rect: numberList(toPlain(annotation["rect"])),
          quadPoints: numberList(toPlain(annotation["quadPoints"])),
          color: colorToHex(annotation["color"]),
          contents: typeof contents?.str === "string" ? contents.str : "",
          modificationDate:
            typeof annotation["modificationDate"] === "string" ? annotation["modificationDate"] : null,
        });
      }
    }
    return result;
  }

  setEditorMode(mode: number): void {
    this.app.eventBus.dispatch("switchannotationeditormode", { source: this, mode });
  }

  /** Finds an editor by our id: the annotation id for file-backed editors, else PDF.js's editor id. */
  private findEditor(id: string): PdfJsEditor | undefined {
    if (!this.uiManager) {
      return undefined;
    }
    for (let pageIndex = 0; pageIndex < this.app.pdfViewer.pagesCount; pageIndex += 1) {
      for (const editor of this.uiManager.getEditors(pageIndex)) {
        if (editor.annotationElementId === id || editor.id === id) {
          return editor;
        }
      }
    }
    return undefined;
  }

  recolorEditor(id: string, color: string): void {
    const editor = this.findEditor(id);
    if (!editor) {
      this.post({ type: "log", level: "warn", message: `recolor: no editor with id ${id}` });
      return;
    }
    editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
    this.scheduleSnapshot();
  }

  async saveDocument(): Promise<void> {
    try {
      const bytes = await this.app.pdfDocument?.saveDocument();
      this.post({ type: "savedDocument", bytes: bytes ?? null, error: bytes ? null : "no document" });
    } catch (error) {
      this.post({
        type: "savedDocument",
        bytes: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  scheduleSnapshot(): void {
    if (this.snapshotTimer !== undefined) {
      clearTimeout(this.snapshotTimer);
    }
    this.snapshotTimer = setTimeout(() => this.snapshotNow(), SNAPSHOT_DEBOUNCE_MS);
  }

  snapshotNow(): void {
    this.snapshotTimer = undefined;
    if (!this.uiManager) {
      return;
    }
    const editors: SerializedHighlight[] = [];
    const existingUnchanged: string[] = [];
    for (let pageIndex = 0; pageIndex < this.app.pdfViewer.pagesCount; pageIndex += 1) {
      for (const editor of this.uiManager.getEditors(pageIndex)) {
        const serialized = this.serialize(editor);
        if (serialized) {
          editors.push(serialized);
        } else if (editor.annotationElementId) {
          existingUnchanged.push(editor.annotationElementId);
        }
      }
    }
    const rendered = [...document.querySelectorAll(".annotationEditorLayer .highlightEditor")].filter(
      (element) => element.getBoundingClientRect().width > 0,
    ).length;
    const json = JSON.stringify({ editors, existingUnchanged, rendered });
    if (json !== this.lastSnapshotJson) {
      this.lastSnapshotJson = json;
      this.post({ type: "editorsChanged", editors, existingUnchanged, rendered });
    }
  }

  private serialize(editor: PdfJsEditor): SerializedHighlight | null {
    // serialize() returns null for an unchanged pre-existing annotation and for deleted editors
    // that never existed in the file; both are "nothing new to report".
    const raw = editor.serialize(false);
    if (!raw || raw["annotationType"] !== ANNOTATION_EDITOR_TYPE_HIGHLIGHT || raw["deleted"] === true) {
      return null;
    }
    if (!this.textById.has(editor.id) && this.lastSelection) {
      if (Date.now() - this.lastSelection.at <= SELECTION_PAIRING_WINDOW_MS) {
        this.textById.set(editor.id, this.lastSelection.text);
      }
    }
    // PDF.js serializes geometry as typed arrays (Float32Array); flatten to plain numbers so the
    // payload survives postMessage and JSON alike.
    const plain = toPlain(raw) as Record<string, unknown>;
    const color = numberList(plain["color"]);
    return {
      id: editor.annotationElementId ?? editor.id,
      pageIndex: editor.pageIndex,
      color: color.length === 3 ? rgbToHex(color as [number, number, number]) : String(plain["color"]),
      quadPoints: numberList(plain["quadPoints"]),
      rect: numberList(plain["rect"]),
      rotation: typeof plain["rotation"] === "number" ? plain["rotation"] : 0,
      text: this.textById.get(editor.id) ?? null,
      raw: plain,
    };
  }

  /**
   * Spike instrumentation: programmatically select the first `spanCount` text-layer spans of
   * `page`, create a highlight from that selection exactly as the floating button would, and
   * recolor it. Used by the integration tests; harmless otherwise.
   */
  spikeHighlightText(page: number, spanCount: number, color: string): void {
    const textLayer = document.querySelector(`.page[data-page-number="${page}"] .textLayer`);
    if (!textLayer || !this.uiManager) {
      this.post({
        type: "log",
        level: "error",
        message: `spike: page ${page} text layer or UI manager missing`,
      });
      return;
    }
    const spans = [...textLayer.querySelectorAll("span")].filter(
      (span) => (span.textContent ?? "").trim() !== "",
    );
    const first = spans[0];
    const last = spans[Math.min(spanCount, spans.length) - 1];
    if (!first || !last) {
      this.post({ type: "log", level: "error", message: `spike: page ${page} has no text spans` });
      return;
    }
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const selection = document.getSelection();
    if (!selection) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    this.lastSelection = { text: selection.toString(), at: Date.now() };

    const before = new Set([...this.uiManager.getEditors(page - 1)].map((editor) => editor.id));
    this.uiManager.highlightSelection("pdfCaseReview.spike");

    // Creation is deferred behind a mode switch; recolor once the new editor exists.
    const recolor = (attempt: number) => {
      if (!this.uiManager) {
        return;
      }
      const created = [...this.uiManager.getEditors(page - 1)].filter((editor) => !before.has(editor.id));
      if (created.length === 0) {
        if (attempt < 20) {
          setTimeout(() => recolor(attempt + 1), 50);
        } else {
          this.post({ type: "log", level: "error", message: "spike: no highlight editor was created" });
        }
        return;
      }
      for (const editor of created) {
        editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
      }
      this.scheduleSnapshot();
    };
    recolor(0);
  }
}
