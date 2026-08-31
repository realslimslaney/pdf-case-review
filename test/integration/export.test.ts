// M3 phase 3: Export Annotated PDF. A copy with our annotations embedded lands at the chosen
// path with a sidecar beside it and the source untouched; a protected source is exported as a
// byte-identical copy (never decrypted) whose highlights travel in the sidecar alone.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { readEmbeddedHighlights } from "../../src/core/pdfExport/embedHighlights";
import type { Sidecar } from "../../src/core/sidecar/types";
import { parseSidecar } from "../../src/core/sidecar/validate";
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

async function readSidecar(uri: vscode.Uri): Promise<Sidecar> {
  return parseSidecar(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
}

suite("M3 phase 3: Export Annotated PDF", () => {
  const folder = fixtureUri("generated", "export-test");

  suiteSetup(async () => {
    await remove(folder);
  });

  suiteTeardown(async () => {
    await closeAll();
    await remove(folder);
  });

  test("exports a copy with embedded highlights and a sidecar, leaving the source untouched", async () => {
    const pdf = fixtureUri("generated", "export-test", "case.pdf");
    const destination = fixtureUri("generated", "export-test", "case.annotated.pdf");
    await copyFixture(fixtureUri("generated", "sample-case.pdf"), pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
    await vscode.commands.executeCommand("workbench.action.files.save");
    await waitFor("the document to be clean after save", async () => {
      const state = await documentState(pdf);
      return state && !state.dirty ? state : undefined;
    });
    const sourceBefore = await vscode.workspace.fs.readFile(pdf);

    await vscode.commands.executeCommand("pdfCaseReview.exportAnnotatedPdf", destination);

    const exported = await vscode.workspace.fs.readFile(destination);
    const embedded = await readEmbeddedHighlights(exported);
    const model = await documentState(pdf);
    assert.equal(embedded.length, 1);
    assert.equal(embedded[0]?.id, model?.model.highlights[0]?.id, "the copy carries our uuid as /NM");
    const sidecar = await readSidecar(
      fixtureUri("generated", "export-test", "case.annotated.pdf.review.json"),
    );
    assert.equal(sidecar.source.fileName, "case.annotated.pdf");
    assert.equal(sidecar.highlights.length, 1);
    const sourceAfter = await vscode.workspace.fs.readFile(pdf);
    assert.ok(sameBytes(sourceBefore, sourceAfter), "the source PDF is untouched by the export");
    await closeAll();
  });

  test("a protected source is exported byte-identical, with the highlights in the sidecar alone", async () => {
    const pdf = fixtureUri("generated", "export-test", "protected.pdf");
    const destination = fixtureUri("generated", "export-test", "protected.annotated.pdf");
    await copyFixture(fixtureUri("static", "encrypted-case.pdf"), pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#FF4F5F", 1);

    await vscode.commands.executeCommand("pdfCaseReview.exportAnnotatedPdf", destination);

    const source = await vscode.workspace.fs.readFile(pdf);
    const exported = await vscode.workspace.fs.readFile(destination);
    assert.ok(sameBytes(source, exported), "a protected PDF is copied byte-identical, never rewritten");
    const sidecar = await readSidecar(
      fixtureUri("generated", "export-test", "protected.annotated.pdf.review.json"),
    );
    assert.equal(sidecar.highlights.length, 1);
    assert.equal(sidecar.source.encrypted, true);
    assert.equal(sidecar.source.pdfWrite, "skipped-protected");
    await closeAll();
  });

  test("the original PDF is refused as a destination", async () => {
    const pdf = fixtureUri("generated", "export-test", "case.pdf");
    await openWith(pdf);
    await waitForLoaded(pdf);
    const before = await vscode.workspace.fs.readFile(pdf);
    await vscode.commands.executeCommand("pdfCaseReview.exportAnnotatedPdf", pdf);
    const after = await vscode.workspace.fs.readFile(pdf);
    assert.ok(sameBytes(before, after), "exporting onto the source must not touch it");
  });
});
