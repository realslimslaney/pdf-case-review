// M2 phase 5 / M4: summarizeWithAi with the provider off (the CI-reachable path; real CLI spawns
// are exercised manually). The command is the front door: it opens the provider picker inline,
// and dismissing the picker declines without touching the model.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  openWith,
  remove,
  waitFor,
  waitForLoaded,
} from "./helpers";

suite("M2 phase 5: AI provider command", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "ai-provider-test", "case.pdf");

  suiteSetup(async () => {
    await remove(fixtureUri("generated", "ai-provider-test"));
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("with provider off, summarizeWithAi opens the picker; dismissing declines untouched", async () => {
    let settled = false;
    let result: unknown;
    const pending = vscode.commands.executeCommand<boolean>("pdfCaseReview.summarizeWithAi").then((value) => {
      settled = true;
      result = value;
    });
    // The command is awaiting the provider QuickPick; dismiss it until the command settles.
    await waitFor("the dismissed picker to settle the command", async () => {
      if (settled) {
        return true;
      }
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      return undefined;
    });
    await pending;
    assert.equal(result, false);
    const state = await documentState(pdf);
    assert.equal(state?.model.aiSummary, undefined);
    assert.equal(state?.model.aiConsent, undefined);
  });
});
