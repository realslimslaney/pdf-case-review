// Spike 5 (see docs/explanation/decisions.md): the report renderers (docx, pdfmake + Roboto,
// marked) must load and run inside the extension host bundle, quickly.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

interface SampleReportResult {
  format: string;
  file: string;
  bytes: number;
  ms: number;
}

suite("Spike 5: report rendering in the extension host", () => {
  suiteSetup(async () => {
    // Nothing here opens a PDF (the activation trigger) and debug commands are not contributed,
    // so activate the extension explicitly.
    const extension = vscode.extensions.getExtension("realslimslaney.pdf-case-review");
    assert.ok(extension, "extension not found in the development host");
    await extension.activate();
  });

  test("renders Markdown, Word and PDF from the host bundle in under two seconds each", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const target = vscode.Uri.joinPath(folder.uri, "generated");
    const results = await vscode.commands.executeCommand<SampleReportResult[]>(
      "pdfCaseReview.debug.renderSampleReport",
      target,
    );
    assert.ok(results);
    assert.deepEqual(
      results.map((result) => result.format),
      ["markdown", "docx", "pdf"],
    );
    for (const result of results) {
      assert.ok(result.bytes > 500, `${result.format} should have content (${result.bytes} bytes)`);
      assert.ok(result.ms < 2_000, `${result.format} took ${result.ms} ms`);
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(result.file));
      assert.equal(stat.size, result.bytes);
    }
    const pdf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(target, "sample-report.pdf"));
    assert.equal(new TextDecoder("latin1").decode(pdf.slice(0, 5)), "%PDF-");
  });
});
