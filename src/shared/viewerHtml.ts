// Builds the viewer page from the vendored PDF.js viewer.html: strips the tags the host replaces
// (PDF.js's own CSP meta, its script and stylesheet includes) and splices in ours. Pure string
// work with no vscode, DOM or Node imports, so the editor provider and the Playwright harness
// (test/e2e) assemble the page through the same code and cannot drift.

import { escapeAttribute } from "./escapeAttribute";
import type { ViewerConfig } from "./protocol";

const CSP_META_REGEX = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/u;

export function stripViewerTags(html: string): string {
  return html
    .replace(CSP_META_REGEX, "")
    .replace(/* html */ `<link rel="resource" type="application/l10n" href="locale/locale.json" />`, "")
    .replace(/* html */ `<script src="../build/pdf.mjs" type="module"></script>`, "")
    .replace(/* html */ `<script src="viewer.mjs" type="module"></script>`, "")
    .replace(/* html */ `<link rel="stylesheet" href="viewer.css" />`, "");
}

export interface ViewerHtmlUrls {
  viewerCss: string;
  webviewCss: string;
  pdfMjs: string;
  mainJs: string;
  localeJson: string;
}

export interface ViewerHtmlOptions {
  config: ViewerConfig;
  urls: ViewerHtmlUrls;
  /** The webview's CSP source; null omits the CSP meta entirely (the browser test harness). */
  cspSource: string | null;
  /** A classic script loaded before the module scripts (the harness's acquireVsCodeApi stub). */
  stubScriptUrl?: string;
}

export function buildViewerHtml(template: string, options: ViewerHtmlOptions): string {
  const { config, urls, cspSource, stubScriptUrl } = options;
  const csp =
    cspSource === null
      ? ""
      : /* html */ `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${cspSource} blob: data:; script-src ${cspSource} 'wasm-unsafe-eval'; worker-src ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} blob: data:; font-src ${cspSource} data:; media-src blob:; base-uri 'none'; form-action 'none';">`;
  const stub = stubScriptUrl === undefined ? "" : /* html */ `\n<script src="${stubScriptUrl}"></script>`;
  return stripViewerTags(template)
    .replace(
      /* html */ "<title>PDF.js viewer</title>",
      /* html */ `${csp}
<meta id="pdf-case-review-config" data-config="${escapeAttribute(config)}">

<title>PDF Case Review</title>

<link rel="stylesheet" href="${urls.viewerCss}">
<link rel="stylesheet" href="${urls.webviewCss}">
${stub}
<script src="${urls.pdfMjs}" type="module"></script>
<script src="${urls.mainJs}" type="module"></script>

<link rel="resource" type="application/l10n" href="${urls.localeJson}">`,
    )
    .trim();
}
