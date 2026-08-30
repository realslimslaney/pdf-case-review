# Settings

All settings live under `pdfCaseReview.*`. Unless noted, they have `resource` scope, so a workspace or folder can override them.

## Categories

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.categories` | Fact, Financial, Strategic implication, Concern, Question | The highlight palette for new documents. Each entry needs a unique `id` (lowercase letters, digits, dashes), a `name` and a unique `#RRGGBB` `color`; the color is how the viewer tells categories apart. An invalid setting falls back to the defaults with a warning. Categories are copied into each document's sidecar when it is created, so changing the setting does not alter existing documents. |

## Storage

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.sidecar.location` | `beside` | Where highlights and notes are stored. `beside`: `case.pdf.review.json` next to the PDF. `folder`: `<workspace>/.pdf-case-review/<relative path>.review.json`, which keeps them out of directories you do not control. A PDF outside the workspace always gets its file beside it. Changing this does not move existing files. |
| `pdfCaseReview.pdf.embedOnSave` | `true` | On save, rewrite an unencrypted PDF so the highlights become real annotations that other readers show (the sidecar stays canonical). Publisher-protected PDFs are never modified regardless. Turn off to keep PDFs byte-identical, for example when they are committed to git. |

## Highlights view

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.highlights.groupBy` | `category` | Whether the Highlights view groups rows by category (palette order) or by page (reading order). The view's title buttons toggle it. |

## Viewer

| Setting | Default | Meaning |
|---|---|---|
| `pdfCaseReview.viewer.defaultZoom` | `auto` | Zoom when a PDF opens: `auto`, `page-actual`, `page-fit`, `page-width` or a percentage. |
| `pdfCaseReview.viewer.sidebarOnLoad` | `0` | PDF.js sidebar panel to show on open: `-1` restore previous, `0` none, `1` thumbnails, `2` outline, `3` attachments, `4` layers. |
