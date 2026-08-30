import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

// The webview imports the vendored PDF.js viewer at runtime by URL relative to
// dist/webview/main.js; it must never be bundled. Source code uses the bare specifier
// `pdfjs-viewer` (typed in src/webview/pdfjs.d.ts) and this plugin rewrites it.
const pdfjsViewerExternal: Plugin = {
  name: "pdfjs-viewer-external",
  setup(build) {
    build.onResolve({ filter: /^pdfjs-viewer$/ }, () => ({
      path: "../../vendor/pdfjs/web/viewer.mjs",
      external: true,
    }));
  },
};

// Bundles: the extension host (Node, CommonJS), the webview (browser, ESM), and the
// integration tests (Node, CommonJS, run inside VS Code by @vscode/test-cli).
export default defineConfig([
  {
    entry: { extension: "src/extension/extension.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    external: ["vscode"],
    // The VSIX ships without node_modules (`vsce package --no-dependencies`), so every runtime
    // dependency must be bundled in.
    noExternal: ["pdf-lib", "docx", "pdfmake", "marked"],
    // Dynamic imports (the report renderers and their fonts) become separate chunks so
    // activation only loads dist/extension.js.
    splitting: true,
    outDir: "dist",
    sourcemap: true,
    clean: true,
    loader: { ".html": "text" },
  },
  {
    entry: { "webview/main": "src/webview/main.ts", "webview/noteEditor": "src/webview/noteEditor.ts" },
    format: "esm",
    platform: "browser",
    target: "es2022",
    esbuildPlugins: [pdfjsViewerExternal],
    outDir: "dist",
    outExtension: () => ({ js: ".js" }),
    sourcemap: true,
    splitting: false,
  },
  {
    // Integration tests run inside VS Code (Mocha, @vscode/test-cli) and must be plain CJS.
    entry: ["test/integration/**/*.test.ts"],
    format: "cjs",
    platform: "node",
    target: "node22",
    external: ["vscode", "mocha"],
    outDir: "dist/test/integration",
    sourcemap: true,
    splitting: false,
  },
]);
