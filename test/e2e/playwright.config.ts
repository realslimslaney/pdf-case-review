// The browser-level webview smoke (ADR-0009): the built webview bundle plus the vendored viewer
// served statically, with acquireVsCodeApi stubbed. Chromium only; the in-VS-Code integration
// suite stays the primary harness, this one exercises the PDF.js seam without Electron.

import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const port = 8123;

export default defineConfig({
  testDir: __dirname,
  globalSetup: require.resolve("./globalSetup"),
  outputDir: resolve(__dirname, "test-results"),
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: "node test/e2e/server.mjs",
    port,
    cwd: resolve(__dirname, "..", ".."),
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
