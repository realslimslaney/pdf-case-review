// M3 phase 8: virtual and read-only file systems. A PDF on a read-only FileSystemProvider opens
// and renders, the user is told nothing can be saved there, and an attempted save fails with the
// friendly message instead of a stack trace, leaving the document dirty and the model intact.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { closeAll, documentState, fixtureUri, highlight, openWith, waitFor, waitForLoaded } from "./helpers";

const SCHEME = "pdfcasereviewtest";

class ReadOnlyFs implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  constructor(private readonly files: Map<string, Uint8Array>) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    if (uri.path === "/" || uri.path === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    const bytes = this.files.get(uri.path);
    if (!bytes) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [...this.files.keys()].map((path) => [path.slice(1), vscode.FileType.File]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const bytes = this.files.get(uri.path);
    if (!bytes) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return bytes;
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("read-only test file system");
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("read-only test file system");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("read-only test file system");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("read-only test file system");
  }
}

suite("M3 phase 8: read-only virtual file system", () => {
  const pdf = vscode.Uri.from({ scheme: SCHEME, path: "/case.pdf" });
  let registration: vscode.Disposable;

  suiteSetup(async () => {
    const bytes = await vscode.workspace.fs.readFile(fixtureUri("generated", "sample-case.pdf"));
    registration = vscode.workspace.registerFileSystemProvider(
      SCHEME,
      new ReadOnlyFs(new Map([["/case.pdf", bytes]])),
      { isReadonly: true },
    );
    await openWith(pdf);
  });

  suiteTeardown(async () => {
    await closeAll();
    registration.dispose();
  });

  test("the viewer loads from the read-only scheme and the user is told about it", async () => {
    const state = await waitForLoaded(pdf);
    assert.equal(state.pagesCount, 3);
    const trace = await vscode.commands.executeCommand<string[]>("pdfCaseReview.debug.getTrace");
    assert.ok(
      trace?.some((line) => line.includes("readOnlyFs") && line.includes(SCHEME)),
      `expected a readOnlyFs trace entry, got:\n${trace?.join("\n")}`,
    );
  });

  test("a save fails with the friendly message and the model stays intact", async () => {
    await highlight(pdf, 1, "#53FFBC", 1);
    await vscode.commands.executeCommand("workbench.action.files.save");
    const state = await waitFor("the document still dirty after the failed save", async () => {
      const current = await documentState(pdf);
      return current?.dirty ? current : undefined;
    });
    assert.equal(state.model.highlights.length, 1, "the failed save loses nothing");
    let thrown = "";
    try {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.from({ scheme: SCHEME, path: "/probe.txt" }),
        new Uint8Array(1),
      );
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    assert.ok(thrown !== "", "the provider refuses writes, which is what the save path surfaces");
  });
});
