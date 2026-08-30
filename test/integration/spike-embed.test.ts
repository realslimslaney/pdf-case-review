// Spike 4 (see docs/explanation/decisions.md): highlights written into a PDF with pdf-lib must
// come back from PDF.js as annotations with predictable ids, become editable editors in
// highlight mode, and survive PDF.js's own incremental save. Spike 4b: an encrypted PDF must still
// open, accept highlights, and be saved by PDF.js *with its encryption intact*.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import {
  type EmbeddableHighlight,
  embedHighlights,
  isProtectedPdf,
  readEmbeddedHighlights,
} from "../../src/core/pdfExport/embedHighlights";
import { closeAll, fixtureUri, openWith, send, viewerState, waitFor, waitForLoaded } from "./helpers";

const HIGHLIGHT_MODE = 9;

const HIGHLIGHTS: EmbeddableHighlight[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    page: 1,
    rect: [72, 684, 500, 700],
    quadPoints: [72, 700, 500, 700, 72, 684, 500, 684],
    color: "#53FFBC",
    note: "Gross margin fell — the core tension.",
    categoryName: "Financial",
    updatedAt: "2026-09-01T14:05:10Z",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    page: 2,
    rect: [72, 684, 400, 700],
    quadPoints: [72, 700, 400, 700, 72, 684, 400, 684],
    color: "#FF4F5F",
    note: "",
    categoryName: "Concern",
    updatedAt: "2026-09-01T14:06:00Z",
  },
];

suite("Spike 4: embedded highlights round-trip", () => {
  const sourceUri = fixtureUri("generated", "sample-case.pdf");
  const embeddedUri = fixtureUri("generated", "sample-case.embedded.pdf");
  let written: { id: string; pdfjsId: string }[] = [];

  suiteSetup(async () => {
    const source = await vscode.workspace.fs.readFile(sourceUri);
    const result = await embedHighlights(source, HIGHLIGHTS, { author: "spike" });
    written = result.written;
    await vscode.workspace.fs.writeFile(embeddedUri, result.bytes);
    await openWith(embeddedUri);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("PDF.js reports the embedded highlights with the ids pdf-lib predicted", async () => {
    const state = await waitForLoaded(embeddedUri);
    assert.equal(state.loads, 1, "the freshly written file must not trigger a spurious reload");
    assert.equal(state.annotations.length, 2);
    assert.deepEqual(
      state.annotations.map((annotation) => annotation.id).sort(),
      written.map((entry) => entry.pdfjsId).sort(),
    );
    const first = state.annotations.find((annotation) => annotation.id === written[0]?.pdfjsId);
    assert.ok(first);
    assert.equal(first.pageIndex, 0);
    assert.equal(first.color, "#53FFBC");
    assert.equal(first.contents, HIGHLIGHTS[0]?.note);
    assert.equal(first.quadPoints.length, 8);
  });

  test("entering highlight mode turns the embedded annotations into editors", async () => {
    await send(embeddedUri, { type: "setEditorMode", mode: HIGHLIGHT_MODE });
    const state = await waitFor("editors for embedded annotations", async () => {
      const current = await viewerState(embeddedUri);
      return current && current.existingUnchanged.length + current.editors.length >= 2 ? current : undefined;
    });
    const editorIds = [...state.existingUnchanged, ...state.editors.map((editor) => editor.id)].sort();
    assert.deepEqual(editorIds, written.map((entry) => entry.pdfjsId).sort());
  });

  test("recoloring an embedded highlight serializes with the annotation id", async () => {
    const target = written[1]?.pdfjsId;
    assert.ok(target);
    await send(embeddedUri, { type: "spike.recolorEditor", id: target, color: "#80EBFF" });
    const state = await waitFor("recolored editor", async () => {
      const current = await viewerState(embeddedUri);
      return current?.editors.some((editor) => editor.id === target && editor.color === "#80EBFF")
        ? current
        : undefined;
    });
    const edited = state.editors.find((editor) => editor.id === target);
    assert.ok(edited);
    assert.equal(edited.raw["id"], target, "serialize() carries the annotation id for edited annotations");
    assert.equal(edited.annotationElementId, target, "the editor reports which annotation it backs");
    assert.equal(edited.pageIndex, 1);
  });

  test("PDF.js saveDocument() keeps our annotations and applies the edit", async () => {
    await send(embeddedUri, { type: "saveDocument" });
    const state = await waitFor("saved bytes", async () => {
      const current = await viewerState(embeddedUri);
      return current?.lastSave ? current : undefined;
    });
    assert.equal(state.lastSave?.error, null);
    assert.ok(state.lastSave?.bytes && state.lastSave.byteLength > 0);
    const embedded = await readEmbeddedHighlights(state.lastSave.bytes);
    assert.deepEqual(embedded.map((entry) => entry.id).sort(), HIGHLIGHTS.map((entry) => entry.id).sort());
    const recolored = embedded.find((entry) => entry.id === HIGHLIGHTS[1]?.id);
    assert.equal(recolored?.color, "#80EBFF", "incremental save wrote the new color");
  });
});

suite("Spike 4b: encrypted (publisher-style) PDF", () => {
  const encryptedUri = fixtureUri("static", "encrypted-case.pdf");

  suiteSetup(async () => {
    await openWith(encryptedUri);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("opens with an empty user password and accepts a highlight", async () => {
    const loaded = await waitForLoaded(encryptedUri);
    assert.equal(loaded.pagesCount, 3);
    await send(encryptedUri, { type: "spike.highlightText", page: 1, spanCount: 2, color: "#FFFF98" });
    const state = await waitFor("a highlight on the encrypted PDF", async () => {
      const current = await viewerState(encryptedUri);
      return current && current.editors.length > 0 ? current : undefined;
    });
    assert.equal(state.editors[0]?.color, "#FFFF98");
  });

  test("pdf-lib refuses to write it; PDF.js saveDocument() preserves the encryption", async () => {
    const original = await vscode.workspace.fs.readFile(encryptedUri);
    assert.equal(await isProtectedPdf(original), true, "fixture is encrypted");

    await send(encryptedUri, { type: "saveDocument" });
    const state = await waitFor("saved encrypted bytes", async () => {
      const current = await viewerState(encryptedUri);
      return current?.lastSave ? current : undefined;
    });
    assert.equal(state.lastSave?.error, null, "PDF.js could save an encrypted document");
    assert.ok(state.lastSave?.bytes && state.lastSave.byteLength > original.byteLength);
    assert.equal(await isProtectedPdf(state.lastSave.bytes), true, "saved bytes are still encrypted");
  });
});
