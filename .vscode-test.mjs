import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist/test/integration/**/*.test.js",
  workspaceFolder: "test/fixtures",
  launchArgs: ["--disable-extensions"],
  mocha: {
    ui: "tdd",
    timeout: 90_000,
    color: true,
  },
});
