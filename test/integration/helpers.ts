// Shared helpers for the headless VS Code integration tests (Mocha, tdd UI). Everything goes
// through the extension's debug commands, so the tests never import extension code at runtime.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

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

/** Copies a fixture so a test can write beside it without touching the shared file. */
export async function copyFixture(source: vscode.Uri, target: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."));
  await vscode.workspace.fs.copy(source, target, { overwrite: true });
}
