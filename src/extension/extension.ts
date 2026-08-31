import { commands, type ExtensionContext, Uri, window, workspace } from "vscode";

import type { HostToWebviewMessage } from "../shared/protocol";
import { type ConsentTestResponder, setConsentTestResponder } from "./ai/consentGate";
import { registerAiManualCommands } from "./ai/manualCommands";
import { registerAiProviderCommands } from "./ai/summarize";
import { registerCategoryCommands } from "./commands/categories";
import { GROUP_BY_KEY, registerHighlightCommands } from "./commands/highlights";
import { registerNoteCommands } from "./commands/notes";
import { registerReportCommands } from "./commands/report";
import { ActiveDocumentTracker } from "./editor/activeDocument";
import { PdfCaseReviewEditorProvider } from "./editor/pdfCaseReviewEditorProvider";
import { highlightsGroupBy } from "./settings";
import { HighlightsTreeProvider, type TreeNode } from "./views/highlightsTree";
import { NoteEditorViewProvider } from "./views/noteEditorView";
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
  const noteEditor = new NoteEditorViewProvider(context.extensionUri, provider, tracker);
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
    noteEditor,
    window.registerWebviewViewProvider(NoteEditorViewProvider.viewType, noteEditor),
    ...registerHighlightCommands({ provider, tracker, tree, treeView }),
    ...registerCategoryCommands({ provider, tracker, output }),
    ...registerNoteCommands({ provider, tracker, treeView, noteEditor }),
    ...registerReportCommands({ tracker, output }),
    ...registerAiManualCommands({ provider, tracker, output, extensionContext: context }),
    ...registerAiProviderCommands({ provider, tracker, output, extensionContext: context }),
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
    commands.registerCommand("pdfCaseReview.debug.autoConsent", (responder?: ConsentTestResponder | null) =>
      setConsentTestResponder(responder ?? undefined),
    ),
    commands.registerCommand("pdfCaseReview.debug.getNoteEditorState", () => noteEditor.state()),
    commands.registerCommand("pdfCaseReview.debug.postNoteEditorMessage", (message: unknown) =>
      noteEditor.handleMessage(message),
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
