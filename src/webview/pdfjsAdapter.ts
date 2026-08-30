// Everything that touches PDF.js editor internals lives here (ADR-0003). If an upgrade breaks
// the highlight editor, this is the one file to fix, or to swap for an overlay-based adapter.

import type { PdfJsApplication, PdfJsEditor, PdfJsUiManager } from "pdfjs-viewer";

import { rgbToHex } from "../core/categories";
import { type TextItemGeometry, textInQuads } from "../core/text/quadText";
import type {
  EmbeddedAnnotation,
  InjectableHighlight,
  SerializedHighlight,
  WebviewToHostMessage,
} from "../shared/protocol";

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
  /** Sidecar uuids for editors the host created or injected, keyed by PDF.js editor id. */
  private readonly sidecarIdByEditorId = new Map<string, string>();
  /** Highlight annotation ids found in the file at load time. */
  private annotationIds: string[] = [];
  private lastSelection: { text: string; at: number } | null = null;
  /** Sidecar highlights waiting for their page's editor layer, keyed by page index. */
  private readonly pendingInjections = new Map<number, InjectableHighlight[]>();
  private readonly injectedSidecarIds = new Set<string>();
  private readonly textItemsByPage = new Map<number, Promise<TextItemGeometry[]>>();
  /** Quad-intersection text per editor id, keyed by the quads it was computed for. */
  private readonly quadTextById = new Map<string, { key: string; text: string }>();
  private readonly quadTextInFlight = new Set<string>();

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
    for (const name of ["editingstateschanged", "annotationeditormodechanged"]) {
      eventBus.on(name, () => this.scheduleSnapshot());
    }
    for (const name of ["pagerendered", "editorsrendered"]) {
      eventBus.on(name, (event) => {
        this.scheduleSnapshot();
        const pageNumber = event["pageNumber"];
        if (typeof pageNumber === "number") {
          void this.tryInject(pageNumber - 1);
        }
      });
    }
    eventBus.on("pagechanging", (event) => {
      const page = event["pageNumber"];
      if (typeof page === "number") {
        const label = event["pageLabel"];
        this.post({ type: "pageChanged", page, pageLabel: typeof label === "string" ? label : null });
      }
    });
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
    const annotations = await this.collectHighlightAnnotations();
    this.annotationIds = annotations.map((annotation) => annotation.id);
    // Editor ids do not survive a load: forget per-load bookkeeping and force a fresh snapshot.
    this.sidecarIdByEditorId.clear();
    this.textById.clear();
    this.lastSnapshotJson = "";
    this.pendingInjections.clear();
    this.injectedSidecarIds.clear();
    this.textItemsByPage.clear();
    this.quadTextById.clear();
    this.quadTextInFlight.clear();
    this.post({
      type: "viewerLoaded",
      pagesCount: this.app.pdfViewer.pagesCount,
      pageLabels: (await this.app.pdfDocument?.getPageLabels()) ?? null,
      title: await this.documentTitle(),
      annotationEditorMode: this.app.pdfViewer.annotationEditorMode,
      highlightEditorColors: typeof colors === "string" ? colors : null,
      annotations,
    });
    this.scheduleSnapshot();
  }

  private async documentTitle(): Promise<string | null> {
    try {
      const metadata = await this.app.pdfDocument?.getMetadata();
      const title = metadata?.info["Title"];
      return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
    } catch {
      return null;
    }
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

  /** Queues sidecar-only highlights; each page's queue is injected once its editor layer exists. */
  loadHighlights(highlights: readonly InjectableHighlight[]): void {
    for (const highlight of highlights) {
      if (this.injectedSidecarIds.has(highlight.sidecarId)) {
        continue;
      }
      const queue = this.pendingInjections.get(highlight.pageIndex) ?? [];
      queue.push(highlight);
      this.pendingInjections.set(highlight.pageIndex, queue);
    }
    for (const pageIndex of [...this.pendingInjections.keys()]) {
      void this.tryInject(pageIndex);
    }
  }

  private async tryInject(pageIndex: number): Promise<void> {
    const queue = this.pendingInjections.get(pageIndex);
    const layer = this.uiManager?.getLayer(pageIndex);
    if (!queue || queue.length === 0 || !layer) {
      return;
    }
    this.pendingInjections.delete(pageIndex);
    for (const item of queue) {
      if (this.injectedSidecarIds.has(item.sidecarId)) {
        continue;
      }
      try {
        const editor = await layer.deserialize({ ...item.data, pageIndex });
        if (!editor) {
          this.post({
            type: "log",
            level: "warn",
            message: `inject ${item.sidecarId}: PDF.js returned no editor`,
          });
          continue;
        }
        layer.add(editor);
        // In NONE mode PDF.js renders an empty layer hidden and only un-hides it on a mode
        // change; an editor added afterwards would stay invisible.
        layer.div.hidden = false;
        this.sidecarIdByEditorId.set(editor.id, item.sidecarId);
        this.injectedSidecarIds.add(item.sidecarId);
        this.post({
          type: "log",
          level: "info",
          message: `drew sidecar highlight ${item.sidecarId} on page ${pageIndex + 1}`,
        });
      } catch (error) {
        this.post({
          type: "log",
          level: "error",
          message: `inject ${item.sidecarId}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    this.scheduleSnapshot();
  }

  /**
   * Finds an editor by viewer id, materializing file-backed annotations first when needed: outside
   * highlight mode PDF.js keeps them as plain annotation elements without editors.
   */
  private async withEditor(viewerId: string): Promise<PdfJsEditor | undefined> {
    let editor = this.findEditor(viewerId);
    if (editor || !this.uiManager || !/^[0-9]+R/.test(viewerId)) {
      return editor;
    }
    if (this.uiManager.getMode() !== ANNOTATION_EDITOR_TYPE_HIGHLIGHT) {
      this.setEditorMode(ANNOTATION_EDITOR_TYPE_HIGHLIGHT);
    }
    for (let attempt = 0; attempt < 20 && !editor; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      editor = this.findEditor(viewerId);
    }
    return editor;
  }

  /** Deletes editors through PDF.js so the deletion lands on its undo stack. */
  async deleteHighlights(viewerIds: readonly string[], sidecarIds: readonly string[] = []): Promise<void> {
    for (const sidecarId of sidecarIds) {
      for (const [pageIndex, queue] of this.pendingInjections) {
        this.pendingInjections.set(
          pageIndex,
          queue.filter((item) => item.sidecarId !== sidecarId),
        );
      }
      this.injectedSidecarIds.add(sidecarId);
    }
    if (!this.uiManager) {
      return;
    }
    const targets = new Set(viewerIds);
    for (const [editorId, sidecarId] of this.sidecarIdByEditorId) {
      if (sidecarIds.includes(sidecarId)) {
        targets.add(editorId);
      }
    }
    for (const viewerId of targets) {
      const editor = await this.withEditor(viewerId);
      if (!editor) {
        this.post({ type: "log", level: "warn", message: `delete: no editor with id ${viewerId}` });
        continue;
      }
      this.uiManager.setSelected(editor);
      this.uiManager.delete();
    }
    this.uiManager.unselectAll();
    this.scheduleSnapshot();
  }

  async recolorHighlights(items: readonly { viewerId: string; color: string }[]): Promise<void> {
    for (const { viewerId, color } of items) {
      const editor = await this.withEditor(viewerId);
      if (!editor) {
        this.post({ type: "log", level: "warn", message: `recolor: no editor with id ${viewerId}` });
        continue;
      }
      editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
    }
    this.scheduleSnapshot();
  }

  /** Scrolls so the highlight's top-left corner is near the top of the view, then flashes it. */
  goTo(page: number, rect: readonly number[] | undefined, viewerId: string | undefined): void {
    const [x1, , , y2] = rect ?? [];
    this.app.pdfViewer.scrollPageIntoView({
      pageNumber: page,
      destArray:
        x1 !== undefined && y2 !== undefined ? [null, { name: "XYZ" }, x1 - 20, y2 + 20, null] : null,
    });
    const editor = viewerId === undefined ? undefined : this.findEditor(viewerId);
    const div = editor?.div;
    if (div) {
      div.classList.add("pdfCaseReview-flash");
      setTimeout(() => div.classList.remove("pdfCaseReview-flash"), 1_500);
    }
  }

  undo(): void {
    this.uiManager?.undo();
    this.scheduleSnapshot();
  }

  redo(): void {
    this.uiManager?.redo();
    this.scheduleSnapshot();
  }

  private textItems(pageIndex: number): Promise<TextItemGeometry[]> {
    let items = this.textItemsByPage.get(pageIndex);
    if (!items) {
      items = (async () => {
        const pdfDocument = this.app.pdfDocument;
        if (!pdfDocument) {
          return [];
        }
        const page = await pdfDocument.getPage(pageIndex + 1);
        const content = await page.getTextContent();
        return content.items.flatMap((item): TextItemGeometry[] => {
          const str = item["str"];
          const transform = numberList(toPlain(item["transform"]));
          const width = item["width"];
          const height = item["height"];
          if (
            typeof str !== "string" ||
            transform.length < 6 ||
            typeof width !== "number" ||
            typeof height !== "number"
          ) {
            return [];
          }
          return [
            {
              str,
              x: transform[4] ?? 0,
              y: transform[5] ?? 0,
              width,
              height,
              hasEOL: item["hasEOL"] === true,
            },
          ];
        });
      })();
      this.textItemsByPage.set(pageIndex, items);
    }
    return items;
  }

  /** Computes the quad-intersection text once per editor and geometry, then re-snapshots. */
  private async computeQuadText(editorId: string, pageIndex: number, quadPoints: number[], key: string) {
    if (this.quadTextInFlight.has(editorId)) {
      return;
    }
    this.quadTextInFlight.add(editorId);
    try {
      const text = textInQuads(await this.textItems(pageIndex), quadPoints);
      this.quadTextById.set(editorId, { key, text });
      this.scheduleSnapshot();
    } catch (error) {
      this.post({
        type: "log",
        level: "warn",
        message: `quad text for ${editorId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.quadTextInFlight.delete(editorId);
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
    const uiManager = this.uiManager;
    const deletedAnnotationIds = this.annotationIds.filter((id) => uiManager.isDeletedAnnotationElement(id));
    const rendered = [...document.querySelectorAll(".annotationEditorLayer .highlightEditor")].filter(
      (element) => element.getBoundingClientRect().width > 0,
    ).length;
    const json = JSON.stringify({ editors, existingUnchanged, deletedAnnotationIds, rendered });
    if (json !== this.lastSnapshotJson) {
      this.lastSnapshotJson = json;
      this.post({ type: "editorsChanged", editors, existingUnchanged, deletedAnnotationIds, rendered });
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
    // PDF.js keeps the highlighted text private (#text); the aria-label it writes at render time
    // is overwritten by the localized editor name, so the selection pairing above is the source
    // and `quadText` (computed below) is the cross-check and the fallback.
    const serialized: SerializedHighlight = {
      id: editor.annotationElementId ?? editor.id,
      pageIndex: editor.pageIndex,
      color: color.length === 3 ? rgbToHex(color as [number, number, number]) : String(plain["color"]),
      quadPoints: numberList(plain["quadPoints"]),
      rect: numberList(plain["rect"]),
      rotation: typeof plain["rotation"] === "number" ? plain["rotation"] : 0,
      text: this.textById.get(editor.id) ?? null,
      annotationElementId: editor.annotationElementId ?? null,
      raw: plain,
    };
    const sidecarId = this.sidecarIdByEditorId.get(editor.id);
    if (sidecarId !== undefined) {
      serialized.sidecarId = sidecarId;
    }
    if (serialized.quadPoints.length > 0) {
      const key = serialized.quadPoints.join(",");
      const cached = this.quadTextById.get(editor.id);
      if (cached?.key === key) {
        serialized.quadText = cached.text;
      } else {
        void this.computeQuadText(editor.id, editor.pageIndex, serialized.quadPoints, key);
      }
    }
    return serialized;
  }

  /**
   * Spike instrumentation: programmatically select the first `spanCount` non-empty text-layer
   * spans of `page`, exactly as a mouse drag would. Returns false when the page is not rendered.
   */
  spikeSelectText(page: number, spanCount: number): boolean {
    const textLayer = document.querySelector(`.page[data-page-number="${page}"] .textLayer`);
    if (!textLayer) {
      this.post({ type: "log", level: "error", message: `spike: page ${page} text layer missing` });
      return false;
    }
    const spans = [...textLayer.querySelectorAll("span")].filter(
      (span) => (span.textContent ?? "").trim() !== "",
    );
    const first = spans[0];
    const last = spans[Math.min(spanCount, spans.length) - 1];
    if (!first || !last) {
      this.post({ type: "log", level: "error", message: `spike: page ${page} has no text spans` });
      return false;
    }
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const selection = document.getSelection();
    if (!selection) {
      return false;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    this.lastSelection = { text: selection.toString(), at: Date.now() };
    return true;
  }

  /**
   * Spike instrumentation: select text, create a highlight from that selection exactly as the
   * floating button would, and recolor it. Used by the integration tests; harmless otherwise.
   */
  spikeHighlightText(page: number, spanCount: number, color: string): void {
    if (!this.uiManager || !this.spikeSelectText(page, spanCount)) {
      return;
    }
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
