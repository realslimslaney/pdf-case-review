// M1 phase E: the Highlights view and its commands. Grouping by category and page, set category
// (model and viewer), go to (viewer scrolls), delete (through the viewer), copy quote, status bar.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import type { TreeSnapshot as TreeViewSnapshot } from "../../src/extension/views/highlightsTree";
import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  highlight,
  openWith,
  viewerState,
  waitFor,
  waitForLoaded,
} from "./helpers";

interface TreeSnapshot extends TreeViewSnapshot {
  activeUri: string | null;
  statusText: string | null;
}

async function treeSnapshot(): Promise<TreeSnapshot> {
  const snapshot = await vscode.commands.executeCommand<TreeSnapshot>("pdfCaseReview.debug.getTreeSnapshot");
  assert.ok(snapshot);
  return snapshot;
}

suite("Phase E: Highlights view and commands", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "tree-test", "case.pdf");
  const configuration = () => vscode.workspace.getConfiguration("pdfCaseReview.highlights");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await configuration().update("groupBy", undefined, vscode.ConfigurationTarget.Global);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
    await highlight(pdf, 2, "#FF4F5F", 2);
  });

  suiteTeardown(async () => {
    await closeAll();
    await configuration().update("groupBy", undefined, vscode.ConfigurationTarget.Global);
  });

  test("groups by category in palette order with counts, quotes and citations", async () => {
    const snapshot = await waitFor("the tree to show both highlights", async () => {
      const current = await treeSnapshot();
      return current.groups.reduce((sum, group) => sum + group.children.length, 0) === 2
        ? current
        : undefined;
    });
    assert.equal(snapshot.groupBy, "category");
    assert.equal(snapshot.activeUri, pdf.toString());
    assert.deepEqual(
      snapshot.groups.map((group) => [group.label, group.description]),
      [
        ["Financial", "1 highlight"],
        ["Concern", "1 highlight"],
      ],
    );
    const [financial] = snapshot.groups;
    assert.ok(financial?.children[0]?.label.length, "the row shows the quote");
    assert.equal(financial?.children[0]?.description, "p. i [1]", "page labels are used in citations");
    assert.match(snapshot.statusText ?? "", /^\$\(notebook\) 2 highlights · unsaved$/);
  });

  test("Group by Page regroups the view and is remembered in the setting", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.groupByPage");
    const snapshot = await waitFor("page grouping", async () => {
      const current = await treeSnapshot();
      return current.groupBy === "page" ? current : undefined;
    });
    assert.equal(snapshot.groups.length, 2);
    assert.equal(snapshot.groups[0]?.label, "Page i [1]");
    assert.equal(configuration().get("groupBy"), "page");
    await vscode.commands.executeCommand("pdfCaseReview.groupByCategory");
    await waitFor("category grouping", async () =>
      (await treeSnapshot()).groupBy === "category" ? true : undefined,
    );
  });

  test("Set Category updates the model, recolors the editor and moves the row", async () => {
    const before = await documentState(pdf);
    const target = before?.model.highlights.find((entry) => entry.page === 1);
    assert.ok(target);
    await vscode.commands.executeCommand("pdfCaseReview.setCategory", target.id, "question");
    const state = await waitFor("the category change", async () => {
      const current = await documentState(pdf);
      return current?.model.highlights.find((entry) => entry.id === target.id)?.categoryId === "question"
        ? current
        : undefined;
    });
    assert.equal(state.dirty, true);
    await waitFor("the viewer to recolor the editor", async () => {
      const current = await viewerState(pdf);
      return current?.editors.some((editor) => editor.pageIndex === 0 && editor.color === "#FFCBE6")
        ? current
        : undefined;
    });
    const snapshot = await waitFor("the tree to regroup", async () => {
      const current = await treeSnapshot();
      return current.groups.some((group) => group.label === "Question") ? current : undefined;
    });
    assert.deepEqual(
      snapshot.groups.map((group) => group.label),
      ["Concern", "Question"],
    );
  });

  test("Go to Highlight scrolls the viewer to the highlight's page", async () => {
    const state = await documentState(pdf);
    const onPageTwo = state?.model.highlights.find((entry) => entry.page === 2);
    const onPageOne = state?.model.highlights.find((entry) => entry.page === 1);
    assert.ok(onPageTwo && onPageOne);
    await vscode.commands.executeCommand("pdfCaseReview.goToHighlight", onPageTwo.id);
    await waitFor("page 2", async () => ((await viewerState(pdf))?.currentPage === 2 ? true : undefined));
    await vscode.commands.executeCommand("pdfCaseReview.goToHighlight", onPageOne.id);
    await waitFor("page 1", async () => ((await viewerState(pdf))?.currentPage === 1 ? true : undefined));
  });

  test("Copy Quote puts the highlighted text on the clipboard", async () => {
    const state = await documentState(pdf);
    const target = state?.model.highlights.find((entry) => entry.page === 2);
    assert.ok(target);
    await vscode.commands.executeCommand("pdfCaseReview.copyQuote", target.id);
    assert.equal(await vscode.env.clipboard.readText(), target.text);
  });

  test("Delete Highlight removes it through the viewer and from the tree", async () => {
    const state = await documentState(pdf);
    const target = state?.model.highlights.find((entry) => entry.page === 2);
    assert.ok(target);
    await vscode.commands.executeCommand("pdfCaseReview.deleteHighlight", target.id);
    await waitFor("the model to drop the highlight", async () => {
      const current = await documentState(pdf);
      return current && current.model.highlights.length === 1 ? current : undefined;
    });
    const snapshot = await waitFor("the tree to drop the row", async () => {
      const current = await treeSnapshot();
      return current.groups.length === 1 ? current : undefined;
    });
    assert.equal(snapshot.groups[0]?.label, "Question");
    assert.match(snapshot.statusText ?? "", /1 highlight · unsaved/);
  });
});
