// M3 phase 4: the hash-mismatch warning. A PDF changed outside the extension warns on open with
// "Keep positions"; accepting records the current bytes with the next save; dismissing leaves the
// sidecar as it was so the warning returns. A normal save and reopen never warns.

import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as vscode from "vscode";

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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function traceLines(): Promise<string[]> {
  return (await vscode.commands.executeCommand<string[]>("pdfCaseReview.debug.getTrace")) ?? [];
}

async function save(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.files.save");
  await waitFor("the document to be clean after save", async () => {
    const state = await documentState(uri);
    return state && !state.dirty ? state : undefined;
  });
}

suite("M3 phase 4: hash-mismatch warning on open", () => {
  const pdf = fixtureUri("generated", "hash-test", "case.pdf");

  suiteSetup(async () => {
    await remove(fixtureUri("generated", "hash-test"));
    await copyFixture(fixtureUri("generated", "sample-case.pdf"), pdf);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoHashMismatch", null);
    await closeAll();
  });

  test("a normal save and reopen does not warn", async () => {
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
    await save(pdf);
    await closeAll();
    await openWith(pdf);
    await waitForLoaded(pdf);
    const trace = await traceLines();
    assert.ok(
      !trace.some((line) => line.includes("hashMismatch")),
      `no mismatch expected, trace: ${trace.join("\n")}`,
    );
    assert.equal((await documentState(pdf))?.dirty, false);
    await closeAll();
  });

  test("an external change warns; dismissing keeps the sidecar as it was", async () => {
    const changed = new Uint8Array([...(await vscode.workspace.fs.readFile(pdf)), 0x0a, 0x25, 0x25]);
    await vscode.workspace.fs.writeFile(pdf, changed);
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoHashMismatch", "dismiss");
    await openWith(pdf);
    await waitForLoaded(pdf);
    await waitFor("the mismatch trace entry", async () =>
      (await traceLines()).some((line) => line.includes("hashMismatch")) ? true : undefined,
    );
    const state = await documentState(pdf);
    assert.equal(state?.dirty, false, "dismissing must not change the model");
    assert.notEqual(state?.model.source.sha256, sha256(changed));
    await closeAll();
  });

  test("Keep positions records the current bytes with the next save", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.debug.autoHashMismatch", "keep");
    await openWith(pdf);
    await waitForLoaded(pdf);
    await waitFor("the keep-positions trace entry", async () =>
      (await traceLines()).some((line) => line.includes("keepPositions")) ? true : undefined,
    );
    assert.equal((await documentState(pdf))?.dirty, true, "accepting makes the document saveable");
    await save(pdf);
    const bytes = await vscode.workspace.fs.readFile(pdf);
    const sidecar = parseSidecar(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(fixtureUri("generated", "hash-test", "case.pdf.review.json")),
      ),
    );
    assert.equal(sidecar.source.sha256, sha256(bytes), "the accepted hash is persisted");
    assert.equal(sidecar.highlights.length, 1, "the highlight kept its recorded position");
    await closeAll();
  });
});
