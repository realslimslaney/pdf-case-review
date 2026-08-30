// `$(notebook) 12 highlights · PDF synced` while a PDF Case Review document is active.

import { StatusBarAlignment, window } from "vscode";

import type { PdfWriteStatus } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfDocument } from "../editor/pdfDocument";
import { Disposable } from "../util/disposable";

function pdfStatus(document: PdfDocument): string {
  if (document.isDirty) {
    return "unsaved";
  }
  const status: PdfWriteStatus | undefined = document.model.source.pdfWrite;
  switch (status) {
    case "synced":
      return "PDF synced";
    case "skipped-protected":
    case "skipped-setting":
      return "sidecar only";
    case "failed":
      return "PDF write failed";
    default:
      return document.model.highlights.length === 0 ? "" : "not saved yet";
  }
}

export function statusText(document: PdfDocument): string {
  const count = document.model.highlights.length;
  const detail = pdfStatus(document);
  return `$(notebook) ${count} highlight${count === 1 ? "" : "s"}${detail ? ` · ${detail}` : ""}`;
}

export class HighlightsStatusBar extends Disposable {
  private readonly item = this._register(
    window.createStatusBarItem("pdfCaseReview.status", StatusBarAlignment.Left, 50),
  );

  constructor(tracker: ActiveDocumentTracker) {
    super();
    this.item.name = "PDF Case Review";
    this.item.command = "pdfCaseReview.highlights.focus";
    this._register(tracker.onDidChange((document) => this.update(document)));
    this.update(tracker.active);
  }

  private update(document: PdfDocument | undefined): void {
    if (!document) {
      this.item.hide();
      return;
    }
    this.item.text = statusText(document);
    this.item.tooltip = `${document.model.source.fileName}: highlights are stored in ${document.sidecarUri.path.slice(document.sidecarUri.path.lastIndexOf("/") + 1)}. Click to show the Highlights view.`;
    this.item.show();
  }
}
