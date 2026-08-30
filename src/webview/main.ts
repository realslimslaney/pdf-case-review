/*
 * Copyright 2021 Mathematic, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by Brennen Slaney for PDF Case Review, 2026. Derived from
 * mathematic-inc/vscode-pdf assets/main.mjs. Changes: TypeScript; typed host protocol;
 * enables the PDF.js highlight editor with the category palette and disables scripting and
 * the PDF.js comment UI; reconciles highlight editors back to the host (PdfjsAdapter).
 */

import { PDFViewerApplication, PDFViewerApplicationOptions } from "pdfjs-viewer";

import type { HostToWebviewMessage, ViewerConfig, WebviewToHostMessage } from "../shared/protocol";
import { PdfjsAdapter } from "./pdfjsAdapter";

const vscode = acquireVsCodeApi();

function post(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

function loadConfig(): ViewerConfig {
  const element = document.querySelector<HTMLElement>("#pdf-case-review-config");
  const raw = element?.dataset["config"];
  if (!raw) {
    throw new Error("Could not load the viewer configuration.");
  }
  return JSON.parse(raw) as ViewerConfig;
}

const config = loadConfig();

PDFViewerApplicationOptions.set("defaultUrl", "");
PDFViewerApplicationOptions.set("disablePreferences", true);
PDFViewerApplicationOptions.set("defaultZoomValue", config.defaultZoomValue ?? "auto");
PDFViewerApplicationOptions.set("sidebarViewOnLoad", config.sidebarViewOnLoad ?? 0);
PDFViewerApplicationOptions.set("sandboxBundleSrc", config.sandboxBundleSrc);
PDFViewerApplicationOptions.set("cMapUrl", config.cMapUrl);
PDFViewerApplicationOptions.set("iccUrl", config.iccUrl);
PDFViewerApplicationOptions.set("standardFontDataUrl", config.standardFontDataUrl);
PDFViewerApplicationOptions.set("wasmUrl", config.wasmUrl);
PDFViewerApplicationOptions.set("imageResourcesPath", config.imageResourcesPath);
// Highlight editing: NONE mode keeps the floating "highlight" button available on text
// selection without putting the whole viewer into edit mode. Comments are ours, not PDF.js's.
PDFViewerApplicationOptions.set("enableScripting", false);
PDFViewerApplicationOptions.set("annotationEditorMode", 0);
PDFViewerApplicationOptions.set("enableHighlightFloatingButton", true);
PDFViewerApplicationOptions.set("highlightEditorColors", config.highlightEditorColors);
PDFViewerApplicationOptions.set("enableComment", false);
PDFViewerApplicationOptions.set("enableSignatureEditor", false);

// Prevent PDF.js from intercepting Ctrl+P/Cmd+P and triggering the print dialog.
document.addEventListener(
  "keydown",
  (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "p") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

window.addEventListener("error", (event) => {
  post({ type: "log", level: "error", message: `${event.message} (${event.filename}:${event.lineno})` });
});

const adapter = new PdfjsAdapter(PDFViewerApplication, PDFViewerApplicationOptions, post);

async function openDocument(): Promise<void> {
  await PDFViewerApplication.open(config as unknown as Record<string, unknown>);
  await PDFViewerApplication.pdfViewer.pagesPromise;
}

post({ type: "ready" });

void (async () => {
  await PDFViewerApplication.initializedPromise;
  adapter.attach();
  await openDocument();
  const [, hash] = config.url.split("#");
  if (hash) {
    PDFViewerApplication.pdfLinkService.setHash(decodeURIComponent(hash));
  }
  await adapter.reportLoaded();
})();

window.addEventListener("message", async (event: MessageEvent<HostToWebviewMessage>) => {
  if (event.origin !== window.origin) {
    return;
  }
  await PDFViewerApplication.initializedPromise;
  const message = event.data;
  switch (message.type) {
    case "reload": {
      const currentPageNumber = PDFViewerApplication.pdfViewer.currentPageNumber;
      await openDocument();
      PDFViewerApplication.pdfViewer.currentPageNumber = Math.min(
        currentPageNumber,
        PDFViewerApplication.pdfViewer.pagesCount,
      );
      await adapter.reportLoaded();
      return;
    }
    case "dumpEditors":
      adapter.snapshotNow();
      return;
    case "setEditorMode":
      adapter.setEditorMode(message.mode);
      return;
    case "saveDocument":
      await adapter.saveDocument();
      return;
    case "spike.highlightText":
      adapter.spikeHighlightText(message.page, message.spanCount, message.color);
      return;
    case "spike.recolorEditor":
      adapter.recolorEditor(message.id, message.color);
      return;
  }
});
