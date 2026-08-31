// The Export Annotated PDF command: runs the dual-write sync against a copy at a chosen path.
// The original PDF is never the destination, and a protected source is copied byte-identical
// with an explanation (the provider's exportAnnotatedCopy owns that messaging).

import { commands, type Disposable, Uri, window } from "vscode";

import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import { baseName, parentUri } from "../editor/pdfDocument";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
}

export async function exportAnnotatedPdf(context: CommandContext, destination?: Uri): Promise<void> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return;
  }
  let target = destination;
  if (!target) {
    const base = baseName(document.uri).replace(/\.pdf$/i, "");
    target = await window.showSaveDialog({
      defaultUri: Uri.joinPath(parentUri(document.uri), `${base}.annotated.pdf`),
      filters: { PDF: ["pdf"] },
      title: "Export Annotated PDF",
    });
  }
  if (!target) {
    return;
  }
  if (target.toString() === document.uri.toString()) {
    void window.showWarningMessage("PDF Case Review: choose a destination different from the original PDF.");
    return;
  }
  try {
    await context.provider.exportAnnotatedCopy(document, target);
  } catch (error) {
    void window.showErrorMessage(
      `PDF Case Review: export failed: ${error instanceof Error ? error.message : String(error)}.`,
    );
    return;
  }
  if (!document.protected) {
    const exported = target;
    void window
      .showInformationMessage(`PDF Case Review: exported ${baseName(exported)}.`, "Reveal")
      .then((action) =>
        action === "Reveal" ? commands.executeCommand("revealFileInOS", exported) : undefined,
      );
  }
}

export function registerExportCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.exportAnnotatedPdf", (destination?: Uri) =>
      exportAnnotatedPdf(context, destination),
    ),
  ];
}
