// Spike 1 + 3 (see docs/explanation/decisions.md): the vendored PDF.js viewer must load inside
// the VS Code webview CSP with our category palette, create a highlight from a text selection,
// and report the serialized editor back to the extension host.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import type { HostToWebviewMessage, SerializedHighlight } from "../../src/shared/protocol";

interface ViewerState {
  loaded: boolean;
  loads: number;
  rendered: number;
  pagesCount: number;
  annotationEditorMode: number;
  highlightEditorColors: string | null;
  editors: SerializedHighlight[];
}

const EXPECTED_PALETTE = "fact=#FFFF98,financial=#53FFBC,strategic=#80EBFF,concern=#FF4F5F,question=#FFCBE6";

async function waitFor<T>(
  description: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function fixtureUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace folder missing (expected test/fixtures)");
  return vscode.Uri.joinPath(folder.uri, "generated", "sample-case.pdf");
}

async function viewerState(uri: vscode.Uri): Promise<ViewerState | undefined> {
  return vscode.commands.executeCommand<ViewerState | undefined>("pdfCaseReview.debug.getViewerState", uri);
}

suite("PDF Case Review editor", () => {
  const uri = fixtureUri();

  suiteSetup(async () => {
    await vscode.commands.executeCommand("vscode.openWith", uri, "pdfCaseReview.pdf");
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("loads the fixture under the webview CSP with the category palette", async () => {
    const state = await waitFor("viewer to load", async () => {
      const current = await viewerState(uri);
      return current?.loaded ? current : undefined;
    });
    assert.equal(state.pagesCount, 3);
    assert.equal(state.annotationEditorMode, 0, "editor mode NONE keeps the floating button available");
    assert.equal(state.highlightEditorColors, EXPECTED_PALETTE);
  });

  test("creates a highlight from a text selection and reports it back", async () => {
    const message: HostToWebviewMessage = {
      type: "spike.highlightText",
      page: 1,
      spanCount: 2,
      color: "#53FFBC",
    };
    const delivered = await vscode.commands.executeCommand<number>(
      "pdfCaseReview.debug.postMessage",
      uri,
      message,
    );
    assert.equal(delivered, 1, "exactly one webview should be showing the fixture");

    const state = await waitFor("a highlight editor", async () => {
      const current = await viewerState(uri);
      return current && current.editors.length > 0 ? current : undefined;
    });
    const [highlight] = state.editors;
    assert.ok(highlight);
    assert.equal(highlight.pageIndex, 0);
    assert.equal(highlight.color, "#53FFBC");
    assert.ok(
      highlight.quadPoints.length > 0 && highlight.quadPoints.length % 8 === 0,
      "quadPoints come in 8s",
    );
    assert.ok(highlight.text && highlight.text.length > 0, "selected text is captured");
    assert.equal(highlight.raw["annotationType"], 9, "AnnotationEditorType.HIGHLIGHT");
  });

  test("keeps highlights when the tab is hidden and shown again", async () => {
    const before = await viewerState(uri);
    assert.ok(before && before.editors.length > 0, "precondition: a highlight exists");
    const loadsBefore = before.loads;

    await vscode.commands.executeCommand("workbench.action.files.newUntitledFile");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await vscode.commands.executeCommand("vscode.openWith", uri, "pdfCaseReview.pdf");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await vscode.commands.executeCommand("pdfCaseReview.debug.postMessage", uri, { type: "dumpEditors" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = await viewerState(uri);
    assert.ok(after);
    assert.equal(after.loads, loadsBefore, "webview must not be rebuilt when its tab is hidden");
    assert.equal(after.editors.length, before.editors.length, "highlights survive hiding the tab");
    assert.ok(
      after.rendered >= after.editors.length,
      "highlights are drawn (visible DOM editors) after re-show",
    );
  });
});
