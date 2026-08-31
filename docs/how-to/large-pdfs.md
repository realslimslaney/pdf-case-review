# Work with very large PDFs

A 300-page annual report or an 80 MB scanned casebook opens like any other document, but memory
use grows with page size, zoom level and how much of the document has been rendered. Three
settings put a lid on it.

## Cap rendering memory

- `pdfCaseReview.viewer.maxCanvasPixels`: the largest canvas a page may render onto. Above the
  cap, pages render at reduced resolution instead of allocating ever-bigger canvases at high
  zoom. `0` keeps the PDF.js default; `4194304` (a 2048 by 2048 canvas) is a reasonable floor
  for constrained machines. Reopen the PDF after changing it.
- `pdfCaseReview.viewer.maxImageSize`: skips decoding images larger than this many pixels
  (width times height). Useful for image-heavy scans; `0` means no limit. Reopen the PDF after
  changing it.

Both are resource-scoped, so you can set them for one folder of heavy documents and leave the
rest of your machine alone.

## Free memory for hidden tabs

By default the viewer stays alive when you switch tabs, so switching back is instant and the
exact scroll position, zoom and selection survive. That costs renderer memory per hidden PDF.
Set `pdfCaseReview.viewer.retainContextWhenHidden` to `false` (and reload the window) to release
a hidden tab's renderer instead; showing the tab reloads the viewer with your highlights intact.

## What the extension already does

- Annotations are read with bounded concurrency on open, so a 300-page file does not queue 300
  sequential round trips.
- PDFs above 50 MB are not re-parsed for inspection on open; the sidecar's records are trusted
  until the next save.
- Highlights, notes and reports work unchanged at any size; only rendering costs scale with the
  document.
