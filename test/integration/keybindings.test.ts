// M1 phase F: Ctrl+Alt+N highlights the viewer's selection with category N, presets rewrite the
// categories setting, and syncing copies the settings palette into an open document.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import type { Sidecar } from "../../src/core/sidecar/types";
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
  instance: number;
  model: Sidecar;
}

async function dump(uri: vscode.Uri): Promise<string> {
  const viewer = await viewerState(uri);
  const document = await documentState(uri);
  const trace = await vscode.commands.executeCommand<string[]>("pdfCaseReview.debug.getTrace");
  return JSON.stringify(
    {
      instance: document?.instance,
      highlights: document?.model.highlights.map(({ id, categoryId, page }) => ({ id, categoryId, page })),
      editors: viewer?.editors.map(({ id, sidecarId: sid, color }) => ({ id, sid, color })),
      loads: viewer?.loads,
      logs: viewer?.logs,
      trace,
    },
    null,
    2,
  );
}

/** waitFor with the host trace and webview logs attached to a timeout. */
async function waitOrDump<T>(
  uri: vscode.Uri,
  description: string,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  try {
    return await waitFor(description, probe, 30_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await dump(uri)}`);
  }
}

async function documentState(uri: vscode.Uri): Promise<DocumentState | undefined> {
  return vscode.commands.executeCommand<DocumentState | undefined>(
    "pdfCaseReview.debug.getDocumentState",
    uri,
  );
}

suite("Phase F: highlight with category, presets and sync", () => {
  const source = fixtureUri("generated", "sample-case.pdf");
  const pdf = fixtureUri("generated", "keys-test", "case.pdf");
  const configuration = () => vscode.workspace.getConfiguration("pdfCaseReview");

  suiteSetup(async () => {
    await copyFixture(source, pdf);
    await configuration().update("categories", undefined, vscode.ConfigurationTarget.Global);
    await openWith(pdf);
    await waitForLoaded(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    await configuration().update("categories", undefined, vscode.ConfigurationTarget.Global);
  });

  test("Ctrl+Alt+4 turns the current selection into a Concern highlight", async () => {
    await send(pdf, { type: "spike.selectText", page: 1, spanCount: 2 });
    await vscode.commands.executeCommand("pdfCaseReview.highlightWithCategory", { index: 4 });
    const state = await waitOrDump(pdf, "the highlight in the model", async () => {
      const current = await documentState(pdf);
      return current && current.model.highlights.length === 1 ? current : undefined;
    });
    const [created] = state.model.highlights;
    assert.equal(created?.categoryId, "concern");
    assert.ok(created?.text && created.text.length > 0, "selection text captured");
    const viewer = await viewerState(pdf);
    const editor = viewer?.editors.find((entry) => entry.sidecarId === created?.id);
    assert.ok(editor, "the editor carries the id the host assigned");
    assert.equal(editor.color, "#FF4F5F");
  });

  test("without a text selection the shortcut recolors the selected highlight instead", async () => {
    // PDF.js consumed the selection when it created the highlight and left that editor selected.
    await vscode.commands.executeCommand("pdfCaseReview.highlightWithCategory", { index: 1 });
    const state = await waitOrDump(pdf, "the recolor to reach the model", async () => {
      const current = await documentState(pdf);
      return current?.model.highlights[0]?.categoryId === "fact" ? current : undefined;
    });
    assert.equal(state.model.highlights.length, 1, "nothing new was created");
    await sleep(500);
    assert.equal((await documentState(pdf))?.model.highlights.length, 1);
  });

  test("an index past the palette is refused", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.highlightWithCategory", { index: 9 });
    await sleep(500);
    assert.equal((await documentState(pdf))?.model.highlights.length, 1);
  });

  test("Apply Category Preset rewrites the categories setting", async () => {
    await vscode.commands.executeCommand("pdfCaseReview.applyCategoryPreset", "Academic paper", "global");
    const categories = configuration().get<{ id: string }[]>("categories") ?? [];
    assert.deepEqual(
      categories.map((category) => category.id),
      ["claim", "evidence", "method", "limitation", "question"],
    );
  });

  test("Sync Categories from Settings updates the document, saves and reloads the viewer", async () => {
    const loadsBefore = (await viewerState(pdf))?.loads ?? 0;
    await vscode.commands.executeCommand("pdfCaseReview.syncCategoriesFromSettings", "reload");
    const state = await waitFor("the document palette", async () => {
      const current = await documentState(pdf);
      return current?.model.categories[0]?.id === "claim" ? current : undefined;
    });
    assert.equal(state.model.categories.length, 5);
    let reloaded: Awaited<ReturnType<typeof viewerState>>;
    try {
      reloaded = await waitFor(
        "the viewer to reload with the new palette",
        async () => {
          const current = await viewerState(pdf);
          return current?.loaded && current.loads > loadsBefore ? current : undefined;
        },
        30_000,
      );
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await dump(pdf)}`);
    }
    assert.ok(reloaded);
    assert.ok(reloaded.highlightEditorColors?.startsWith("claim=#FFFF98,evidence=#53FFBC"));
    assert.equal((await documentState(pdf))?.dirty, false, "the sync was saved before the reload");
  });
});
