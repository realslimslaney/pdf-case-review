// M2 phase 3: the report commands. Explicit format args drive the QuickPick-free path; the output
// lands beside the PDF, numbered copies instead of overwrites, and every format renders.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { closeAll, copyFixture, fixtureUri, highlight, openWith, remove, waitForLoaded } from "./helpers";

suite("M2 phase 3: report generation", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const folder = fixtureUri("generated", "report-test");
  const pdf = fixtureUri("generated", "report-test", "case.pdf");

  suiteSetup(async () => {
    await remove(folder);
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
    await vscode.commands.executeCommand("pdfCaseReview.addDocumentNote", "Thesis", "Hold price.");
    await vscode.commands.executeCommand("pdfCaseReview.addPageNote", 2, "Margin bridge.");
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("Generate Report writes <basename>.review.md beside the PDF", async () => {
    const target = await vscode.commands.executeCommand<vscode.Uri>(
      "pdfCaseReview.generateReport",
      "markdown",
    );
    assert.ok(target);
    assert.match(target.path, /report-test\/case\.review\.md$/);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
    assert.match(text, /^# case/m);
    assert.ok(text.includes("Thesis"), "document notes are in the report");
    assert.ok(text.includes("Margin bridge."), "page notes are in the report");
    assert.ok(text.includes("Financial"), "the summary table names the category");
  });

  test("a second run writes a numbered copy instead of overwriting", async () => {
    const target = await vscode.commands.executeCommand<vscode.Uri>(
      "pdfCaseReview.generateReport",
      "markdown",
    );
    assert.match(target?.path ?? "", /case\.review\.2\.md$/);
  });

  test("Generate Report As renders Word and PDF", async () => {
    const word = await vscode.commands.executeCommand<vscode.Uri>("pdfCaseReview.generateReportAs", "docx");
    assert.ok(word);
    const wordBytes = await vscode.workspace.fs.readFile(word);
    assert.deepEqual(Array.from(wordBytes.slice(0, 2)), [0x50, 0x4b], "docx starts with the zip header");
    const report = await vscode.commands.executeCommand<vscode.Uri>("pdfCaseReview.generateReportAs", "pdf");
    assert.ok(report);
    const pdfBytes = await vscode.workspace.fs.readFile(report);
    assert.deepEqual(Array.from(pdfBytes.slice(0, 4)), [0x25, 0x50, 0x44, 0x46], "pdf magic bytes");
  });
});
