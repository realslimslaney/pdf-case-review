// M1 phase B: the custom editor is editable. A highlight makes the document dirty, Save writes
// the sidecar (and only the sidecar; PdfSync is phase C), Revert restores the saved state and
// reloads the viewer, and the `folder` sidecar location works.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { serializeSidecar } from "../../src/core/sidecar/serialize";
import type { Sidecar } from "../../src/core/sidecar/types";
import { parseSidecar } from "../../src/core/sidecar/validate";
import {
  closeAll,
  copyFixture,
  fixtureUri,
  openWith,
  send,
  sleep,
  viewerState,
  waitFor,
  waitForLoaded,
} from "./helpers";

interface DocumentState {
  dirty: boolean;
  readOnly: boolean;
  sidecarUri: string;
  model: Sidecar;
}

async function documentState(uri: vscode.Uri): Promise<DocumentState | undefined> {
  return vscode.commands.executeCommand<DocumentState | undefined>(
    "pdfCaseReview.debug.getDocumentState",
    uri,
  );
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function remove(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true });
  } catch {
    // Nothing to remove.
  }
}

async function highlight(uri: vscode.Uri, page: number, color: string, expectedCount: number): Promise<void> {
  await send(uri, { type: "spike.highlightText", page, spanCount: 2, color });
  await waitFor(`highlight ${expectedCount} in the model`, async () => {
    const state = await documentState(uri);
    return state && state.model.highlights.length >= expectedCount ? state : undefined;
  });
}

suite("Phase B: sidecar save, revert and location", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "save-test", "case with späce.pdf");
  const sidecar = fixtureUri("generated", "save-test", "case with späce.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(sidecar);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("opens clean and does not create a sidecar until something changes", async () => {
    await sleep(500);
    const state = await documentState(pdf);
    assert.ok(state, "document state is available for the open PDF");
    assert.equal(state.dirty, false);
    assert.equal(state.readOnly, false);
    assert.equal(vscode.Uri.parse(state.sidecarUri).fsPath, sidecar.fsPath);
    assert.equal(await exists(sidecar), false);
  });

  test("a highlight makes the document dirty and Save writes the sidecar", async () => {
    await highlight(pdf, 1, "#53FFBC", 1);
    const dirty = await documentState(pdf);
    assert.equal(dirty?.dirty, true, "a new highlight makes the document dirty");

    await vscode.commands.executeCommand("workbench.action.files.save");
    const text = await waitFor("the sidecar to be written", async () =>
      (await exists(sidecar))
        ? new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar))
        : undefined,
    );
    const model = parseSidecar(text);
    assert.equal(model.highlights.length, 1);
    const [entry] = model.highlights;
    assert.ok(entry);
    assert.equal(entry.categoryId, "financial");
    assert.equal(entry.page, 1);
    assert.equal(entry.pageLabel, "i", "page labels from the PDF are recorded");
    assert.equal(entry.kind, "text");
    assert.ok(entry.text.length > 0, "the highlighted text is captured");
    assert.match(entry.pdfjsId ?? "", /^[0-9]+R$/, "the highlight was embedded into the PDF (phase C)");
    assert.equal(model.source.fileName, "case with späce.pdf");
    assert.equal(model.source.pageCount, 3);
    assert.match(model.source.sha256, /^[0-9a-f]{64}$/);
    assert.equal(model.categories.length, 5);
    assert.equal(text, serializeSidecar(model), "the file is in canonical form");
    assert.ok(!text.includes("\r"), "LF line endings");

    const saved = await documentState(pdf);
    assert.equal(saved?.dirty, false, "saving clears the dirty state");
  });

  test("Revert discards unsaved highlights, reloads the viewer and keeps the saved ones", async () => {
    const before = await viewerState(pdf);
    assert.ok(before);
    await highlight(pdf, 2, "#FF4F5F", 2);
    assert.equal((await documentState(pdf))?.dirty, true);

    await vscode.commands.executeCommand("workbench.action.files.revert");
    const after = await waitFor("the viewer to reload", async () => {
      const current = await viewerState(pdf);
      return current?.loaded && current.loads > before.loads ? current : undefined;
    });
    assert.equal(after.loads, before.loads + 1);
    const state = await documentState(pdf);
    assert.equal(state?.dirty, false);
    assert.equal(state?.model.highlights.length, 1, "the saved highlight survives, the unsaved one is gone");
  });
});

suite("Phase B: folder sidecar location", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "save-test", "folder-case.pdf");
  const sidecar = fixtureUri(".pdf-case-review", "generated", "save-test", "folder-case.pdf.review.json");
  const configuration = () => vscode.workspace.getConfiguration("pdfCaseReview.sidecar");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await remove(fixtureUri(".pdf-case-review"));
    await configuration().update("location", "folder", vscode.ConfigurationTarget.Global);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    await configuration().update("location", undefined, vscode.ConfigurationTarget.Global);
    await remove(fixtureUri(".pdf-case-review"));
  });

  test("writes the sidecar under .pdf-case-review mirroring the PDF's relative path", async () => {
    const state = await documentState(pdf);
    assert.equal(vscode.Uri.parse(state?.sidecarUri ?? "").fsPath, sidecar.fsPath);
    await highlight(pdf, 1, "#FFFF98", 1);
    await vscode.commands.executeCommand("workbench.action.files.save");
    const text = await waitFor("the folder sidecar to be written", async () =>
      (await exists(sidecar))
        ? new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar))
        : undefined,
    );
    assert.equal(parseSidecar(text).highlights[0]?.categoryId, "fact");
  });
});
