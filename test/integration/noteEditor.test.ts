// M2 phase 2: the note editor view. editNote resolves targets, and view messages injected through
// the debug seam mutate the model exactly like the real webview would. Every mutating message is
// addressed (document plus target), so a save flushed after a target switch still lands.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import type { NoteEditorState } from "../../src/extension/views/noteEditorView";
import type { NoteTarget } from "../../src/shared/noteEditorProtocol";
import {
  closeAll,
  copyFixture,
  documentState,
  fixtureUri,
  highlight,
  openWith,
  waitFor,
  waitForLoaded,
} from "./helpers";

async function editorState(): Promise<NoteEditorState> {
  const state = await vscode.commands.executeCommand<NoteEditorState>(
    "pdfCaseReview.debug.getNoteEditorState",
  );
  assert.ok(state);
  return state;
}

async function postToEditor(message: unknown): Promise<void> {
  await vscode.commands.executeCommand("pdfCaseReview.debug.postNoteEditorMessage", message);
}

suite("M2 phase 2: note editor view", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "note-editor-test", "case.pdf");
  const documentUri = () => pdf.toString();

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await openWith(pdf);
    await waitForLoaded(pdf);
    await highlight(pdf, 1, "#53FFBC", 1);
  });

  suiteTeardown(async () => {
    await closeAll();
  });

  test("editNote targets a highlight and saveNote persists through the view", async () => {
    const state = await documentState(pdf);
    const id = state?.model.highlights[0]?.id;
    assert.ok(id);
    await vscode.commands.executeCommand("pdfCaseReview.editNote", id);
    const target: NoteTarget = { kind: "highlight", id };
    const editor = await waitFor("the view to hold the highlight", async () => {
      const current = await editorState();
      return current.target?.kind === "highlight" && current.target.id === id ? current : undefined;
    });
    assert.equal(editor.lastLoad?.categoryId, "financial");
    assert.equal(editor.lastLoad?.documentUri, documentUri());
    assert.ok(editor.lastLoad?.quote, "the quote preview is filled");
    await postToEditor({ type: "saveNote", documentUri: documentUri(), target, note: "Key tension." });
    const updated = await waitFor("the note in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.highlights[0]?.note === "Key tension." ? current : undefined;
    });
    assert.equal(updated.dirty, true);
  });

  test("setCategory through the view updates the model", async () => {
    const state = await documentState(pdf);
    const id = state?.model.highlights[0]?.id;
    assert.ok(id);
    await postToEditor({
      type: "setCategory",
      documentUri: documentUri(),
      target: { kind: "highlight", id },
      categoryId: "question",
    });
    await waitFor("the category in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.highlights[0]?.categoryId === "question" ? current : undefined;
    });
  });

  test("an addressed save lands even when another target is displayed", async () => {
    const state = await documentState(pdf);
    const id = state?.model.highlights[0]?.id;
    assert.ok(id);
    const displayed = await editorState();
    assert.equal(displayed.target?.kind, "highlight", "the view still displays the highlight");
    // A flush for a page note arriving after the host switched targets: it must still apply.
    await postToEditor({
      type: "saveNote",
      documentUri: documentUri(),
      target: { kind: "page", page: 2 },
      note: "Flushed after the switch.",
    });
    await waitFor("the flushed page note in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.pageNotes?.[0]?.note === "Flushed after the switch." ? current : undefined;
    });
    await postToEditor({
      type: "saveNote",
      documentUri: documentUri(),
      target: { kind: "page", page: 2 },
      note: "",
    });
    await waitFor("the page note removed again", async () => {
      const current = await documentState(pdf);
      return current && current.model.pageNotes === undefined ? current : undefined;
    });
  });

  test("unaddressed or unknown-target messages change nothing", async () => {
    await postToEditor({ type: "saveNote", target: { kind: "page", page: 1 }, note: "x" });
    await postToEditor({
      type: "saveNote",
      documentUri: documentUri(),
      target: { kind: "highlight", id: "aaaaaaaa-0000-4000-8000-000000000009" },
      note: "x",
    });
    const after = await documentState(pdf);
    assert.equal(after?.model.highlights[0]?.note, "Key tension.");
    assert.equal(after?.model.pageNotes, undefined);
  });

  test("a page target edits the page note, and an empty save removes it", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.editNote", { kind: "page", page: 2 });
    const editor = await waitFor("the view to hold page 2", async () => {
      const current = await editorState();
      return current.target?.kind === "page" && current.target.page === 2 ? current : undefined;
    });
    assert.equal(editor.lastLoad?.note, "");
    assert.equal(editor.lastLoad?.title, "Page 2");
    const target: NoteTarget = { kind: "page", page: 2 };
    await postToEditor({ type: "saveNote", documentUri: documentUri(), target, note: "Margin bridge." });
    await waitFor("the page note in the model", async () => {
      const current = await documentState(pdf);
      return current?.model.pageNotes?.[0]?.note === "Margin bridge." ? current : undefined;
    });
    await postToEditor({ type: "saveNote", documentUri: documentUri(), target, note: "" });
    await waitFor("the page note to be removed", async () => {
      const current = await documentState(pdf);
      return current && current.model.pageNotes === undefined ? current : undefined;
    });
  });

  test("switching between targets with identical content still loads the new target", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.editNote", { kind: "page", page: 2 });
    await waitFor("page 2 in the view", async () => {
      const current = await editorState();
      return current.target?.kind === "page" && current.target.page === 2 ? current : undefined;
    });
    // Page 1 has the same empty note and no category, exactly like page 2: the load must not dedup.
    await vscode.commands.executeCommand("pdfCaseReview.editNote", { kind: "page", page: 1 });
    const editor = await waitFor("page 1 in the view", async () => {
      const current = await editorState();
      return current.target?.kind === "page" && current.target.page === 1 ? current : undefined;
    });
    assert.equal(editor.lastLoad?.title, "Page 1", "the load for the new target was posted");
  });

  test("deleteTarget removes a document note and clears the view", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.addDocumentNote", "Thesis", "Hold price.");
    const state = await waitFor("the document note", async () => {
      const current = await documentState(pdf);
      return current?.model.documentNotes?.[0] ? current : undefined;
    });
    const id = state.model.documentNotes?.[0]?.id;
    assert.ok(id);
    await vscode.commands.executeCommand("pdfCaseReview.editNote", { kind: "document", id });
    await waitFor("the view to hold the document note", async () => {
      const current = await editorState();
      return current.target?.kind === "document" ? current : undefined;
    });
    await postToEditor({
      type: "deleteTarget",
      documentUri: documentUri(),
      target: { kind: "document", id },
    });
    await waitFor("the document note to be removed", async () => {
      const current = await documentState(pdf);
      return current && current.model.documentNotes === undefined ? current : undefined;
    });
    assert.equal((await editorState()).target, null);
  });
});
