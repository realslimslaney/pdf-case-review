# Manual memory pass: large PDFs

Run before each pre-release that touched the viewer, and once for the M3 definition of done.
Automated tests cover the 300-page fixture; this pass covers what only a human with a process
monitor can judge.

## Setup

1. `pnpm fixtures --heavy` (writes `test/fixtures/generated/heavy-case.pdf`, ~80 MB, 300 pages;
   never committed, never used by CI).
2. F5 to launch the Extension Development Host on `test/fixtures`.
3. Open a process monitor (Windows: Task Manager details or Process Explorer; macOS: Activity
   Monitor). The number to watch is the webview renderer process of the Extension Development
   Host window, not the extension host.

## Pass

Record the renderer's working set at each step.

1. Open `generated/heavy-case.pdf`. Wait for the page count in the toolbar.
2. Scroll to the middle, then the end (Ctrl+End), then back to page 1.
3. Zoom to 200 percent, scroll a few pages, zoom back to automatic.
4. Create three highlights on three far-apart pages, save, confirm the save completes.
5. Hide the tab (open a text file beside it), wait ten seconds, show it again.
6. With `pdfCaseReview.viewer.retainContextWhenHidden` off (reload the window after changing
   it), repeat step 5: hiding should release most renderer memory and showing should reload the
   viewer with highlights intact.
7. Set `pdfCaseReview.viewer.maxCanvasPixels` to `4194304`, reopen, repeat step 3: peak memory
   during zoom should drop visibly; pages may look softer at high zoom.
8. Close the editor. The renderer process should exit or shrink to baseline.

## Record

Append a row per run:

| Date | Machine | Step 2 peak | Step 3 peak | Step 7 peak | Retain-off release works | Notes |
|---|---|---|---|---|---|---|
