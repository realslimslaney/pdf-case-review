// Which PDF Case Review document is "active" for the views and commands: the one in the active
// tab, tracked through the tab API (custom editors are not text editors, so
// `window.activeTextEditor` is useless here) and the provider's own view-state events.

import { commands, EventEmitter, TabInputCustom, window } from "vscode";

import { Disposable } from "../util/disposable";
import { PdfCaseReviewEditorProvider } from "./pdfCaseReviewEditorProvider";
import type { PdfDocument } from "./pdfDocument";

export const HAS_ACTIVE_DOCUMENT_KEY = "pdfCaseReview.hasActiveDocument";

export class ActiveDocumentTracker extends Disposable {
  private _active: PdfDocument | undefined;
  private readonly _onDidChange = this._register(new EventEmitter<PdfDocument | undefined>());
  /** Fired when another document becomes active (or none is), and when the active one changes. */
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly provider: PdfCaseReviewEditorProvider) {
    super();
    this._register(window.tabGroups.onDidChangeTabs(() => this.recompute()));
    this._register(window.tabGroups.onDidChangeTabGroups(() => this.recompute()));
    this._register(provider.onDidChangeViewState(() => this.recompute()));
    this._register(
      provider.onDidChangeDocument((document) => {
        if (document === this._active) {
          this._onDidChange.fire(document);
        }
      }),
    );
    this.recompute();
  }

  get active(): PdfDocument | undefined {
    return this._active;
  }

  private recompute(): void {
    const input = window.tabGroups.activeTabGroup.activeTab?.input;
    const uri =
      input instanceof TabInputCustom && input.viewType === PdfCaseReviewEditorProvider.viewType
        ? input.uri
        : undefined;
    const document = uri ? this.provider.getDocument(uri) : undefined;
    if (document === this._active) {
      return;
    }
    this._active = document;
    void commands.executeCommand("setContext", HAS_ACTIVE_DOCUMENT_KEY, document !== undefined);
    this._onDidChange.fire(document);
  }
}
