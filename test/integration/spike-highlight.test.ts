// Spike 1 + 3 (see docs/explanation/decisions.md): the vendored PDF.js viewer must load inside
// the VS Code webview CSP with our category palette, create a highlight from a text selection,
// and report the serialized editor back to the extension host.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import {
  closeAll,
  fixtureUri,
  openWith,
  request,
  send,
  sleep,
  viewerState,
  waitFor,
  waitForLoaded,
} from "./helpers";

const EXPECTED_PALETTE = "fact=#FFFF98,financial=#53FFBC,strategic=#80EBFF,concern=#FF4F5F,question=#FFCBE6";

suite("PDF Case Review editor", () => {
  const uri = fixtureUri("generated", "sample-case.pdf");

  suiteSetup(async () => {
    await openWith(uri);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("loads the fixture under the webview CSP with the category palette", async () => {
    const state = await waitForLoaded(uri);
    assert.equal(state.pagesCount, 3);
    assert.equal(state.annotationEditorMode, 0, "editor mode NONE keeps the floating button available");
    assert.equal(state.highlightEditorColors, EXPECTED_PALETTE);
  });

  test("creates a highlight from a text selection and reports it back", async () => {
    // The text layer lays out some time after the viewer reports loaded; posting the highlight
    // before it exists selects nothing and no editor ever appears (the macos-latest flake).
    await waitFor(
      "page 1 text layer",
      async () => {
        const probe = await request(uri, { type: "spike.probeTextLayer", page: 1 });
        return probe.ok ? probe : undefined;
      },
      30_000,
    );
    // Acknowledged request plus one retry, as in helpers.highlight(): an unfocused window (the
    // macos-latest runner) can drop the DOM selection, in which case no editor is ever created
    // and a fire-and-forget send would swallow the webview's error.
    const reached = async () => {
      const current = await viewerState(uri);
      return current && current.editors.length > 0 ? current : undefined;
    };
    const create = () =>
      request(uri, { type: "spike.highlightText", page: 1, spanCount: 2, color: "#53FFBC" });
    const result = await create();
    if (!result.ok) {
      try {
        await waitFor("a highlight editor after a failed acknowledgement", reached, 3_000);
      } catch {
        const retry = await create();
        if (!retry.ok) {
          throw new Error(`spike.highlightText failed twice: ${retry.error ?? result.error ?? "unknown"}`);
        }
      }
    }
    const state = await waitFor("a highlight editor", reached);
    const [highlight] = state.editors;
    assert.ok(highlight);
    assert.equal(highlight.pageIndex, 0);
    assert.equal(highlight.color, "#53FFBC");
    assert.ok(
      highlight.quadPoints.length > 0 && highlight.quadPoints.length % 8 === 0,
      "quadPoints come in 8s",
    );
    assert.ok(highlight.text && highlight.text.length > 0, "selected text is captured");
    assert.equal(highlight.annotationElementId, null, "a new editor is not file-backed");
    assert.equal(highlight.raw["annotationType"], 9, "AnnotationEditorType.HIGHLIGHT");
  });

  test("keeps highlights when the tab is hidden and shown again", async () => {
    const before = await viewerState(uri);
    assert.ok(before && before.editors.length > 0, "precondition: a highlight exists");
    const loadsBefore = before.loads;

    await vscode.commands.executeCommand("workbench.action.files.newUntitledFile");
    await sleep(1_500);
    await openWith(uri);
    await sleep(1_500);
    await send(uri, { type: "dumpEditors" });
    await sleep(500);

    const after = await viewerState(uri);
    assert.ok(after);
    assert.equal(after.loads, loadsBefore, "webview must not be rebuilt when its tab is hidden");
    assert.equal(after.editors.length, before.editors.length, "highlights survive hiding the tab");
    assert.ok(
      after.rendered >= after.editors.length,
      "highlights are drawn (visible DOM editors) after re-show",
    );
  });
});
