# Third-party notices

Components bundled into the published extension (`.vsix`). Development-only dependencies are not listed.

| Component | Version | License | Where |
|---|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) by Mozilla Foundation | see `pdfjs.lock.json` | Apache-2.0 | `vendor/pdfjs/` (with `LICENSE`) |
| Adobe CMap resources (via PDF.js) | n/a | BSD-3-Clause | `vendor/pdfjs/web/cmaps/` |
| Foxit standard fonts (via PDF.js) | n/a | see `vendor/pdfjs/web/standard_fonts/LICENSE_FOXIT` | `vendor/pdfjs/web/standard_fonts/` |
| Liberation fonts (via PDF.js) | n/a | SIL OFL 1.1 | `vendor/pdfjs/web/standard_fonts/` |
| [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) by Mathematic Inc (derived code) | commit in `pdfjs.lock.json` | Apache-2.0 | `src/extension/editor/`, `src/extension/util/`, `src/webview/main.ts`, `media/webview.css` |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | see `package.json` | MIT | bundled into `dist/extension.js` |
| [docx](https://github.com/dolanmiu/docx) | see `package.json` | MIT | bundled (lazy chunk) |
| [pdfmake](https://github.com/bpampuch/pdfmake) | see `package.json` | MIT | bundled (lazy chunk) |
| Roboto (via pdfmake `vfs_fonts`) by Christian Robertson / Google | n/a | Apache-2.0 | bundled (lazy chunk) |
| [marked](https://github.com/markedjs/marked) | see `package.json` | MIT | bundled into `dist/extension.js` |
