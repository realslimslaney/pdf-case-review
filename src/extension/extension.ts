import { commands, type ExtensionContext, Uri, window, workspace } from "vscode";

import type { HostToWebviewMessage } from "../shared/protocol";
import { PdfCaseReviewEditorProvider } from "./editor/pdfCaseReviewEditorProvider";

interface SampleReportResult {
  format: string;
  file: string;
  bytes: number;
  ms: number;
}

/** Renders the built-in sample report in every format into `folder`; the renderers load lazily. */
async function renderSampleReport(folder: Uri): Promise<SampleReportResult[]> {
  const [{ renderReport }, { SAMPLE_REPORT_INPUT }] = await Promise.all([
    import("../core/report/render"),
    import("../core/report/sample"),
  ]);
  const results: SampleReportResult[] = [];
  for (const format of ["markdown", "docx", "pdf"] as const) {
    const started = Date.now();
    const rendered = await renderReport(SAMPLE_REPORT_INPUT, format);
    const target = Uri.joinPath(folder, `sample-report.${rendered.extension}`);
    await workspace.fs.writeFile(target, rendered.bytes);
    results.push({ format, file: target.fsPath, bytes: rendered.bytes.byteLength, ms: Date.now() - started });
  }
  return results;
}

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("PDF Case Review", { log: true });
  const { provider, registration } = PdfCaseReviewEditorProvider.register(context, output);

  context.subscriptions.push(
    output,
    registration,
    // Internal commands (not contributed to the palette) used by integration tests and,
    // later, by the notes views.
    commands.registerCommand("pdfCaseReview.debug.getViewerState", (uri: Uri) =>
      provider.getViewerState(uri),
    ),
    commands.registerCommand("pdfCaseReview.debug.postMessage", (uri: Uri, message: HostToWebviewMessage) =>
      provider.postMessage(uri, message),
    ),
    commands.registerCommand("pdfCaseReview.debug.renderSampleReport", async (folder: Uri) => {
      const results = await renderSampleReport(folder);
      for (const result of results) {
        output.info(
          `sample report ${result.format}: ${result.bytes} bytes in ${result.ms} ms → ${result.file}`,
        );
      }
      return results;
    }),
  );

  output.info("PDF Case Review activated");
}

export function deactivate(): void {}
