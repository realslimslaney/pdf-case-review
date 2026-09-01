// Everything that touches PDF.js editor internals lives here (ADR-0003). If an upgrade breaks
// the highlight editor, this is the one file to fix, or to swap for an overlay-based adapter.

import type { PdfJsApplication, PdfJsEditor, PdfJsUiManager } from "pdfjs-viewer";

import { rgbToHex } from "../core/categories";
import { type TextItemGeometry, textInQuads } from "../core/text/quadText";
import type {
  EmbeddedAnnotation,
  InjectableHighlight,
  SerializedHighlight,
  ViewerCategory,
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
  /** Editors already reported once; only a first sighting may pair with the last selection. */
  private readonly seenEditorIds = new Set<string>();
  /** A default category chosen before PDF.js built its UI manager; applied on arrival. */
  private pendingDefaultColor: string | null = null;

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
      if (this.pendingDefaultColor !== null && this.uiManager) {
        this.uiManager.updateParams(PARAMS_HIGHLIGHT_COLOR, this.pendingDefaultColor);
        this.pendingDefaultColor = null;
      }
    });
    for (const name of ["editingstateschanged", "annotationeditormodechanged"]) {
      eventBus.on(name, () => this.scheduleSnapshot());
    }
    for (const name of ["pagerendered", "editorsrendered"]) {
      eventBus.on(name, () => this.scheduleSnapshot());
    }
    // A page's editor layer exists only after annotationeditorlayerrendered (pagerendered fires
    // before it is built); editorsrendered covers layers enabled by a mode switch.
    for (const name of ["annotationeditorlayerrendered", "editorsrendered"]) {
      eventBus.on(name, (event) => {
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
    const [annotations, pageLabels, title] = await Promise.all([
      this.collectHighlightAnnotations(),
      this.app.pdfDocument?.getPageLabels() ?? null,
      this.documentTitle(),
    ]);
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
    this.seenEditorIds.clear();
    this.post({
      type: "viewerLoaded",
      pagesCount: this.app.pdfViewer.pagesCount,
      pageLabels,
      title,
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

  /**
   * Highlight annotations already present in the file, straight from the PDF.js document proxy.
   * A 300-page document means 300 getPage plus getAnnotations round trips, so pages are read with
   * bounded concurrency; the indexed array keeps the result in page order.
   */
  private async collectHighlightAnnotations(): Promise<EmbeddedAnnotation[]> {
    const pdfDocument = this.app.pdfDocument;
    if (!pdfDocument) {
      return [];
    }
    const perPage: EmbeddedAnnotation[][] = Array.from({ length: pdfDocument.numPages }, () => []);
    let nextPageIndex = 0;
    const worker = async () => {
      while (nextPageIndex < pdfDocument.numPages) {
        const pageIndex = nextPageIndex;
        nextPageIndex += 1;
        const page = await pdfDocument.getPage(pageIndex + 1);
        for (const annotation of await page.getAnnotations()) {
          if (annotation["subtype"] !== "Highlight" || typeof annotation["id"] !== "string") {
            continue;
          }
          const contents = annotation["contentsObj"] as { str?: unknown } | undefined;
          perPage[pageIndex]?.push({
            id: annotation["id"],
            pageIndex,
            rect: numberList(toPlain(annotation["rect"])),
            quadPoints: numberList(toPlain(annotation["quadPoints"])),
            color: colorToHex(annotation["color"]),
            contents: typeof contents?.str === "string" ? contents.str : "",
            modificationDate:
              typeof annotation["modificationDate"] === "string" ? annotation["modificationDate"] : null,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, pdfDocument.numPages) }, worker));
    return perPage.flat();
  }

  setEditorMode(mode: number): void {
    this.app.eventBus.dispatch("switchannotationeditormode", { source: this, mode });
  }

  /** Every editor PDF.js currently holds, page by page. */
  private *editors(): Iterable<PdfJsEditor> {
    if (!this.uiManager) {
      return;
    }
    for (let pageIndex = 0; pageIndex < this.app.pdfViewer.pagesCount; pageIndex += 1) {
      yield* this.uiManager.getEditors(pageIndex);
    }
  }

  /** Finds an editor by our id: the annotation id for file-backed editors, else PDF.js's editor id. */
  private findEditor(id: string): PdfJsEditor | undefined {
    for (const editor of this.editors()) {
      if (editor.annotationElementId === id || editor.id === id) {
        return editor;
      }
    }
    return undefined;
  }

  private editorIdForSidecar(sidecarId: string): string | undefined {
    for (const [editorId, candidate] of this.sidecarIdByEditorId) {
      if (candidate === sidecarId) {
        return editorId;
      }
    }
    return undefined;
  }

  /** Events after which PDF.js may have created or materialized editors. */
  private static readonly EDITOR_EVENTS = [
    "editingstateschanged",
    "editorsrendered",
    "annotationeditorlayerrendered",
    "annotationeditormodechanged",
  ];

  /**
   * Resolves once `probe` yields a value: immediately, after any editor-related event (deferred a
   * tick so PDF.js finishes its own handlers first), or from a coarse safety re-probe for the few
   * creation paths that fire no event. PDF.js defers creation behind mode switches, and a large
   * document can take longer than any fixed poll budget, hence the event-driven wait.
   */
  private awaitEditor<T>(probe: () => T | undefined, timeoutMs = 5_000): Promise<T | undefined> {
    const immediate = probe();
    if (immediate !== undefined) {
      return Promise.resolve(immediate);
    }
    const { eventBus } = this.app;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T | undefined) => {
        if (!settled) {
          settled = true;
          clearTimeout(deadline);
          clearInterval(safetyNet);
          for (const name of PdfjsAdapter.EDITOR_EVENTS) {
            eventBus.off(name, onEvent);
          }
          resolve(value);
        }
      };
      const reprobe = () => {
        const value = probe();
        if (value !== undefined) {
          finish(value);
        }
      };
      const onEvent = () => setTimeout(reprobe, 0);
      const deadline = setTimeout(() => finish(probe()), timeoutMs);
      const safetyNet = setInterval(reprobe, 250);
      for (const name of PdfjsAdapter.EDITOR_EVENTS) {
        eventBus.on(name, onEvent);
      }
    });
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
        // Not an edit: PDF.js's onceAdded() would register an undo command and focus the editor
        // on every attach (the layer re-adds every editor when a page is recycled), so it is
        // neutralized on the instance before the first add().
        editor.onceAdded = () => {};
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
   * highlight mode PDF.js keeps them as plain annotation elements without editors, and it only
   * materializes annotations on pages whose layer has been rendered.
   */
  private async withEditor(viewerId: string): Promise<PdfJsEditor | undefined> {
    const editor = this.findEditor(viewerId);
    if (editor || !this.uiManager || !/^[0-9]+R/.test(viewerId)) {
      return editor;
    }
    if (this.uiManager.getMode() !== ANNOTATION_EDITOR_TYPE_HIGHLIGHT) {
      this.setEditorMode(ANNOTATION_EDITOR_TYPE_HIGHLIGHT);
    }
    return this.awaitEditor(() => this.findEditor(viewerId));
  }

  /** Runs `work` and puts the editor mode back afterwards when materializing had to switch it. */
  private async keepingMode<T>(work: () => Promise<T>): Promise<T> {
    const before = this.uiManager?.getMode();
    try {
      return await work();
    } finally {
      if (before !== undefined && this.uiManager && this.uiManager.getMode() !== before) {
        this.setEditorMode(before);
      }
    }
  }

  private cancelInjection(sidecarId: string): void {
    for (const [pageIndex, queue] of this.pendingInjections) {
      this.pendingInjections.set(
        pageIndex,
        queue.filter((item) => item.sidecarId !== sidecarId),
      );
    }
    this.injectedSidecarIds.add(sidecarId);
  }

  /**
   * Deletes highlights through PDF.js so the deletion lands on its undo stack, and reports the
   * ones it could not reach (no editor: the host removes those from the model itself).
   */
  async deleteHighlights(items: readonly { sidecarId: string; viewerId?: string }[]): Promise<void> {
    const deleted: string[] = [];
    const failed: string[] = [];
    await this.keepingMode(async () => {
      for (const item of items) {
        this.cancelInjection(item.sidecarId);
        const viewerId = item.viewerId ?? this.editorIdForSidecar(item.sidecarId);
        const editor = viewerId === undefined ? undefined : await this.withEditor(viewerId);
        if (!editor || !this.uiManager) {
          failed.push(item.sidecarId);
          continue;
        }
        this.uiManager.setSelected(editor);
        this.uiManager.delete();
        deleted.push(item.sidecarId);
      }
      this.uiManager?.unselectAll();
    });
    this.scheduleSnapshot();
    this.post({ type: "highlightsDeleted", deleted, failed });
  }

  async recolorHighlights(items: readonly { viewerId: string; color: string }[]): Promise<void> {
    await this.keepingMode(async () => {
      for (const { viewerId, color } of items) {
        const editor = await this.withEditor(viewerId);
        if (!editor) {
          this.post({ type: "log", level: "warn", message: `recolor: no editor with id ${viewerId}` });
          continue;
        }
        editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
      }
    });
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

  /** Answers a host `getPageText` request; null when the page has no text layer or the read fails. */
  async getPageText(requestId: number, page: number): Promise<void> {
    try {
      const items = await this.textItems(page - 1);
      const text = items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(" ");
      this.post({ type: "pageText", requestId, page, text: items.length > 0 ? text : null });
    } catch {
      this.post({ type: "pageText", requestId, page, text: null });
    }
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
    for (const editor of this.editors()) {
      const serialized = this.serialize(editor);
      if (serialized) {
        editors.push(serialized);
      } else if (editor.annotationElementId) {
        existingUnchanged.push(editor.annotationElementId);
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
    // Pair the last selection only with an editor the viewer itself just created: injected or
    // file-backed editors would otherwise adopt whatever the user selected last.
    const firstSighting = !this.seenEditorIds.has(editor.id);
    this.seenEditorIds.add(editor.id);
    if (
      firstSighting &&
      !editor.annotationElementId &&
      !this.sidecarIdByEditorId.has(editor.id) &&
      !this.textById.has(editor.id) &&
      this.lastSelection &&
      Date.now() - this.lastSelection.at <= SELECTION_PAIRING_WINDOW_MS
    ) {
      this.textById.set(editor.id, this.lastSelection.text);
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

  /** The page's non-empty text-layer spans; throws while the layer is not laid out yet. */
  private textLayerSpans(page: number): HTMLElement[] {
    const textLayer = document.querySelector(`.page[data-page-number="${page}"] .textLayer`);
    if (!textLayer) {
      throw new Error(`spike: page ${page} text layer missing`);
    }
    const spans = [...textLayer.querySelectorAll("span")].filter(
      (span) => (span.textContent ?? "").trim() !== "",
    );
    if (spans.length === 0) {
      throw new Error(`spike: page ${page} has no text spans`);
    }
    return spans;
  }

  /**
   * Spike instrumentation: a readiness probe with no side effect. Never selects anything: in
   * highlight mode PDF.js turns a fresh selection into a highlight of its own.
   */
  spikeProbeTextLayer(page: number): void {
    this.textLayerSpans(page);
  }

  /**
   * Spike instrumentation: programmatically select the first `spanCount` non-empty text-layer
   * spans of `page`, exactly as a mouse drag would. Throws when the page's text layer is not
   * laid out yet, so a request-acknowledged caller sees a typed failure it can retry.
   */
  spikeSelectText(page: number, spanCount: number): void {
    const spans = this.textLayerSpans(page);
    const first = spans[0];
    const last = spans[Math.min(spanCount, spans.length) - 1];
    if (!first || !last) {
      throw new Error(`spike: page ${page} has no text spans`);
    }
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const selection = document.getSelection();
    if (!selection) {
      throw new Error("spike: the document has no selection object");
    }
    selection.removeAllRanges();
    selection.addRange(range);
    this.lastSelection = { text: selection.toString(), at: Date.now() };
  }

  private allEditorIds(): Set<string> {
    return new Set([...this.editors()].map((editor) => editor.id));
  }

  /**
   * Creates a highlight from the viewer's current text selection the way the floating button does,
   * in `color`, tagged with `sidecarId` when the host pre-assigned one. PDF.js 6.3 has no
   * HIGHLIGHT_DEFAULT_COLOR param: the default is set through `updateParams` with nothing selected,
   * and creation is deferred behind a mode switch, so the new editor is polled for and recolored.
   */
  private async createHighlightFromSelection(color: string, sidecarId?: string): Promise<PdfJsEditor[]> {
    const selection = document.getSelection();
    if (!this.uiManager || !selection || selection.isCollapsed || selection.toString().trim() === "") {
      return [];
    }
    const uiManager = this.uiManager;
    const text = selection.toString();
    this.lastSelection = { text, at: Date.now() };
    const before = this.allEditorIds();
    // Without an editor selection updateParams sets the default color (there is no
    // HIGHLIGHT_DEFAULT_COLOR param in PDF.js 6.3); with one it would recolor that editor, so the
    // new editor is recolored afterwards instead. Nothing here may await before highlightSelection:
    // the pending selectionchange event would otherwise create a highlight of its own.
    if (!uiManager.hasSelection) {
      uiManager.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
    }
    uiManager.highlightSelection("keyboard");
    // The mode switch also materializes file-backed annotations as editors; only viewer-created
    // editors that were not there before are the new highlight.
    const created =
      (await this.awaitEditor(() => {
        const fresh = [...this.editors()].filter(
          (editor) => !before.has(editor.id) && !editor.annotationElementId,
        );
        return fresh.length > 0 ? fresh : undefined;
      })) ?? [];
    this.post({
      type: "log",
      level: "info",
      message: `create from selection: ${before.size} editor(s) before, ${created.length} created (${created.map((editor) => editor.id).join(", ")}), mode ${uiManager.getMode()}`,
    });
    for (const editor of created) {
      this.textById.set(editor.id, text);
      if (colorToHex(editor.serialize(false)?.["color"]) !== color.toUpperCase()) {
        editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
      }
      if (sidecarId !== undefined) {
        this.sidecarIdByEditorId.set(editor.id, sidecarId);
      }
    }
    this.scheduleSnapshot();
    return created;
  }

  /**
   * The Ctrl+Alt+N path: a text selection becomes a highlight of that category; failing that, the
   * editors PDF.js has selected are recolored, or the host's fallback target (PDF.js drops editor
   * selection when the window loses focus, so the host passes what it considers selected); with
   * no target at all the color becomes the default for the next highlight.
   */
  async applyCategory(id: string, color: string, fallbackViewerId?: string): Promise<void> {
    const created = await this.createHighlightFromSelection(color, id);
    if (created.length > 0) {
      this.post({ type: "createFromSelectionResult", id, created: true, recolored: false });
      return;
    }
    let recolored = false;
    if (this.uiManager?.hasSelection) {
      this.uiManager.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
      recolored = true;
    } else if (fallbackViewerId !== undefined) {
      const editor = await this.keepingMode(() => this.withEditor(fallbackViewerId));
      if (editor) {
        editor.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
        recolored = true;
      }
    } else {
      this.uiManager?.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
    }
    this.scheduleSnapshot();
    this.post({ type: "createFromSelectionResult", id, created: false, recolored });
  }

  /**
   * The category dropdown injected into the PDF.js toolbar at load; the vendor drop stays
   * untouched. Selecting a category makes its color the default for new highlights (with nothing
   * left selected, `updateParams` only sets the default; there is no HIGHLIGHT_DEFAULT_COLOR in
   * PDF.js 6.3). The PDF.js color pickers dispatch `switchannotationeditorparams` on every pick,
   * which keeps the dropdown in sync; picker swatches carry our category ids as their `title`
   * (the id doubles as the color name in `highlightEditorColors`), so the observer swaps in the
   * display names PDF.js has no localization for.
   */
  installCategoryToolbar(categories: readonly ViewerCategory[]): void {
    const anchor = document.getElementById("editorModeButtons");
    const first = categories[0];
    if (!anchor?.parentElement || !first) {
      return;
    }
    const byColor = new Map(categories.map((category) => [category.color.toUpperCase(), category]));
    const bar = document.createElement("div");
    bar.id = "pdfCaseReviewCategoryBar";
    bar.className = "toolbarHorizontalGroup";
    const swatch = document.createElement("span");
    swatch.id = "pdfCaseReviewCategorySwatch";
    swatch.ariaHidden = "true";
    const select = document.createElement("select");
    select.id = "pdfCaseReviewCategorySelect";
    select.title = "Category for new highlights";
    select.setAttribute("aria-label", "Category for new highlights");
    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category.color.toUpperCase();
      option.textContent = category.name;
      select.append(option);
    }
    const show = (color: string) => {
      select.value = color.toUpperCase();
      swatch.style.backgroundColor = color;
    };
    show(first.color);
    select.addEventListener("change", () => {
      swatch.style.backgroundColor = select.value;
      this.setDefaultCategory(select.value);
    });
    bar.append(swatch, select);
    anchor.parentElement.insertBefore(bar, anchor);
    this.app.eventBus.on("switchannotationeditorparams", (event) => {
      const value = event["value"];
      // With editors selected the pick recolors those, not the default; the dropdown keeps saying
      // what the next highlight will be.
      if (
        event["type"] === PARAMS_HIGHLIGHT_COLOR &&
        typeof value === "string" &&
        byColor.has(value.toUpperCase()) &&
        !this.uiManager?.hasSelection
      ) {
        show(value);
      }
    });
    const picker = document.getElementById("editorHighlightParamsToolbar");
    if (picker) {
      new MutationObserver(() => {
        for (const button of picker.querySelectorAll<HTMLButtonElement>(".dropdown button[data-color]")) {
          const category = byColor.get((button.dataset["color"] ?? "").toUpperCase());
          if (category && button.title !== category.name) {
            button.title = category.name;
            button.setAttribute("aria-label", category.name);
            button.removeAttribute("data-l10n-id");
          }
        }
      }).observe(picker, { childList: true, subtree: true });
    }
  }

  /** Make `color` the default for new highlights; anything selected is released first. */
  setDefaultCategory(color: string): void {
    if (!this.uiManager) {
      this.pendingDefaultColor = color;
      return;
    }
    this.uiManager.unselectAll();
    this.uiManager.updateParams(PARAMS_HIGHLIGHT_COLOR, color);
  }

  /** Spike: highlight the current selection with the default color, as a mouse selection would. */
  async spikeHighlightDefault(page: number, spanCount: number): Promise<void> {
    this.spikeSelectText(page, spanCount);
    const uiManager = this.uiManager;
    if (!uiManager) {
      throw new Error("spike: no uiManager");
    }
    const before = this.allEditorIds();
    uiManager.highlightSelection("spike");
    const created = await this.awaitEditor(() => {
      const fresh = [...this.editors()].filter(
        (editor) => !before.has(editor.id) && !editor.annotationElementId,
      );
      return fresh.length > 0 ? fresh : undefined;
    });
    if (!created || created.length === 0) {
      throw new Error("spike: no highlight editor was created");
    }
    this.scheduleSnapshot();
  }

  /**
   * Spike instrumentation: select text and create a highlight from that selection exactly as the
   * floating button would. Used by the integration tests; harmless otherwise.
   */
  async spikeHighlightText(page: number, spanCount: number, color: string): Promise<void> {
    this.spikeSelectText(page, spanCount);
    const created = await this.createHighlightFromSelection(color);
    if (created.length === 0) {
      throw new Error("spike: no highlight editor was created");
    }
  }
}
