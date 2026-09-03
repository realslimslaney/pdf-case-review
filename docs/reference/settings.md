# Settings

All settings live under `pdfCaseReview.*`. Unless noted, they have `resource` scope, so a workspace or folder can override them.

## Categories

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.categories` | Fact, Financial, Strategic implication, Concern, Question | The highlight palette for new documents. Each entry needs a unique `id` (lowercase letters, digits, dashes), a `name` and a unique `#RRGGBB` `color`; the color is how the viewer tells categories apart. An invalid setting falls back to the defaults with a warning. Categories are copied into each document's sidecar when it is created, so changing the setting does not alter existing documents. |
| `pdfCaseReview.categoryPresets` | `{}` | Extra palettes for **Apply Category Preset**, keyed by name; `Business case`, `Academic paper` and `Contract` are built in. Same item shape as `categories`. `window` scope. |

## Storage

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.sidecar.location` | `beside` | Where highlights and notes are stored. `beside`: `case.pdf.review.json` next to the PDF. `folder`: `<workspace>/.pdf-case-review/<relative path>.review.json`, which keeps them out of directories you do not control. A PDF outside the workspace always gets its file beside it. Changing this does not move existing files. |
| `pdfCaseReview.pdf.embedOnSave` | `true` | On save, rewrite an unencrypted PDF so the highlights become real annotations that other readers show (the sidecar stays canonical). Publisher-protected PDFs are never modified regardless. Turn off to keep PDFs byte-identical, for example when they are committed to git. |

## Highlights view

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.highlights.groupBy` | `category` | Whether the Highlights view groups rows by category (palette order) or by page (reading order). The view's title buttons toggle it. `window` scope. |

## Report

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.report.defaultFormat` | `ask` | Format for **Generate Report** (`Ctrl+Alt+R`): `ask` shows a picker; `markdown`, `docx` or `pdf` render immediately. |
| `pdfCaseReview.report.organization` | `none` | Grouped sections added after the chronological notes: `none` (notes appear once, in the order they were taken), `category`, `page`, or `both` (category sections plus a reading-order appendix). Reports always open with the chronological notes and close with the AI summary; cached AI page contexts render above their pages' entries in every organization. |
| `pdfCaseReview.report.outputFolder` | `""` | Where reports are written. Empty writes beside the PDF; a relative path is resolved against the workspace folder. Ignored in untrusted workspaces. |
| `pdfCaseReview.report.quoteMaxChars` | `300` | Longest quoted passage, truncated at a word boundary; `0` means unlimited. |
| `pdfCaseReview.report.author` | `""` | Author line in the title block; empty omits it. |
| `pdfCaseReview.report.includeEmptyCategories` | `false` | Show categories with no highlights in the summary table and body. |
| `pdfCaseReview.report.usePageLabels` | `true` | Cite the PDF's own page labels when they differ from page numbers, as `p. iv [4]`. |
| `pdfCaseReview.report.overwrite` | `false` | Overwrite an existing `<name>.review.<ext>`; off writes a numbered copy. |

## AI (optional, off by default)

Nothing leaves your machine unless a provider is enabled or you copy the prompt yourself; only highlights and notes are ever sent, never the PDF. Every run passes the eligibility question naming the signed-in account. See [the AI reviewer how-to](../how-to/ai-reviewer.md).

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.ai.provider` | `off` | `off`, `claude-cli` (spawns `claude`) or `codex-cli` (spawns `codex`). CLI providers need desktop VS Code and a trusted workspace. |
| `pdfCaseReview.ai.model` | `""` | Model passed to the CLI (`--model`); empty uses the CLI's default. |
| `pdfCaseReview.ai.includeInReport` | `true` | Include the cached AI summary as a labeled, grey-italics section of generated reports. |
| `pdfCaseReview.ai.maxWords` | `250` | Word budget for the executive summary. |
| `pdfCaseReview.ai.pageContext.minHighlights` | `4` | **Add AI Page Context** offers pages with at least this many highlights where fewer than half carry notes. |
| `pdfCaseReview.ai.requiredAccount` | `[]` | Rules refusing the AI step under the wrong login. The first rule whose `when` matches (`protected`, `authorizationLineMatches`, `pathGlob`) applies; `email` names the account that must be signed in (no override) and `use` selects an entry of `ai.accounts`. |
| `pdfCaseReview.ai.accounts` | `[]` | Separate CLI login directories (`{id, provider, configDir}`) for people with more than one account; the extension sets `CLAUDE_CONFIG_DIR` / `CODEX_HOME` on the spawned CLI itself. The account's `provider` must match `pdfCaseReview.ai.provider`; a matched rule selecting a mismatched account is refused with a configuration error, so a run can never execute under a different CLI or login than the one the consent dialog verified. |
| `pdfCaseReview.ai.requireVerifiedAccountForProtected` | `true` | Refuse CLI providers on publisher-protected documents when the login cannot be verified from the CLI's saved credentials; the manual clipboard path asks for an extra acknowledgment instead. |

## Viewer

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.viewer.defaultZoom` | `auto` | Zoom when a PDF opens: `auto`, `page-actual`, `page-fit`, `page-width` or a percentage. |
| `pdfCaseReview.viewer.sidebarOnLoad` | `0` | PDF.js sidebar panel to show on open: `-1` restore previous, `0` none, `1` thumbnails, `2` outline, `3` attachments, `4` layers. |
| `pdfCaseReview.viewer.maxCanvasPixels` | `0` | Largest canvas area (in pixels) a page may render at; larger pages render at reduced resolution. `0` keeps the PDF.js default. Lower it on memory-constrained machines for very large documents; applies when the PDF is reopened. See [very large PDFs](../how-to/large-pdfs.md). |
| `pdfCaseReview.viewer.maxImageSize` | `0` | Largest decoded image (width times height, in pixels); larger images are skipped. `0` keeps the PDF.js default (no limit). Applies when the PDF is reopened. |
| `pdfCaseReview.viewer.retainContextWhenHidden` | `true` | Keep the viewer alive while its tab is hidden, so switching back is instant. Turn off to free renderer memory for hidden tabs; the viewer then reloads (highlights intact) when shown again. `window` scope; takes effect after reloading the window. |
