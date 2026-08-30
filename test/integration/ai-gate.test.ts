// M2 phase 4: the eligibility gate and manual hand-off. A wrong requiredAccount email is refused
// (nothing reaches the clipboard, nothing is recorded); the happy path records consent, pastes a
// summary back, and the next report carries the labeled AI section.

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
  waitFor,
  waitForLoaded,
} from "./helpers";

const CLIPBOARD_SENTINEL = "untouched-clipboard-sentinel";

suite("M2 phase 4: AI eligibility gate and manual hand-off", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "ai-gate-test", "case.pdf");
  const configuration = () => vscode.workspace.getConfiguration("pdfCaseReview.ai");

  suiteSetup(async () => {
    await remove(fixtureUri("generated", "ai-gate-test"));
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoConsent", null);
    await configuration().update("requiredAccount", undefined, vscode.ConfigurationTarget.Global);
    await closeAll();
  });

  test("a wrong requiredAccount email is refused and nothing is recorded", async () => {
    await configuration().update(
      "requiredAccount",
      [{ when: {}, email: "right@school.edu" }],
      vscode.ConfigurationTarget.Global,
    );
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoConsent", {
      typedEmail: "wrong@gmail.com",
    });
    await vscode.env.clipboard.writeText(CLIPBOARD_SENTINEL);
    const copied = await vscode.commands.executeCommand<boolean>("pdfCaseReview.ai.copySummaryPrompt");
    assert.equal(copied, false, "the copy command reports refusal");
    assert.equal(await vscode.env.clipboard.readText(), CLIPBOARD_SENTINEL, "the clipboard is untouched");
    const state = await documentState(pdf);
    assert.equal(state?.model.aiConsent, undefined, "no consent is recorded");
  });

  test("the happy path records consent and copies the prompt", async () => {
    await configuration().update("requiredAccount", undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoConsent", {
      typedEmail: "you@school.edu",
    });
    const copied = await vscode.commands.executeCommand<boolean>("pdfCaseReview.ai.copySummaryPrompt");
    assert.equal(copied, true);
    const clipboard = await vscode.env.clipboard.readText();
    assert.ok(clipboard.includes("executive summary"), "the prompt carries the task");
    assert.ok(clipboard.includes("do not invent facts"), "the prompt carries the system rule");
    const state = await waitFor("the consent record", async () => {
      const current = await documentState(pdf);
      return current?.model.aiConsent ? current : undefined;
    });
    assert.equal(state.model.aiConsent?.email, "you@school.edu");
    assert.equal(state.model.aiConsent?.verified, false);
    assert.equal(state.model.aiConsent?.eligibilityConfirmed, true);
    assert.equal(state.model.aiConsent?.provider, "manual");
  });

  test("Paste AI Summary stores the clipboard and the report renders the section", async () => {
    await vscode.env.clipboard.writeText("A crisp executive summary of the case.");
    const pasted = await vscode.commands.executeCommand<boolean>("pdfCaseReview.ai.pasteSummary");
    assert.equal(pasted, true);
    const state = await waitFor("the cached summary", async () => {
      const current = await documentState(pdf);
      return current?.model.aiSummary ? current : undefined;
    });
    assert.equal(state.model.aiSummary?.provider, "manual");
    assert.equal(state.model.aiSummary?.account, "you@school.edu");
    const target = await vscode.commands.executeCommand<vscode.Uri>(
      "pdfCaseReview.generateReport",
      "markdown",
    );
    assert.ok(target);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
    assert.ok(text.includes("A crisp executive summary of the case."), "the summary is in the report");
    assert.ok(text.toLowerCase().includes("manual"), "the section is stamped with its provider");
  });
});
