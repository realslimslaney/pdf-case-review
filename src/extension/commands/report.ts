// The report commands: render the active document's sidecar to Markdown, Word or PDF and write
// `<basename>.review.<ext>` beside the PDF or into `pdfCaseReview.report.outputFolder`. The
// renderers and the sidecar adapter load lazily so activation never pays for them.

import { commands, type Disposable, type LogOutputChannel, Uri, window, workspace } from "vscode";

import type { ReportFormat } from "../../core/report/render";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import { baseName, type PdfDocument, parentUri } from "../editor/pdfDocument";
import { aiSettings, type ReportSettings, reportSettings } from "../settings";
import { writeBytes } from "../util/writeBytes";

interface CommandContext {
  tracker: ActiveDocumentTracker;
  output: LogOutputChannel;
}

const FORMAT_ITEMS = [
  { label: "Markdown", description: ".md", format: "markdown" },
  { label: "Word", description: ".docx", format: "docx" },
  { label: "PDF", description: ".pdf", format: "pdf" },
] as const;

function isReportFormat(value: unknown): value is ReportFormat {
  return value === "markdown" || value === "docx" || value === "pdf";
}

async function pickFormat(): Promise<ReportFormat | undefined> {
  const picked = await window.showQuickPick([...FORMAT_ITEMS], { placeHolder: "Report format" });
  return picked?.format;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function outputFolderFor(document: PdfDocument, settings: ReportSettings): Uri {
  if (settings.outputFolder === "") {
    return parentUri(document.uri);
  }
  if (!workspace.isTrusted) {
    void window.showWarningMessage(
      "PDF Case Review: report.outputFolder is ignored in untrusted workspaces; writing beside the PDF.",
    );
    return parentUri(document.uri);
  }
  if (isAbsolutePath(settings.outputFolder)) {
    return Uri.file(settings.outputFolder);
  }
  const folder = workspace.getWorkspaceFolder(document.uri) ?? workspace.workspaceFolders?.[0];
  return folder
    ? Uri.joinPath(folder.uri, settings.outputFolder)
    : Uri.joinPath(parentUri(document.uri), settings.outputFolder);
}

async function exists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** `case.review.md`, or the first free `case.review.<n>.md` when overwriting is off. */
async function targetFor(folder: Uri, base: string, extension: string, overwrite: boolean): Promise<Uri> {
  const candidate = Uri.joinPath(folder, `${base}.review.${extension}`);
  if (overwrite || !(await exists(candidate))) {
    return candidate;
  }
  for (let counter = 2; ; counter += 1) {
    const next = Uri.joinPath(folder, `${base}.review.${counter}.${extension}`);
    if (!(await exists(next))) {
      return next;
    }
  }
}

async function renderTo(
  document: PdfDocument,
  format: ReportFormat,
  settings: ReportSettings,
  output: LogOutputChannel,
): Promise<Uri> {
  const [{ renderReport }, { reportInputFromSidecar }] = await Promise.all([
    import("../../core/report/render"),
    import("../../core/report/fromSidecar"),
  ]);
  const context: Parameters<typeof reportInputFromSidecar>[1] = {
    generatedAt: new Date().toISOString(),
    author: settings.author,
    pageCount: document.info.pageCount,
    includeAiSummary: aiSettings(document.uri, output).includeInReport,
  };
  if (document.pageLabels) {
    context.pageLabels = document.pageLabels;
  }
  const input = reportInputFromSidecar(document.model, context);
  const rendered = await renderReport(input, format, settings.options);
  const folder = outputFolderFor(document, settings);
  const base = baseName(document.uri).replace(/\.pdf$/i, "");
  const target = await targetFor(folder, base, rendered.extension, settings.overwrite);
  await writeBytes(target, rendered.bytes);
  void window
    .showInformationMessage(`PDF Case Review: report saved as ${baseName(target)}.`, "Open", "Reveal")
    .then((action) => {
      if (action === "Open") {
        return commands.executeCommand("vscode.open", target);
      }
      if (action === "Reveal") {
        return commands.executeCommand("revealFileInOS", target);
      }
      return undefined;
    });
  return target;
}

export async function generateReport(context: CommandContext, format?: unknown): Promise<Uri | undefined> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return undefined;
  }
  const settings = reportSettings(document.uri);
  const chosen = isReportFormat(format)
    ? format
    : settings.defaultFormat === "ask"
      ? await pickFormat()
      : settings.defaultFormat;
  if (chosen === undefined) {
    return undefined;
  }
  return renderTo(document, chosen, settings, context.output);
}

export async function generateReportAs(context: CommandContext, format?: unknown): Promise<Uri | undefined> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return undefined;
  }
  const chosen = isReportFormat(format) ? format : await pickFormat();
  if (chosen === undefined) {
    return undefined;
  }
  return renderTo(document, chosen, reportSettings(document.uri), context.output);
}

export function registerReportCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.generateReport", (format?: unknown) =>
      generateReport(context, format),
    ),
    commands.registerCommand("pdfCaseReview.generateReportAs", (format?: unknown) =>
      generateReportAs(context, format),
    ),
  ];
}
