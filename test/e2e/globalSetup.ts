// Builds the harness pages before the smoke runs: the same buildViewerHtml the editor provider
// uses, with plain HTTP paths instead of webview URIs and the acquireVsCodeApi stub injected.
// Requires `pnpm prepare-pdfjs`, `pnpm fixtures` and `pnpm build` to have run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ThemeKind, ViewerConfig } from "../../src/shared/protocol";
import { buildViewerHtml } from "../../src/shared/viewerHtml";

/** A deliberately non-default value; the smoke asserts it lands in PDF.js AppOptions. */
export const SMOKE_MAX_CANVAS_PIXELS = 1_048_576;

function configFor(themeKind: ThemeKind): ViewerConfig {
  return {
    url: "/test/fixtures/generated/sample-case.pdf",
    resourceRoot: "/test/fixtures/generated/",
    defaultZoomValue: "auto",
    sidebarViewOnLoad: 0,
    themeKind,
    maxCanvasPixels: SMOKE_MAX_CANVAS_PIXELS,
    maxImageSize: null,
    highlightEditorColors:
      "fact=#FFFF98,financial=#53FFBC,strategic=#80EBFF,concern=#FF4F5F,question=#FFCBE6",
    categories: [
      { id: "fact", name: "Fact", color: "#FFFF98" },
      { id: "financial", name: "Financial", color: "#53FFBC" },
      { id: "strategic", name: "Strategic implication", color: "#80EBFF" },
      { id: "concern", name: "Concern", color: "#FF4F5F" },
      { id: "question", name: "Question", color: "#FFCBE6" },
    ],
    sandboxBundleSrc: "/vendor/pdfjs/build/pdf.sandbox.mjs",
    cMapUrl: "/vendor/pdfjs/web/cmaps/",
    iccUrl: "/vendor/pdfjs/web/iccs/",
    standardFontDataUrl: "/vendor/pdfjs/web/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/web/wasm/",
    imageResourcesPath: "/vendor/pdfjs/web/images/",
  };
}

export default function globalSetup(): void {
  const root = resolve(__dirname, "..", "..");
  const template = readFileSync(resolve(root, "vendor", "pdfjs", "web", "viewer.html"), "utf8");
  const outDir = resolve(root, "test", "e2e", ".out");
  mkdirSync(outDir, { recursive: true });
  for (const [name, themeKind] of [
    ["index.html", "dark"],
    ["high-contrast.html", "high-contrast"],
  ] as const) {
    const html = buildViewerHtml(template, {
      config: configFor(themeKind),
      cspSource: null,
      stubScriptUrl: "/test/e2e/stub.js",
      urls: {
        viewerCss: "/vendor/pdfjs/web/viewer.css",
        webviewCss: "/media/webview.css",
        pdfMjs: "/vendor/pdfjs/build/pdf.mjs",
        mainJs: "/dist/webview/main.js",
        localeJson: "/vendor/pdfjs/web/locale/locale.json",
      },
    });
    writeFileSync(resolve(outDir, name), html);
  }
}
