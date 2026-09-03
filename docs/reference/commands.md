# Commands

All commands are under the **PDF Case Review** category in the Command Palette. The ones that act on a highlight take the highlight you right-clicked in the Highlights view, or the view's current selection.

While a PDF is the active editor, its tab's title bar carries icon buttons for the three headline commands: **Generate Report** ($(output)), **Summarize with AI** ($(sparkle), trusted workspaces only), **Add Document Note** ($(note)) and **Configure** ($(gear)), a hub for choosing the AI provider, adding a second AI account guided (it writes `ai.accounts` and `requiredAccount`, then opens a sign-in terminal), applying a category preset and jumping into the extension's settings. The viewer's own toolbar also holds a category dropdown; see [How to: categories](../how-to/categories.md).

## Highlights view

The **PDF Case Review** activity-bar icon opens the **Highlights** view for the active PDF. Rows show the highlighted passage (up to 60 characters) with its page; hover for the full quote and note. Grouping follows `pdfCaseReview.highlights.groupBy`. A **Document notes** group lists document-level notes first; in page grouping, a page's note appears above its highlights.

| Command | Where | What it does |
|---|---|---|
| `PDF Case Review: Go to Highlight` | click a row, `Ctrl+Alt+G`, palette | Scrolls the PDF to the highlight and flashes it. Invoked with nothing selected, it shows a picker of every highlight, so the viewer is reachable without a mouse. |
| `PDF Case Review: Edit Note` | `Ctrl+Alt+N`, click a note row, row context menu, palette | Opens the target in the **Note** view (below). With no selection it asks where the note should go (the page in view, or a document note). |
| `PDF Case Review: Set Category` | row context menu, palette | Picks another category for the highlight; the viewer recolors it and the PDF is updated on the next save. |
| `PDF Case Review: Delete Highlight` | row context menu (inline trash icon), palette | Deletes the highlight. When the viewer shows it, the deletion goes through PDF.js and `Ctrl+Z` inside the viewer brings it back with its note. |
| `PDF Case Review: Delete Note` | note row context menu (inline trash icon), palette | Deletes a page or document note. |
| `PDF Case Review: Copy Quote` | row context menu, palette | Copies the highlighted text. |
| `PDF Case Review: Group by Page` / `Group by Category` | view title | Switches the grouping (remembered in `pdfCaseReview.highlights.groupBy`). |
| `PDF Case Review: Reveal Sidecar` | view title, palette | Opens the document's `.pdf.review.json` in a text editor (after the first save). |

## Notes

The **Note** view (under Highlights in the activity bar) edits one target at a time: a highlight (with its quote, citation and a category dropdown), a page note, or a document note. The Markdown textarea autosaves as you type and on blur; **Reveal** jumps to the highlight or page in the viewer; **Delete** removes the target.

| Command | Where | What it does |
|---|---|---|
| `PDF Case Review: Add Page Note` | palette | One note per page (the current page when the viewer is open). Submitting an empty note removes it. |
| `PDF Case Review: Add Document Note` | `Ctrl+Alt+D`, palette | A titled note on the whole document, for example `Thesis`. |

## Reports

| Command | Where | What it does |
|---|---|---|
| `PDF Case Review: Generate Report` | `Ctrl+Alt+R`, palette | Renders the active document's highlights and notes to `pdfCaseReview.report.defaultFormat` (`ask` shows a picker). Output is `<name>.review.<md\|docx\|pdf>` beside the PDF or in `pdfCaseReview.report.outputFolder`; existing reports get a numbered copy unless `report.overwrite` is on. |
| `PDF Case Review: Generate Report As...` | palette | The same with a format picker every time. |
| `PDF Case Review: Export Annotated PDF...` | palette | Writes a copy of the PDF with your highlights embedded as real annotations, plus a sidecar beside it, to a path you choose (`<name>.annotated.pdf` by default). The original is never the destination. A publisher-protected PDF is copied byte-identical (never decrypted) and the highlights travel in the sidecar alone; the command says so every time. |

## AI (optional, off by default)

Every path below goes through the eligibility question first: the dialog names the signed-in account and the document, states exactly what will be sent, and asks whether it may be fed into AI context. By default only highlights and notes are sent; with `pdfCaseReview.ai.contextScope: "document-text"` the summary commands also send text extracted from the document, and a scope change always re-asks. The PDF file itself is never sent under either scope. AI text in reports renders in grey italics with a legend.

| Command | What it does |
|---|---|
| `PDF Case Review: Choose AI Provider...` | Probes the `claude` and `codex` CLIs and sets `pdfCaseReview.ai.provider`; unavailable options show a one-line fix. Picking Manual starts the clipboard flow. |
| `PDF Case Review: Summarize with AI` | The one entry point: with no provider configured it opens the provider picker first, then runs the configured CLI on your highlights and notes and caches the executive summary in the sidecar. Under `ai.contextScope: "document-text"` the prompt also carries the document text, extracted per page with citations, and the consent dialog shows the coverage (pages with extractable text, approximate words). Cancellable; 120 second timeout. |
| `PDF Case Review: Add AI Page Context...` | Offers pages with a dense, lightly-annotated highlight cluster (`ai.pageContext.minHighlights`), then asks the configured CLI for 2 to 4 sentences of context per picked page; one consent dialog covers the batch. Cached in the sidecar and rendered above those pages in the report. |
| `PDF Case Review: Copy Summary Prompt` | Puts the summary prompt and your notes on the clipboard for any chat; under `ai.contextScope: "document-text"` the copied prompt includes the document text too, after the same consent dialog. Works with the provider off. |
| `PDF Case Review: Paste AI Summary` | Saves the clipboard as the document's AI summary, labeled `manual`. |
| `PDF Case Review: Review AI Consent` | Shows the recorded attestation (account, provider, dates) and offers to revoke it. |

## Categories and keyboard highlighting

| Command | Where | What it does |
|---|---|---|
| `PDF Case Review: Highlight Selection with Category...` | `Ctrl+Alt+1` to `Ctrl+Alt+9` (`Cmd+Alt` on macOS) while the PDF has focus, or the palette | Turns the viewer's current text selection into a highlight of the Nth category in the document's palette. In PDF.js's highlight mode the mouse selection is already a highlight by the time you press the shortcut, so with no text selection the shortcut recolors the selected highlight instead; with neither, a hint is shown. Either way the category becomes the default for the next highlight. From the palette a picker lists the categories. |
| `PDF Case Review: Apply Category Preset...` | palette | Replaces `pdfCaseReview.categories` (user or workspace settings) with a preset: `Business case`, `Academic paper`, `Contract`, or one from `pdfCaseReview.categoryPresets`. New documents use it. |
| `PDF Case Review: Sync Categories from Settings` | palette | Copies the settings palette into the open document (each sidecar carries its own categories) and offers to save and reload the viewer so the new colors apply. Highlights whose category no longer exists show under "Uncategorized". |

## Status bar

While a PDF is active the status bar shows `$(notebook) N highlights · PDF synced`, `sidecar only` (protected PDF or embedding turned off), `unsaved`, or `PDF write failed`. Clicking it focuses the Highlights view.

## When the PDF changed outside the extension

Opening a document whose PDF bytes no longer match what the sidecar recorded shows a warning:
highlight positions may no longer line up. **Keep positions** accepts the current file (recorded
with the next save); dismissing changes nothing, and the warning returns on the next open.
Re-anchoring highlights to moved text is planned for a later release.

## Keyboard

The full table is in [Keybindings](keybindings.md). In short: `Ctrl+Alt+1..9` highlight with the Nth category, `Ctrl+Alt+N` edits the note, `Ctrl+Alt+D` adds a document note, `Ctrl+Alt+G` goes to a highlight, `Ctrl+Alt+H` focuses the Highlights view, `Ctrl+Alt+R` generates the report (`Cmd+Alt` on macOS). Inside the viewer, `Ctrl+S` (`Cmd+S`) saves through VS Code; PDF.js's own "save" (a download) is disabled. `Ctrl+Z` / `Ctrl+Y` inside the viewer undo and redo highlight edits through PDF.js; undoing back to the saved state does not clear the dirty flag (ADR-0005).
