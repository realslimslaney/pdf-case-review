import { commands, type ExtensionContext, Uri, window, workspace } from "vscode";

import type { HostToWebviewMessage } from "../shared/protocol";
import { registerCategoryCommands } from "./commands/categories";
import { GROUP_BY_KEY, registerHighlightCommands } from "./commands/highlights";
import { ActiveDocumentTracker } from "./editor/activeDocument";
import { PdfCaseReviewEditorProvider } from "./editor/pdfCaseReviewEditorProvider";
import { highlightsGroupBy } from "./settings";
import { HighlightsTreeProvider, type TreeNode } from "./views/highlightsTree";
import { HighlightsStatusBar, statusText } from "./views/statusBar";

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
  const tracker = new ActiveDocumentTracker(provider);
  const tree = new HighlightsTreeProvider(tracker, highlightsGroupBy);
  const treeView = window.createTreeView<TreeNode>("pdfCaseReview.highlights", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  const statusBar = new HighlightsStatusBar(tracker);
  void commands.executeCommand("setContext", GROUP_BY_KEY, highlightsGroupBy());
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("pdfCaseReview.highlights.groupBy")) {
        void commands.executeCommand("setContext", GROUP_BY_KEY, highlightsGroupBy());
        tree.refresh();
      }
    }),
  );

  context.subscriptions.push(
    output,
    registration,
    tracker,
    tree,
    treeView,
    statusBar,
    ...registerHighlightCommands({ provider, tracker, tree, treeView }),
    ...registerCategoryCommands({ provider, tracker, output }),
    // Internal commands (not contributed to the palette) used by integration tests and,
    // later, by the notes views.
    commands.registerCommand("pdfCaseReview.debug.getViewerState", (uri: Uri) =>
      provider.getViewerState(uri),
    ),
    commands.registerCommand("pdfCaseReview.debug.postMessage", (uri: Uri, message: HostToWebviewMessage) =>
      provider.postMessage(uri, message),
    ),
    commands.registerCommand("pdfCaseReview.debug.getTrace", () => [...provider.trace]),
    commands.registerCommand("pdfCaseReview.debug.getTreeSnapshot", () => ({
      ...tree.snapshot(),
      activeUri: tracker.active?.uri.toString() ?? null,
      statusText: tracker.active ? statusText(tracker.active) : null,
    })),
    commands.registerCommand("pdfCaseReview.debug.getDocumentState", (uri: Uri) => {
      const document = provider.getDocument(uri);
      return document
        ? {
            dirty: document.isDirty,
            instance: document.instance,
            readOnly: document.readOnly,
            sidecarUri: document.sidecarUri.toString(),
            model: document.model,
          }
        : undefined;
    }),
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
