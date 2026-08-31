// M2 phase 1: page and document notes. Commands driven with explicit args, the tree's
// document-notes group and page-note rows, the status bar count, and the saved sidecar.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import type { Sidecar } from "../../src/core/sidecar/types";
import type { TreeSnapshot as TreeViewSnapshot } from "../../src/extension/views/highlightsTree";
import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  openWith,
  waitFor,
  waitForLoaded,
} from "./helpers";

interface TreeSnapshot extends TreeViewSnapshot {
  statusText: string | null;
}

async function treeSnapshot(): Promise<TreeSnapshot> {
  const snapshot = await vscode.commands.executeCommand<TreeSnapshot>("pdfCaseReview.debug.getTreeSnapshot");
  assert.ok(snapshot);
  return snapshot;
}

suite("M2 phase 1: page and document notes", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "notes-test", "case.pdf");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("Add Document Note creates the note, the tree group and the status bar count", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.addDocumentNote", "Thesis", "Hold price.");
    const state = await waitFor("the document note in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.documentNotes?.length === 1 ? current : undefined;
    });
    assert.equal(state.dirty, true);
    assert.equal(state.model.documentNotes?.[0]?.title, "Thesis");
    const snapshot = await waitFor("the Document notes group", async () => {
      const current = await treeSnapshot();
      return current.groups.some((group) => group.label === "Document notes") ? current : undefined;
    });
    assert.deepEqual(
      snapshot.groups[0]?.children.map((child) => child.label),
      ["Thesis"],
    );
    assert.match(snapshot.statusText ?? "", /0 highlights, 1 note ·/);
  });

  test("Add Page Note stores one note per page and updates it in place", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.addPageNote", 2, "Margin bridge here.");
    const created = await waitFor("the page note in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.pageNotes?.length === 1 ? current : undefined;
    });
    const before = created.model.pageNotes?.[0];
    assert.equal(before?.page, 2);
    await vscode.commands.executeCommand("pdfCaseReview.addPageNote", 2, "Margin bridge lives here.");
    const updated = await waitFor("the page note to update in place", async () => {
      const current = await documentState(pdf);
      return current?.model.pageNotes?.[0]?.note === "Margin bridge lives here." ? current : undefined;
    });
    assert.equal(updated.model.pageNotes?.length, 1);
    assert.equal(updated.model.pageNotes?.[0]?.createdAt, before?.createdAt);
  });

  test("page grouping shows the page-note row on a page without highlights", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.groupByPage");
    const snapshot = await waitFor("page grouping with the note row", async () => {
      const current = await treeSnapshot();
      return current.groupBy === "page" && current.groups.some((group) => group.label === "Page 2")
        ? current
        : undefined;
    });
    const pageTwo = snapshot.groups.find((group) => group.label === "Page 2");
    assert.equal(pageTwo?.description, "1 note");
    assert.match(pageTwo?.children[0]?.label ?? "", /Margin bridge/);
    await vscode.commands.executeCommand("pdfCaseReview.groupByCategory");
    await waitFor("category grouping", async () =>
      (await treeSnapshot()).groupBy === "category" ? true : undefined,
    );
  });

  test("notes land in the saved sidecar", async () => {
    await vscode.commands.executeCommand("workbench.action.files.save");
    const state = await waitFor("a clean document", async () => {
      const current = await documentState(pdf);
      return current && !current.dirty ? current : undefined;
    });
    const text = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.parse(state.sidecarUri)),
    );
    const sidecar = JSON.parse(text) as Sidecar;
    assert.equal(sidecar.documentNotes?.[0]?.title, "Thesis");
    assert.equal(sidecar.pageNotes?.[0]?.note, "Margin bridge lives here.");
  });

  test("an empty page note removes it and Delete Note removes a document note", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.addPageNote", 2, "");
    await waitFor("the page note to disappear", async () => {
      const current = await documentState(pdf);
      return current && current.model.pageNotes === undefined ? current : undefined;
    });
    const state = await documentState(pdf);
    const id = state?.model.documentNotes?.[0]?.id;
    assert.ok(id);
    await vscode.commands.executeCommand("pdfCaseReview.deleteNote", { kind: "documentNote", id });
    await waitFor("the document note to disappear", async () => {
      const current = await documentState(pdf);
      return current && current.model.documentNotes === undefined ? current : undefined;
    });
    const snapshot = await treeSnapshot();
    assert.equal(snapshot.groups.length, 0);
    assert.match(snapshot.statusText ?? "", /0 highlights ·/);
  });
});
