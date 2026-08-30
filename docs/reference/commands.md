# Commands

All commands are under the **PDF Case Review** category in the Command Palette. The ones that act on a highlight take the highlight you right-clicked in the Highlights view, or the view's current selection.

## Highlights view

The **PDF Case Review** activity-bar icon opens the **Highlights** view for the active PDF. Rows show the highlighted passage (up to 60 characters) with its page; hover for the full quote and note. Grouping follows `pdfCaseReview.highlights.groupBy`.

| Command | Where | What it does |
|---|---|---|
| `PDF Case Review: Go to Highlight` | click a row | Scrolls the PDF to the highlight and flashes it. |
| `PDF Case Review: Set Category` | row context menu, palette | Picks another category for the highlight; the viewer recolors it and the PDF is updated on the next save. |
| `PDF Case Review: Delete Highlight` | row context menu (inline trash icon), palette | Deletes the highlight. When the viewer shows it, the deletion goes through PDF.js and `Ctrl+Z` inside the viewer brings it back with its note. |
| `PDF Case Review: Copy Quote` | row context menu, palette | Copies the highlighted text. |
| `PDF Case Review: Group by Page` / `Group by Category` | view title | Switches the grouping (remembered in `pdfCaseReview.highlights.groupBy`). |
| `PDF Case Review: Reveal Sidecar` | view title, palette | Opens the document's `.pdf.review.json` in a text editor (after the first save). |

## Status bar

While a PDF is active the status bar shows `$(notebook) N highlights · PDF synced`, `sidecar only` (protected PDF or embedding turned off), `unsaved`, or `PDF write failed`. Clicking it focuses the Highlights view.

## Keyboard

Inside the viewer, `Ctrl+S` (`Cmd+S`) saves through VS Code; PDF.js's own "save" (a download) is disabled. `Ctrl+Z` / `Ctrl+Y` inside the viewer undo and redo highlight edits through PDF.js; undoing back to the saved state does not clear the dirty flag (ADR-0005).
