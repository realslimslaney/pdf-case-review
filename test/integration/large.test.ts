// M3 phase 6: large PDFs. The 300-page fixture loads inside the suite budget (guarding the
// bounded-concurrency annotation collection), highlighting and saving work at that size, and
// the viewer can still read text from the last page.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  highlight,
  openWith,
  remove,
  request,
  waitFor,
  waitForLoaded,
} from "./helpers";

suite("M3 phase 6: 300-page document", () => {
  const folder = fixtureUri("generated", "large-test");
  const pdf = fixtureUri("generated", "large-test", "case.pdf");

  suiteSetup(async () => {
    await remove(folder);
    await copyFixture(fixtureUri("generated", "large-case.pdf"), pdf);
    await openWith(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    await remove(folder);
  });

  test("loads all 300 pages", async () => {
    const state = await waitForLoaded(pdf);
    assert.equal(state.pagesCount, 300);
  });

  test("highlight and save work at this size", async () => {
    await highlight(pdf, 1, "#53FFBC", 1);
    await vscode.commands.executeCommand("workbench.action.files.save");
    const state = await waitFor("the document to be clean after save", async () => {
      const current = await documentState(pdf);
      return current && !current.dirty ? current : undefined;
    });
    assert.equal(state.model.highlights.length, 1);
    assert.equal(state.model.source.pdfWrite, "synced");
  });

  test("the viewer answers page text for the last page", async () => {
    // goTo renders page 300; getPageText reads from the document proxy either way.
    await request(pdf, { type: "goTo", page: 300 });
    const probe = await waitFor("page 300 text layer", async () => {
      const result = await request(pdf, { type: "spike.probeTextLayer", page: 300 });
      return result.ok ? result : undefined;
    });
    assert.ok(probe.ok);
  });
});
