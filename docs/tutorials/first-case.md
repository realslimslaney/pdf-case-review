# Your first case, start to finish

This walkthrough takes about fifteen minutes: open a real business-school case, highlight it by category, add notes, and generate a report you can print or share.

## What you need

- VS Code with the PDF Case Review extension installed.
- A case PDF. We use *Ferrari in 2025: Balancing Tradition and Innovation to Grow* from the MIT Sloan Teaching Resources Library, which is free to download (CC BY-NC-ND 4.0, credit to the authors): search for "Ferrari in 2025 MIT Sloan" or browse <https://mitsloan.mit.edu/teaching-resources-library>. Any PDF works, including your own purchased cases.

Download the PDF into a folder and open that folder in VS Code.

## 1. Open the case

Click the PDF in the Explorer. It opens in the PDF Case Review viewer, and the extension's activity-bar icon (the pen) shows the **Highlights** and **Note** views.

## 2. Highlight by category

Read with your hands on the keyboard. Select a passage and press:

- `Ctrl+Alt+1` for **Fact** (yellow)
- `Ctrl+Alt+2` for **Financial** (green)
- `Ctrl+Alt+3` for **Strategic implication** (blue)
- `Ctrl+Alt+4` for **Concern** (red)
- `Ctrl+Alt+5` for **Question** (pink)

(`Cmd+Alt` on macOS.) You can also select text and use the floating highlight button, then pick a color: each color is a category. Try it on Ferrari's shipment numbers (Financial), the brand-exclusivity strategy (Strategic implication), and anything you want to raise in class (Question).

Every highlight appears in the **Highlights** view, grouped by category. The title-bar buttons switch to page grouping.

## 3. Add notes

- Press `Ctrl+Alt+N` with a highlight selected (or click a row in the Highlights view, or right-click it and choose **Edit Note**). The **Note** view opens with the quote, its category, and a Markdown textarea that saves as you type.
- Press `Ctrl+Alt+D` for a **document note**: give it a title like `Thesis` and write your overall take.
- Run **PDF Case Review: Add Page Note** for a note on the current page, for example "Exhibit 2 contradicts page 1".

Save the PDF (`Ctrl+S`). Your highlights and notes are stored in `<case>.pdf.review.json` beside the PDF, and, for unprotected PDFs, embedded into the file as real annotations. Publisher-protected PDFs are never modified; the sidecar holds everything.

## 4. Generate the report

Press `Ctrl+Alt+R` and pick a format: Markdown, Word or PDF. The report lands beside the case as `<case>.review.md` (or `.docx` / `.pdf`) and opens from the notification. It has a summary table, your document notes, every quote with its citation and note by category, and a per-page appendix. Word and Acrobat open the outputs directly.

Settings under `pdfCaseReview.report.*` control the format, organization, output folder and quote length.

## 5. Optional: an AI executive summary

This is off by default and never required. If you want one, run **PDF Case Review: Choose AI Provider...**, then **Summarize with AI**, or use **Copy Summary Prompt** to paste your notes into any chat yourself and **Paste AI Summary** to bring the answer back. Before anything is sent, the extension asks whether the document may be fed into AI context on the signed-in account, names that account, and by default only your highlights and notes are sent, never the PDF file itself. In the report, AI text is set apart in grey italics with a legend. See [Using Claude Code or Codex as a reviewer](../how-to/ai-reviewer.md).

If the dialog names the wrong account (your personal login instead of the one licensed for the document), use its **Wrong account? Show how to switch** button; nothing is sent, and the short version is: run `claude`, type `/logout`, sign in with the right account, then retry. The how-to also shows how to keep two logins side by side so you never log out.

## Where to go next

- Change the palette: **Apply Category Preset** or the `pdfCaseReview.categories` setting.
- Read [the sidecar reference](../reference/sidecar.md) to see what is stored, or commit the sidecar to git and keep the PDF out.
