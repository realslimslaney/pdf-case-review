# Manual pass: cold activation time

Run before each stable cut. The bar is under 200 ms of extension activation cost, measured
by VS Code itself. Activation is declarative (no activation events fire until a PDF opens),
so this measures the real cost a user pays.

## Setup

1. `pnpm package` and install the fresh VSIX into a separate profile:
   `code --profile pcr-perf --install-extension pdf-case-review-*.vsix`
   (measuring the Extension Development Host is misleading; it loads unbundled code).
2. Close all VS Code windows so the next launch is cold.

## Pass

Three trials. For each:

1. Launch: `code --profile pcr-perf test/fixtures` from a cold start.
2. Open `generated/case.pdf` and wait for the first page to render.
3. Run Developer: Show Running Extensions. Record the activation time listed for
   PDF Case Review (the ms figure next to the extension, not the total startup time).
4. Close all windows before the next trial.

Also record trial 1's time-to-first-page as felt with a stopwatch; it catches webview and
PDF.js cost that activation time excludes.

## Record

Append a row per run (three trials):

| Date | Machine | Build | Trial 1 ms | Trial 2 ms | Trial 3 ms | First page feel | Notes |
|---|---|---|---|---|---|---|---|

Bar: every trial under 200 ms.
