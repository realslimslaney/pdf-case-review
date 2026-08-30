# PDF Case Review

> Highlight PDFs by category inside VS Code, add notes, and turn them into a printable Word / PDF / Markdown report.

**Status: 0.1.0 pre-release (highlight and persist).** Not on the Marketplace yet. See `docs/explanation/decisions.md` for the architecture decisions and the spike results.

Built for reading business-school cases (Fact, Financial, Strategic implication, Concern, Question), but the categories are yours to define, so it works just as well for papers, contracts and textbooks.

## What works today (0.1.0)

- Open any `.pdf` in VS Code with a full PDF.js viewer.
- Select text and use the highlight button, or press `Ctrl+Alt+1` to `Ctrl+Alt+9` (`Cmd+Alt` on macOS) to highlight with a category. Categories are yours to define; presets for business cases, academic papers and contracts are built in.
- The **Highlights** view lists everything by category or by page; click to jump, right-click to change the category, copy the quote or delete.
- Highlights are stored beside the PDF in `case.pdf.review.json` (the canonical copy) and written into the PDF as real annotations on save when the file allows it. Publisher-protected PDFs are never modified.
- Undo and redo inside the viewer work through PDF.js; hot exit keeps unsaved highlights.

## Coming next

- Notes on highlights, pages and the document, and the one-button report in Markdown, Word or PDF (0.3.0).
- Optional, off by default: an AI executive summary via Claude Code, Codex, Copilot or an API key, always behind an eligibility confirmation that shows which account is used.

## Purchased and protected PDFs

Commercially published case PDFs are usually encrypted with an owner password and a "no modify" permission. PDF Case Review never removes encryption or permission flags, not even for an exported copy. For those files your highlights and notes live in `case.pdf.review.json` beside the PDF (the sidecar is the canonical store in every case), you see a one-time notice, and everything else works: the sidebar, notes and the report. For unencrypted PDFs the highlights are also written into the file as real annotations on save, so other readers show them too; set `pdfCaseReview.pdf.embedOnSave` to `false` to keep PDFs byte-identical.

## Privacy & responsibility

The extension makes no network requests and collects no telemetry. If you enable an AI provider, only your highlighted excerpts and notes are sent (never the PDF), and only after you confirm the account being used. **You are responsible for using this tool on appropriate content; the developers of this extension are not liable for misuse.**

## Development

```sh
pnpm install
pnpm prepare-pdfjs   # vendors the pinned PDF.js viewer (pdfjs.lock.json)
pnpm fixtures        # synthetic test PDFs
pnpm build
pnpm check           # typecheck + lint + unit tests
pnpm test:integration
```

Press **F5** in VS Code to launch the extension against `test/fixtures`.

## Acknowledgements

The viewer integration is derived from [mathematic-inc/vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) (Apache-2.0) and rendering is by [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0). This project is not affiliated with or endorsed by either. See `NOTICE` and `THIRD_PARTY_NOTICES.md`.

## License

Apache-2.0 — see `LICENSE`.
