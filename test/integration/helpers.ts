// Shared helpers for the headless VS Code integration tests (Mocha, tdd UI). Everything goes
// through the extension's debug commands, so the tests never import extension code at runtime.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Sidecar } from "../../src/core/sidecar/types";
import type { ViewerState } from "../../src/extension/editor/pdfCaseReviewEditorProvider";
import type { HostToWebviewMessage } from "../../src/shared/protocol";

export type { ViewerState };

export const VIEW_TYPE = "pdfCaseReview.pdf";

export async function waitFor<T>(
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
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fixturesFolder(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace folder missing (expected test/fixtures)");
  return folder.uri;
}

/** A path under test/fixtures, e.g. `fixtureUri("generated", "sample-case.pdf")`. */
export function fixtureUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(fixturesFolder(), ...segments);
}

/** What `pdfCaseReview.debug.getDocumentState` returns. */
export interface DocumentState {
  dirty: boolean;
  instance: number;
  readOnly: boolean;
  sidecarUri: string;
  model: Sidecar;
}

export async function documentState(uri: vscode.Uri): Promise<DocumentState | undefined> {
  return vscode.commands.executeCommand<DocumentState | undefined>(
    "pdfCaseReview.debug.getDocumentState",
    uri,
  );
}

/** Posts a message with a `requestId` and returns the viewer's acknowledgement. */
export async function request(
  uri: vscode.Uri,
  message: HostToWebviewMessage,
): Promise<{ delivered: number; ok: boolean; error?: string }> {
  const result = await vscode.commands.executeCommand<{ delivered: number; ok: boolean; error?: string }>(
    "pdfCaseReview.debug.request",
    uri,
    message,
  );
  assert.ok(result, "debug.request returned nothing");
  return result;
}

/** Creates a highlight from the first two text spans of `page` and waits for the model to hold it. */
export async function highlight(
  uri: vscode.Uri,
  page: number,
  color: string,
  expectedCount: number,
): Promise<void> {
  // The page's text layer lays out some time after the viewer reports loaded; wait for it instead
  // of posting into the void (the historic windows-latest flake in the save suite). The probe
  // makes no selection: in highlight mode PDF.js would turn one into a highlight of its own.
  await waitFor(
    `page ${page} text layer`,
    async () => {
      const probe = await request(uri, { type: "spike.probeTextLayer", page });
      return probe.ok ? probe : undefined;
    },
    30_000,
  );
  const reached = async () => {
    const state = await documentState(uri);
    return state && state.model.highlights.length >= expectedCount ? state : undefined;
  };
  const result = await request(uri, { type: "spike.highlightText", page, spanCount: 2, color });
  if (!result.ok) {
    // A failed acknowledgement can still mean the editor landed late; only retry (which would
    // create a duplicate otherwise) when the model provably stayed short.
    try {
      await waitFor(`highlight ${expectedCount} after a failed acknowledgement`, reached, 3_000);
      return;
    } catch {
      const retry = await request(uri, { type: "spike.highlightText", page, spanCount: 2, color });
      if (!retry.ok) {
        throw new Error(`spike.highlightText failed twice: ${retry.error ?? result.error ?? "unknown"}`);
      }
    }
  }
  await waitFor(`highlight ${expectedCount} in the model`, reached);
}

export async function remove(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true });
  } catch {
    // Nothing to remove.
  }
}

export async function viewerState(uri: vscode.Uri): Promise<ViewerState | undefined> {
  return vscode.commands.executeCommand<ViewerState | undefined>("pdfCaseReview.debug.getViewerState", uri);
}

export async function waitForLoaded(uri: vscode.Uri): Promise<ViewerState> {
  return waitFor("viewer to load", async () => {
    const current = await viewerState(uri);
    return current?.loaded ? current : undefined;
  });
}

export async function send(uri: vscode.Uri, message: HostToWebviewMessage): Promise<void> {
  const delivered = await vscode.commands.executeCommand<number>(
    "pdfCaseReview.debug.postMessage",
    uri,
    message,
  );
  assert.equal(delivered, 1, `message ${message.type} should reach exactly one webview`);
}

export async function openWith(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
}

export async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

/**
 * Copies a fixture so a test can write beside it without touching the shared file, and removes
 * any sidecar a previous run left next to the copy so every suite starts from a clean document.
 */
export async function copyFixture(source: vscode.Uri, target: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."));
  await vscode.workspace.fs.copy(source, target, { overwrite: true });
  const name = target.path.slice(target.path.lastIndexOf("/") + 1);
  try {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(target, "..", `${name}.review.json`));
  } catch {
    // No stale sidecar.
  }
}
