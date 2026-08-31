// The webview message boundary: every field the host folds into the model is checked, so a
// malformed or hostile payload is dropped before it can reach the sidecar.

import { describe, expect, it } from "vitest";

import { isWebviewToHostMessage } from "../../src/shared/protocol";

const editor = {
  id: "pdfjs_internal_editor_0",
  pageIndex: 0,
  color: "#FFFF98",
  quadPoints: [1, 2, 3, 4, 5, 6, 7, 8],
  rect: [1, 2, 3, 4],
  rotation: 0,
  text: "quoted",
  annotationElementId: null,
  raw: {},
};

describe("isWebviewToHostMessage", () => {
  it("accepts messages without a payload", () => {
    expect(isWebviewToHostMessage({ type: "ready" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "saveRequested" })).toBe(true);
  });

  it("rejects non-objects and unknown types", () => {
    expect(isWebviewToHostMessage(null)).toBe(false);
    expect(isWebviewToHostMessage("ready")).toBe(false);
    expect(isWebviewToHostMessage([])).toBe(false);
    expect(isWebviewToHostMessage({ type: "nonsense" })).toBe(false);
    expect(isWebviewToHostMessage({ type: 7 })).toBe(false);
  });

  it("checks every editorsChanged field, not just the discriminant", () => {
    const message = {
      type: "editorsChanged",
      editors: [editor],
      existingUnchanged: ["12R"],
      deletedAnnotationIds: [],
      rendered: 1,
    };
    expect(isWebviewToHostMessage(message)).toBe(true);
    expect(isWebviewToHostMessage({ ...message, rendered: "1" })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, existingUnchanged: [12] })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, editors: [{ ...editor, quadPoints: ["a"] }] })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, editors: [{ ...editor, raw: "raw" }] })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, editors: [{ ...editor, text: 7 }] })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, editors: [{ ...editor, sidecarId: 7 }] })).toBe(false);
  });

  it("checks viewerLoaded payloads including the embedded annotations", () => {
    const annotation = {
      id: "12R",
      pageIndex: 2,
      rect: [1, 2, 3, 4],
      quadPoints: [1, 2, 3, 4, 5, 6, 7, 8],
      color: "#53FFBC",
      contents: "",
      modificationDate: null,
    };
    const message = {
      type: "viewerLoaded",
      pagesCount: 3,
      pageLabels: ["i", "1", "2"],
      title: null,
      annotationEditorMode: 0,
      highlightEditorColors: "fact=#FFFF98",
      annotations: [annotation],
    };
    expect(isWebviewToHostMessage(message)).toBe(true);
    expect(isWebviewToHostMessage({ ...message, pageLabels: null })).toBe(true);
    expect(isWebviewToHostMessage({ ...message, pageLabels: [1] })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, pagesCount: "3" })).toBe(false);
    expect(isWebviewToHostMessage({ ...message, annotations: [{ ...annotation, id: 12 }] })).toBe(false);
  });

  it("checks the small payloads", () => {
    expect(isWebviewToHostMessage({ type: "pageChanged", page: 2, pageLabel: "ii" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "pageChanged", page: "2", pageLabel: null })).toBe(false);
    expect(isWebviewToHostMessage({ type: "highlightsDeleted", deleted: ["a"], failed: [] })).toBe(true);
    expect(isWebviewToHostMessage({ type: "highlightsDeleted", deleted: "a", failed: [] })).toBe(false);
    expect(
      isWebviewToHostMessage({ type: "createFromSelectionResult", id: "a", created: true, recolored: false }),
    ).toBe(true);
    expect(
      isWebviewToHostMessage({
        type: "createFromSelectionResult",
        id: "a",
        created: "yes",
        recolored: false,
      }),
    ).toBe(false);
    expect(isWebviewToHostMessage({ type: "openLink", url: "https://example.test" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "openLink" })).toBe(false);
    expect(isWebviewToHostMessage({ type: "pageText", requestId: 1, page: 1, text: null })).toBe(true);
    expect(isWebviewToHostMessage({ type: "pageText", requestId: 1, page: 1, text: 7 })).toBe(false);
    expect(isWebviewToHostMessage({ type: "log", level: "warn", message: "m" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "log", level: "debug", message: "m" })).toBe(false);
  });

  it("checks done acknowledgements", () => {
    expect(isWebviewToHostMessage({ type: "done", requestId: 3, ok: true })).toBe(true);
    expect(isWebviewToHostMessage({ type: "done", requestId: 3, ok: false, error: "boom" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "done", requestId: "3", ok: true })).toBe(false);
    expect(isWebviewToHostMessage({ type: "done", requestId: 3, ok: false, error: 7 })).toBe(false);
  });

  it("checks savedDocument bytes loosely (the host re-wraps them)", () => {
    expect(isWebviewToHostMessage({ type: "savedDocument", bytes: null, error: "no document" })).toBe(true);
    expect(isWebviewToHostMessage({ type: "savedDocument", bytes: new Uint8Array(2), error: null })).toBe(
      true,
    );
    expect(isWebviewToHostMessage({ type: "savedDocument", bytes: "AAAA", error: null })).toBe(false);
  });
});
