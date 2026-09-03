# PDF Case Review

> Highlight PDFs by category inside VS Code, add notes, and turn them into a printable Word / PDF / Markdown report.

**Status: 0.3.0 pre-release (notes and report).** Not on the Marketplace yet. See `docs/explanation/decisions.md` for the architecture decisions and the spike results.

Built for reading business-school cases (Fact, Financial, Strategic implication, Concern, Question), but the categories are yours to define, so it works just as well for papers, contracts and textbooks.

<!-- TODO(listing): 20-second GIF over a CC-licensed case goes here before the Marketplace listing.
<img src="media/demo.gif" alt="Highlighting a case and generating a report" width="720"> -->

## Features

| | |
|---|---|
| **Highlight by category** | Select text and use the highlight button, or `Ctrl+Alt+1` to `Ctrl+Alt+9` (`Cmd+Alt` on macOS). Categories are yours to define; presets for business cases, academic papers and contracts are built in. |
| **Notes everywhere** | A note on every highlight (`Ctrl+Alt+N`), on a page, and on the whole document (`Ctrl+Alt+D`), edited in the Note view with Markdown and autosave. |
| **Highlights view** | Everything by category or by page: click to jump, right-click to recategorize, copy the quote, edit or delete. |
| **One-button report** | `Ctrl+Alt+R` renders your quotes and notes to Markdown, Word or PDF: summary table, per-category sections, page appendix, page labels in citations. |
| **Plain-text storage** | Highlights and notes live beside the PDF in `case.pdf.review.json` (the canonical copy) and are written into unencrypted PDFs as real annotations on save. Publisher-protected PDFs are never modified. |
| **Optional AI summary** | Off by default. Claude Code or Codex CLI drafts an executive summary from your highlights and notes, behind an eligibility check that always names the signed-in account; or copy the prompt into any chat yourself. |

Undo and redo inside the viewer work through PDF.js; hot exit keeps unsaved highlights.

## Purchased and protected PDFs

Commercially published case PDFs are usually encrypted with an owner password and a "no modify" permission. PDF Case Review never removes encryption or permission flags, not even for an exported copy. For those files your highlights and notes live in `case.pdf.review.json` beside the PDF (the sidecar is the canonical store in every case), you see a one-time notice, and everything else works: the sidebar, notes and the report. For unencrypted PDFs the highlights are also written into the file as real annotations on save, so other readers show them too; set `pdfCaseReview.pdf.embedOnSave` to `false` to keep PDFs byte-identical.

## Privacy & responsibility

The extension makes no network requests and collects no telemetry. Nothing leaves your machine unless you enable an AI provider or copy the summary prompt yourself, and even then only your highlighted excerpts, your notes and the document's extracted text are sent, after a consent dialog that states exactly what goes out. Set `pdfCaseReview.ai.contextScope` to `notes` to keep the PDF's text on your machine; the PDF file itself is never sent.

Before any excerpt reaches a model, the extension asks directly: may this document be fed into AI context on this account? The dialog names the signed-in account (read from the CLI's own saved login), shows the document's authorization line when it has one, and records your answer with your notes. You can require a specific account for protected documents (`pdfCaseReview.ai.requiredAccount`); the wrong login is refused with no override. **You are responsible for using this tool on appropriate content; the developers of this extension are not liable for misuse.**

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

Apache-2.0, see `LICENSE`.
