// The injected category dropdown's seam: `setDefaultCategory` decides what a plain highlight
// (no explicit color, as a mouse selection via the floating button) becomes. The dropdown's DOM
// itself is covered by the Playwright webview smoke.

import * as assert from "node:assert/strict";

import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  openWith,
  remove,
  request,
  waitFor,
  waitForLoaded,
} from "./helpers";

suite("viewer toolbar: default category", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "toolbar-test", "case.pdf");
  const sidecar = fixtureUri("generated", "toolbar-test", "case.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(sidecar);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("a highlight created with the default color lands in the chosen category", async () => {
    await waitFor(
      "page 1 text layer",
      async () => {
        const probe = await request(pdf, { type: "spike.probeTextLayer", page: 1 });
        return probe.ok ? probe : undefined;
      },
      30_000,
    );
    const set = await request(pdf, { type: "setDefaultCategory", color: "#FF4F5F" });
    assert.equal(set.ok, true, set.error ?? "setDefaultCategory failed");
    const created = await request(pdf, { type: "spike.highlightDefault", page: 1, spanCount: 2 });
    assert.equal(created.ok, true, created.error ?? "spike.highlightDefault failed");
    const state = await waitFor("the highlight in the model", async () => {
      const current = await documentState(pdf);
      return current && current.model.highlights.length === 1 ? current : undefined;
    });
    assert.equal(state.model.highlights[0]?.categoryId, "concern");
    assert.ok((state.model.highlights[0]?.text ?? "").length > 0, "the selected text is captured");
  });
});
