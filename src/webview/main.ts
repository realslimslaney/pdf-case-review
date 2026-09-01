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
// Memory limits for very large documents; null keeps the vendored PDF.js defaults.
if (config.maxCanvasPixels !== null) {
  PDFViewerApplicationOptions.set("maxCanvasPixels", config.maxCanvasPixels);
}
if (config.maxImageSize !== null) {
  PDFViewerApplicationOptions.set("maxImageSize", config.maxImageSize);
}
// High-contrast themes force the theme's page colors onto rendered pages (ADR-0008). PDF.js
// captures these at viewer construction, so a theme change rebuilds the webview host-side.
if (config.themeKind === "high-contrast" || config.themeKind === "high-contrast-light") {
  const styles = getComputedStyle(document.documentElement);
  const dark = config.themeKind === "high-contrast";
  PDFViewerApplicationOptions.set("forcePageColors", true);
  PDFViewerApplicationOptions.set(
    "pageColorsBackground",
    styles.getPropertyValue("--vscode-editor-background").trim() || (dark ? "#000000" : "#FFFFFF"),
  );
  PDFViewerApplicationOptions.set(
    "pageColorsForeground",
    styles.getPropertyValue("--vscode-editor-foreground").trim() || (dark ? "#FFFFFF" : "#000000"),
  );
}
// Highlight editing: NONE mode keeps the floating "highlight" button available on text
// selection without putting the whole viewer into edit mode. Comments are ours, not PDF.js's.
PDFViewerApplicationOptions.set("enableScripting", false);
PDFViewerApplicationOptions.set("annotationEditorMode", 0);
PDFViewerApplicationOptions.set("enableHighlightFloatingButton", true);
PDFViewerApplicationOptions.set("highlightEditorColors", config.highlightEditorColors);
PDFViewerApplicationOptions.set("enableComment", false);
PDFViewerApplicationOptions.set("enableSignatureEditor", false);

// PDF.js "saves" by downloading the file: on Ctrl+S, from its toolbar buttons, and from close()
// whenever its annotation storage changed, which every reload would trigger. Inside VS Code that
// drops a copy into the Downloads folder, so all three are no-ops; saving is the host's job.
PDFViewerApplication.download = async () => {};
PDFViewerApplication.save = async () => {};
PDFViewerApplication.downloadOrSave = async () => {};

// Keep PDF.js from intercepting Ctrl+P/Cmd+P (print dialog) and route Ctrl+S/Cmd+S to VS Code.
document.addEventListener(
  "keydown",
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if ((key === "p" || key === "s") && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === "s") {
        post({ type: "saveRequested" });
      }
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
  adapter.installCategoryToolbar(config.categories ?? []);
  await openDocument();
  const [, hash] = config.url.split("#");
  if (hash) {
    PDFViewerApplication.pdfLinkService.setHash(decodeURIComponent(hash));
  }
  await adapter.reportLoaded();
})();

async function handleHostMessage(message: HostToWebviewMessage): Promise<void> {
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
    case "loadHighlights":
      adapter.loadHighlights(message.highlights);
      return;
    case "deleteHighlights":
      await adapter.deleteHighlights(message.items);
      return;
    case "recolorHighlights":
      await adapter.recolorHighlights(message.items);
      return;
    case "goTo":
      adapter.goTo(message.page, message.rect, message.viewerId);
      return;
    case "getPageText":
      await adapter.getPageText(message.requestId, message.page);
      return;
    case "createFromSelection":
      await adapter.applyCategory(message.id, message.color, message.fallbackViewerId);
      return;
    case "spike.selectText":
      adapter.spikeSelectText(message.page, message.spanCount);
      return;
    case "spike.probeTextLayer":
      adapter.spikeProbeTextLayer(message.page);
      return;
    case "spike.undo":
      adapter.undo();
      return;
    case "spike.redo":
      adapter.redo();
      return;
    case "spike.highlightText":
      await adapter.spikeHighlightText(message.page, message.spanCount, message.color);
      return;
    case "spike.recolorEditor":
      adapter.recolorEditor(message.id, message.color);
      return;
    case "setDefaultCategory":
      adapter.setDefaultCategory(message.color);
      return;
    case "spike.highlightDefault":
      await adapter.spikeHighlightDefault(message.page, message.spanCount);
      return;
  }
}

window.addEventListener("message", async (event: MessageEvent<HostToWebviewMessage>) => {
  if (event.origin !== window.origin) {
    return;
  }
  await PDFViewerApplication.initializedPromise;
  const message = event.data;
  const { requestId } = message;
  try {
    await handleHostMessage(message);
    if (requestId !== undefined) {
      post({ type: "done", requestId, ok: true });
    }
  } catch (error) {
    if (requestId !== undefined) {
      post({
        type: "done",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      post({
        type: "log",
        level: "error",
        message: `${message.type}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
});
