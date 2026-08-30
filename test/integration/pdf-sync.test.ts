// M1 phase C: the dual-write sync (ADR-0002). Save embeds highlights into an unencrypted PDF as
// real annotations without reloading the viewer, re-syncs without duplicating, maps annotations
// back to the sidecar on reopen, rebuilds a missing sidecar from the PDF, and leaves the PDF
// alone when embedding is off or the file is protected.

import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  sleep,
  viewerState,
  waitFor,
  waitForLoaded,
} from "./helpers";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

async function saveAndRead(uri: vscode.Uri, sidecar: vscode.Uri): Promise<Sidecar> {
  await vscode.commands.executeCommand("workbench.action.files.save");
  await waitFor("the document to be clean after save", async () => {
    const state = await documentState(uri);
    return state && !state.dirty ? state : undefined;
  });
  return parseSidecar(new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar)));
}

function isOpenInTab(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputCustom && tab.input.uri.fsPath === uri.fsPath,
    ),
  );
}

suite("Phase C: PdfSync embeds highlights on save", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "sync-test", "case.pdf");
  const sidecar = fixtureUri("generated", "sync-test", "case.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(sidecar);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("Save writes the sidecar and embeds the highlight into the PDF without reloading the viewer", async () => {
    await highlight(pdf, 1, "#53FFBC", 1);
    const loadsBefore = (await viewerState(pdf))?.loads;

    const model = await saveAndRead(pdf, sidecar);
    const file = await vscode.workspace.fs.readFile(pdf);
    const embedded = await readEmbeddedHighlights(file);
    assert.equal(embedded.length, 1);
    assert.equal(embedded[0]?.id, model.highlights[0]?.id, "the annotation carries our uuid as /NM");
    assert.equal(embedded[0]?.categoryName, "Financial");
    assert.equal(model.highlights[0]?.pdfjsId, embedded[0]?.pdfjsId, "pdfjsId matches what pdf-lib wrote");
    assert.equal(model.source.sha256, sha256(file), "source.sha256 is the hash of the rewritten PDF");
    assert.equal(model.source.byteLength, file.byteLength);
    assert.equal(model.source.pdfWrite, "synced");
    assert.ok(model.source.lastEmbeddedAt, "lastEmbeddedAt is recorded");

    await sleep(1_500);
    const after = await viewerState(pdf);
    assert.equal(after?.loads, loadsBefore, "the self-write must not reload the viewer");
    assert.ok(isOpenInTab(pdf), "the editor tab survives the rewrite of the PDF");
  });

  test("a second Save re-syncs without duplicating annotations", async () => {
    await highlight(pdf, 2, "#FF4F5F", 2);
    const model = await saveAndRead(pdf, sidecar);
    const embedded = await readEmbeddedHighlights(await vscode.workspace.fs.readFile(pdf));
    assert.equal(embedded.length, 2, "ours are stripped and rewritten, never duplicated");
    assert.deepEqual(
      embedded.map((entry) => entry.id).sort(),
      model.highlights.map((entry) => entry.id).sort(),
    );
    assert.deepEqual(
      embedded.map((entry) => entry.pdfjsId).sort(),
      model.highlights.map((entry) => entry.pdfjsId).sort(),
      "pdfjsIds are refreshed after every embed",
    );
  });

  test("reopening maps the embedded annotations back to the sidecar highlights", async () => {
    await closeAll();
    await openWith(pdf);
    const state = await waitForLoaded(pdf);
    const document = await documentState(pdf);
    assert.ok(document);
    assert.equal(document.dirty, false);
    assert.deepEqual(
      state.annotations.map((annotation) => annotation.id).sort(),
      document.model.highlights.map((entry) => entry.pdfjsId).sort(),
      "PDF.js reports exactly the annotation ids the sidecar recorded",
    );
  });

  test("a missing sidecar is rebuilt from the annotations in the PDF", async () => {
    const before = await documentState(pdf);
    assert.ok(before);
    await closeAll();
    await remove(sidecar);
    await openWith(pdf);
    await waitForLoaded(pdf);
    const rebuilt = await documentState(pdf);
    assert.ok(rebuilt);
    assert.equal(rebuilt.dirty, false);
    assert.deepEqual(
      rebuilt.model.highlights.map((entry) => entry.id).sort(),
      before.model.highlights.map((entry) => entry.id).sort(),
      "the uuids come back from /NM",
    );
    assert.equal(rebuilt.model.highlights.find((entry) => entry.page === 2)?.categoryId, "concern");
    await highlight(pdf, 3, "#FFFF98", 3);
    const model = await saveAndRead(pdf, sidecar);
    assert.equal(model.highlights.length, 3);
  });
});

suite("Phase C: embedOnSave off keeps the PDF byte-identical", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "sync-test", "no-embed.pdf");
  const sidecar = fixtureUri("generated", "sync-test", "no-embed.pdf.review.json");
  const configuration = () => vscode.workspace.getConfiguration("pdfCaseReview.pdf");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(sidecar);
    await configuration().update("embedOnSave", false, vscode.ConfigurationTarget.Global);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    await configuration().update("embedOnSave", undefined, vscode.ConfigurationTarget.Global);
  });

  test("Save records skipped-setting and leaves the PDF untouched", async () => {
    const original = await vscode.workspace.fs.readFile(source);
    await highlight(pdf, 1, "#80EBFF", 1);
    const model = await saveAndRead(pdf, sidecar);
    assert.equal(model.source.pdfWrite, "skipped-setting");
    assert.equal(model.highlights[0]?.pdfjsId, undefined);
    assert.ok(sameBytes(await vscode.workspace.fs.readFile(pdf), original), "PDF bytes unchanged");
  });
});

suite("Phase C: protected PDFs are never modified", () => {
  const source = fixtureUri("static", "encrypted-case.pdf");
  const pdf = fixtureUri("generated", "sync-test", "protected.pdf");
  const sidecar = fixtureUri("generated", "sync-test", "protected.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(sidecar);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("Save degrades to sidecar-only and records the protection", async () => {
    const original = await vscode.workspace.fs.readFile(source);
    await highlight(pdf, 1, "#FFCBE6", 1);
    const model = await saveAndRead(pdf, sidecar);
    assert.equal(model.source.pdfWrite, "skipped-protected");
    assert.equal(model.source.encrypted, true);
    assert.equal(model.highlights[0]?.categoryId, "question");
    assert.equal(model.highlights[0]?.pdfjsId, undefined);
    assert.ok(sameBytes(await vscode.workspace.fs.readFile(pdf), original), "protected PDF bytes unchanged");
  });
});
