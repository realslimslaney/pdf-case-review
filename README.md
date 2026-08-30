# PDF Case Review

> Highlight PDFs by category inside VS Code, add notes, and turn them into a printable Word / PDF / Markdown report.

**Status: pre-alpha (architecture spikes).** Nothing is published yet. See `docs/explanation/decisions.md` for the architecture decisions and the spike results as they land.

Built for reading business-school cases (Fact, Financial, Strategic implication, Concern, Question), but the categories are yours to define, so it works just as well for papers, contracts and textbooks.

## What it will do (1.0)

- Open any `.pdf` in VS Code with a full PDF.js viewer.
- Select text → pick a category → it's highlighted in that category's color. Keyboard: `Ctrl+Alt+1…9`.
- Attach a note to each highlight; add page-level and document-level notes.
- A sidebar lists everything by category or by page; click to jump.
- **Generate report** → Markdown, Word (`.docx`) or PDF, organized by category and/or page, with page citations.
- Highlights are stored beside the PDF in `case.pdf.review.json` and synced into the PDF as real annotations when the file allows it. Publisher-protected PDFs are never modified.
- Optional, off by default: an AI executive summary via Claude Code, Codex, Copilot or an API key, always behind an eligibility confirmation that shows which account is used.

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
