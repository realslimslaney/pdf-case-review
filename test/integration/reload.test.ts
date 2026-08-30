// M1 phase D: highlights that exist only in the sidecar (protected PDF, embedding off, not saved
// yet) are drawn when the PDF opens (spike 4c); deleting through the host, undo and redo keep
// the model and the viewer in step (spike 3); saving embeds the injected ones and a reopen maps
// them as file annotations.

import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as vscode from "vscode";

import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import { serializeSidecar } from "../../src/core/sidecar/serialize";
import { emptySidecar, type Sidecar, type SidecarHighlight } from "../../src/core/sidecar/types";
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
  model: Sidecar;
}

const KEEP = "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";
const OTHER = "0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f";
const STAMP = "2026-09-01T14:00:00.000Z";

function highlightOn(page: number, id: string, categoryId: string, note: string): SidecarHighlight {
  return {
    id,
    categoryId,
    page,
    rect: [72, 684, 500, 700],
    quadPoints: [72, 700, 500, 700, 72, 684, 500, 684],
    kind: "text",
    text: "Acme Widgets",
    note,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

async function documentState(uri: vscode.Uri): Promise<DocumentState | undefined> {
  return vscode.commands.executeCommand<DocumentState | undefined>(
    "pdfCaseReview.debug.getDocumentState",
    uri,
  );
}

async function writeSidecarFor(pdf: vscode.Uri, sidecar: vscode.Uri, highlights: SidecarHighlight[]) {
  const bytes = await vscode.workspace.fs.readFile(pdf);
  const model = emptySidecar(
    {
      fileName: pdf.path.slice(pdf.path.lastIndexOf("/") + 1),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      pageCount: 3,
    },
    DEFAULT_CATEGORIES,
    "integration-test",
  );
  model.highlights = highlights;
  await vscode.workspace.fs.writeFile(sidecar, new TextEncoder().encode(serializeSidecar(model)));
}

/** Waits until the highlight with `sidecarId` has an injected, drawn editor; dumps diagnostics on timeout. */
async function waitForInjected(uri: vscode.Uri, sidecarId: string) {
  try {
    return await waitFor(
      `injected highlight ${sidecarId} to render`,
      async () => {
        const state = await viewerState(uri);
        const injected = state?.editors.filter((editor) => editor.sidecarId !== undefined) ?? [];
        return state && injected.some((editor) => editor.sidecarId === sidecarId) && state.rendered >= 1
          ? state
          : undefined;
      },
      30_000,
    );
  } catch (error) {
    const state = await viewerState(uri);
    const summary = {
      editors: state?.editors.map(({ id, sidecarId: sid, pageIndex, color }) => ({
        id,
        sid,
        pageIndex,
        color,
      })),
      rendered: state?.rendered,
      logs: state?.logs,
    };
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(summary, null, 2)}`,
    );
  }
}

async function waitForModelCount(uri: vscode.Uri, count: number) {
  return waitFor(`${count} highlight(s) in the model`, async () => {
    const state = await documentState(uri);
    return state && state.model.highlights.length === count ? state : undefined;
  });
}

suite("Phase D: sidecar-only highlights render on open; delete, undo and redo", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "reload-test", "case.pdf");
  const sidecar = fixtureUri("generated", "reload-test", "case.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await writeSidecarFor(pdf, sidecar, [
      highlightOn(1, KEEP, "financial", "keep me"),
      highlightOn(2, OTHER, "concern", ""),
    ]);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("draws the sidecar highlight on the visible page, tagged with its id, without dirtying the document", async () => {
    const state = await waitForInjected(pdf, KEEP);
    assert.equal(state.loads, 1);
    const bySidecarId = new Map(state.editors.map((editor) => [editor.sidecarId, editor]));
    assert.equal(bySidecarId.get(KEEP)?.color, "#53FFBC");
    assert.equal(bySidecarId.get(KEEP)?.pageIndex, 0);
    // Page 2 is only injected once PDF.js renders it, which depends on the viewport; when it has
    // been, it must carry the right tag and color too.
    const other = bySidecarId.get(OTHER);
    if (other) {
      assert.equal(other.color, "#FF4F5F");
      assert.equal(other.pageIndex, 1);
    }
    await sleep(750);
    const document = await documentState(pdf);
    const diagnostics = JSON.stringify(
      {
        model: document?.model.highlights.map(
          ({ id, rect, quadPoints, text, pageLabel, updatedAt, outlines }) => ({
            id,
            rect,
            quadPoints,
            text,
            pageLabel,
            updatedAt,
            hasOutlines: outlines !== undefined,
          }),
        ),
        editors: (await viewerState(pdf))?.editors.map(
          ({ sidecarId: sid, rect, quadPoints, text, quadText }) => ({
            sid,
            rect,
            quadPoints,
            text,
            quadText,
          }),
        ),
      },
      null,
      2,
    );
    assert.equal(document?.dirty, false, `re-serialized geometry must not count as an edit\n${diagnostics}`);
    assert.equal(document?.model.highlights.length, 2);
  });

  test("deleting through the host removes the highlight; undo restores it with its note; redo removes it", async () => {
    const state = await viewerState(pdf);
    const target = state?.editors.find((editor) => editor.sidecarId === KEEP);
    assert.ok(target, "the injected editor for KEEP is known");

    await send(pdf, { type: "deleteHighlights", viewerIds: [target.id] });
    const afterDelete = await waitForModelCount(pdf, 1);
    assert.equal(afterDelete.dirty, true);
    assert.equal(afterDelete.model.highlights[0]?.id, OTHER);

    await send(pdf, { type: "spike.undo" });
    const afterUndo = await waitForModelCount(pdf, 2);
    const restored = afterUndo.model.highlights.find((entry) => entry.id === KEEP);
    assert.ok(restored, "undo brings the same uuid back");
    assert.equal(restored.note, "keep me");
    assert.equal(restored.createdAt, STAMP);

    await send(pdf, { type: "spike.redo" });
    await waitForModelCount(pdf, 1);

    await send(pdf, { type: "spike.undo" });
    await waitForModelCount(pdf, 2);
  });

  test("Save embeds the injected highlights; a reopen shows them as file annotations", async () => {
    await vscode.commands.executeCommand("workbench.action.files.save");
    await waitFor("save to complete", async () => {
      const state = await documentState(pdf);
      return state && !state.dirty ? state : undefined;
    });
    const saved = parseSidecar(new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar)));
    assert.deepEqual(
      saved.highlights.map((entry) => entry.pdfjsId !== undefined),
      [true, true],
      "both highlights are now embedded",
    );

    await closeAll();
    await openWith(pdf);
    const state = await waitForLoaded(pdf);
    assert.deepEqual(
      state.annotations.map((annotation) => annotation.id).sort(),
      saved.highlights.map((entry) => entry.pdfjsId).sort(),
    );
    await sleep(750);
    const reopened = await viewerState(pdf);
    assert.equal(
      reopened?.editors.filter((editor) => editor.sidecarId !== undefined).length,
      0,
      "nothing is injected when the file already holds the annotations",
    );
    assert.equal((await documentState(pdf))?.dirty, false);
  });
});

suite("Phase D: protected PDFs render their sidecar-only highlights", () => {
  const source = fixtureUri("static", "encrypted-case.pdf");
  const pdf = fixtureUri("generated", "reload-test", "protected.pdf");
  const sidecar = fixtureUri("generated", "reload-test", "protected.pdf.review.json");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await writeSidecarFor(pdf, sidecar, [highlightOn(1, KEEP, "question", "on a protected file")]);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("draws the highlight and keeps it sidecar-only across a save", async () => {
    const state = await waitForInjected(pdf, KEEP);
    assert.equal(state.editors.find((editor) => editor.sidecarId === KEEP)?.color, "#FFCBE6");
    await send(pdf, { type: "spike.highlightText", page: 2, spanCount: 2, color: "#FFFF98" });
    await waitForModelCount(pdf, 2);
    await vscode.commands.executeCommand("workbench.action.files.save");
    await waitFor("save to complete", async () => {
      const current = await documentState(pdf);
      return current && !current.dirty ? current : undefined;
    });
    const saved = parseSidecar(new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar)));
    assert.equal(saved.source.pdfWrite, "skipped-protected");
    assert.equal(
      saved.highlights.every((entry) => entry.pdfjsId === undefined),
      true,
    );
    assert.equal((await viewerState(pdf))?.loads, 1, "no reload on a sidecar-only save");
  });
});
