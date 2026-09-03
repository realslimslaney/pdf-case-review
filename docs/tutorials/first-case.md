# Your first case, start to finish

This walkthrough takes about fifteen minutes: open a real business-school case, highlight it by
category, add notes, and generate a report you can print or share. Everything is done with the mouse;
each step also lists the keyboard shortcut for when you want to keep your hands on the keys.

## What you need

- VS Code with the PDF Case Review extension installed. New to VS Code? Start with
  [Set up your computer](setup.md) and come back here.
- A case PDF. We use *Ferrari in 2025: Balancing Tradition and Innovation to Grow* from the MIT Sloan
  Teaching Resources Library, which is free to download (CC BY-NC-ND 4.0, credit to the authors): search
  for "Ferrari in 2025 MIT Sloan" or browse <https://mitsloan.mit.edu/teaching-resources-library>. Any
  PDF works, including your own purchased cases.

Download the PDF into a folder and open that folder in VS Code (**File > Open Folder...**).

## 1. Open the case and find your way around

Click the PDF in the Explorer (the file list on the left). It opens in the PDF Case Review viewer. Three
places on the screen matter from here on:

- **The activity bar**, the strip of icons on the far left. The pen icon is PDF Case Review; click it to
  show the **Highlights** view (every highlight and note, grouped by category) with the **Note** view
  below it. Keyboard: `Ctrl+Alt+H` focuses Highlights.
- **The tab's title bar**, the row of small icons at the top right of the PDF tab. Left to right:
  **Generate Report**, **Summarize with AI**, **Add Document Note** and **Configure...** (the gear).
  Hover over any of them to see its name.
- **The viewer toolbar**, inside the PDF itself along the top. Its right-hand group has a colored dot
  next to a **Category for new highlights** dropdown, then the **Highlight** pen button.

`Ctrl` is `Cmd` on macOS throughout.

## 2. Highlight by category

1. In the viewer toolbar, pick a category in the **Category for new highlights** dropdown. Start with
   **Financial**.
2. Drag across a passage to select it, for example Ferrari's shipment numbers.
3. Click the small **Highlight** button that pops up right at your selection. The passage takes the
   category's color and a row appears in the **Highlights** view.

Repeat with the brand-exclusivity strategy (**Strategic implication**) and anything you want to raise
in class (**Question**). The pen button in the toolbar does the same as the pop-up, and its color
swatches are named after your categories, so clicking a swatch is another way to switch.

Keyboard: select the text and press the category's number.

| Category | Color | Keyboard |
|---|---|---|
| Fact | yellow | `Ctrl+Alt+1` |
| Financial | green | `Ctrl+Alt+2` |
| Strategic implication | blue | `Ctrl+Alt+3` |
| Concern | red | `Ctrl+Alt+4` |
| Question | pink | `Ctrl+Alt+5` |

`Ctrl+Alt+6` to `9` reach categories you add later (see [Set up categories](../how-to/categories.md)).

Picked the wrong category? Right-click the row in the **Highlights** view and choose **Set Category**,
or press the number with nothing selected: it recolors the highlight selected in the view. The view's
title bar has a button that regroups rows by page instead of by category, and a trash icon appears on
each row when you hover.

## 3. Add notes

Click a row in the **Highlights** view. The PDF scrolls to the passage and the **Note** view shows the
quote, its page and category, and a Markdown text box that saves as you type. Under the box,
**Reveal** jumps back to the passage and **Delete** removes the highlight with its note. Keyboard:
`Ctrl+Alt+N` opens the selected highlight's note.

For your overall take, click **Add Document Note** in the tab's title bar (the note icon), give it a
title like `Thesis`, and write. Keyboard: `Ctrl+Alt+D`.

For a note on a whole page, such as "Exhibit 2 contradicts page 1", open the Command Palette with
`Ctrl+Shift+P`, type `page note` and run **PDF Case Review: Add Page Note**. The palette is the search
box for every command in VS Code; anything without a button is reachable from there.

Save with `Ctrl+S`. Your highlights and notes are stored in `<case>.pdf.review.json` beside the PDF
and, for unprotected PDFs, embedded into the file as real annotations. Publisher-protected PDFs are
never modified; the sidecar holds everything.

## 4. Generate the report

Click **Generate Report** in the tab's title bar (the leftmost icon) and pick a format: Markdown, Word
or PDF. Keyboard: `Ctrl+Alt+R`.

The report lands beside the case as `<case>.review.md` (or `.docx` / `.pdf`) and opens from the
notification. It opens with a summary table per category, then every quote with its category, page
citation and note in the order you took them, with your page and document notes in between. Word and
Acrobat open the outputs directly.

Two related commands live in the Command Palette: **Generate Report As...** asks for the format every
time, and **Export Annotated PDF...** writes a copy of the PDF with your highlights embedded.
Settings under `pdfCaseReview.report.*` control the format, output folder and quote length;
`pdfCaseReview.report.organization` adds grouped sections by category, by page, or both with a
per-page appendix.

## 5. Optional: an AI executive summary

This is off by default and never required. If you want one, click **Summarize with AI** in the tab's
title bar (the sparkle icon). The first time, it opens a picker for Claude Code, Codex or Manual;
Manual puts the prompt on your clipboard for any chat, and **Paste AI Summary** in the Command Palette
brings the answer back. The gear at the end of the row, **Configure...**, holds the same provider
picker plus **Add an AI Account...** for a second login.

Before anything is sent, the extension asks whether the document may be fed into AI context on the
signed-in account, names that account, and states exactly what goes out: your highlights, your notes and
the document's extracted text (a setting narrows that to notes only), never the PDF file itself. (The
very first time, a one-off notice about using AI features responsibly comes first; agree to it to enable
AI features at all.) In the report, AI text is set apart in grey italics with a legend. See
[Using Claude Code or Codex as a reviewer](../how-to/ai-reviewer.md).

If the dialog names the wrong account (your personal login instead of the one licensed for the
document), use its **Wrong account? Show how to switch** button; nothing is sent, and the short version
is: run `claude`, type `/logout`, sign in with the right account, then retry. To keep a personal and
a school login side by side so you never log out, see
[Use personal and school Claude accounts](../how-to/two-claude-accounts.md).

## Where to go next

- Every shortcut in one place: [Keybindings](../reference/keybindings.md). Every button and command:
  [Commands](../reference/commands.md).
- Change the palette: **Configure... > Apply Category Preset...** or the `pdfCaseReview.categories`
  setting.
- Read [the sidecar reference](../reference/sidecar.md) to see what is stored, or commit the sidecar
  to git and keep the PDF out.
