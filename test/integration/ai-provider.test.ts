// M2 phase 5: summarizeWithAi with the provider off (the CI-reachable path; real CLI spawns are
// exercised manually). The command points at the provider picker and touches nothing.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { closeAll, copyFixture, documentState, fixtureUri, openWith, remove, waitForLoaded } from "./helpers";

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

  test("with provider off, summarizeWithAi declines and leaves the model untouched", async () => {
    const result = await vscode.commands.executeCommand<boolean>("pdfCaseReview.summarizeWithAi");
    assert.equal(result, false);
    const state = await documentState(pdf);
    assert.equal(state?.model.aiSummary, undefined);
    assert.equal(state?.model.aiConsent, undefined);
  });
});
