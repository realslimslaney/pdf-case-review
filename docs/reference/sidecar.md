# The sidecar file (`<file>.pdf.review.json`)

Every reviewed PDF gets one sidecar file. It is the canonical store for highlights and notes (ADR-0002); the PDF is re-synced from it on save when the file allows it. The JSON Schema is `schemas/review.schema.json`, and VS Code validates `*.review.json` files against it as you type.

## Location

`case.pdf` gets `case.pdf.review.json` in the same folder (`pdfCaseReview.sidecar.location: "beside"`, the default). With `"folder"` the sidecars are collected under `<workspace>/.pdf-case-review/<relative path>.review.json` instead, which keeps them out of a folder you do not control.

## Example

```json
{
  "$schema": "https://raw.githubusercontent.com/realslimslaney/pdf-case-review/main/schemas/review.schema.json",
  "categories": [
    { "color": "#FFFF98", "id": "fact", "name": "Fact", "order": 0 },
    { "color": "#53FFBC", "id": "financial", "name": "Financial", "order": 1 },
    { "color": "#80EBFF", "id": "strategic", "name": "Strategic implication", "order": 2 },
    { "color": "#FF4F5F", "id": "concern", "name": "Concern", "order": 3 },
    { "color": "#FFCBE6", "id": "question", "name": "Question", "order": 4 }
  ],
  "documentNotes": [
    {
      "createdAt": "2026-09-01T14:03:00.000Z",
      "id": "thesis",
      "note": "Hold price to protect share; fix the cost base next year.",
      "title": "Thesis",
      "updatedAt": "2026-09-01T14:03:00.000Z"
    }
  ],
  "generator": "pdf-case-review/0.1.0",
  "highlights": [
    {
      "categoryId": "question",
      "createdAt": "2026-09-01T14:01:00.000Z",
      "id": "0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f",
      "kind": "text",
      "note": "",
      "page": 1,
      "pageLabel": "i",
      "quadPoints": [72, 652, 400, 652, 72, 640, 400, 640],
      "rect": [72, 640, 400, 652],
      "text": "Why did the board approve the plan?",
      "updatedAt": "2026-09-01T14:01:00.000Z"
    },
    {
      "categoryId": "financial",
      "createdAt": "2026-09-01T14:00:00.000Z",
      "id": "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      "kind": "text",
      "note": "Core tension: pricing pressure against the cost base.",
      "page": 2,
      "pageLabel": "2",
      "pdfjsId": "12R",
      "quadPoints": [72, 512.4, 300.1, 512.4, 72, 500.2, 300.1, 500.2],
      "rect": [72, 500.2, 300.1, 512.4],
      "text": "Gross margin fell from 41% to 33% in FY22.",
      "updatedAt": "2026-09-01T14:05:10.000Z"
    }
  ],
  "pageNotes": [
    {
      "createdAt": "2026-09-01T14:02:00.000Z",
      "note": "Exhibit 2 contradicts the narrative on page 1.",
      "page": 3,
      "updatedAt": "2026-09-01T14:02:00.000Z"
    }
  ],
  "source": {
    "byteLength": 123456,
    "fileName": "acme-widgets-a.pdf",
    "lastEmbeddedAt": "2026-09-01T14:05:10.000Z",
    "pageCount": 3,
    "pdfWrite": "synced",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "title": "Acme Widgets (A): The Pricing Decision"
  },
  "version": 1
}
```

## Fields

### Top level

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Format version, currently `1`. Older files are migrated on open; newer ones are refused with a message to update the extension. |
| `$schema` | no | Points at the published schema so editors validate the file. |
| `generator` | no | `pdf-case-review/<version>` that last wrote the file. |
| `source` | yes | The PDF this sidecar belongs to (below). |
| `categories` | yes | The category palette copied into the file so it is self-describing (below). |
| `highlights` | yes | One entry per highlight (below). |
| `pageNotes`, `documentNotes` | no | Notes attached to a page or to the whole document (`page`, `note`, timestamps; document notes also have `id` and `title`). |
| `aiConsent`, `aiSummary`, `aiPageContexts` | no | The recorded eligibility attestation and the cached AI summary and page contexts, when those features are used (below). |

### `source`

| Field | Required | Meaning |
|---|---|---|
| `fileName` | yes | File name of the PDF (no directory). |
| `sha256` | yes | Lowercase hex SHA-256 of the PDF bytes the sidecar was last saved against. A mismatch on open means the PDF changed outside the extension. |
| `byteLength`, `pageCount` | yes | Of the same bytes. |
| `title` | no | Document title from the PDF metadata, when present. |
| `encrypted` | no | `true` once the PDF was found to be encrypted or permission-restricted; such files are never modified. |
| `lastEmbeddedAt` | no | When highlights were last embedded into the PDF. |
| `pdfWrite` | no | Outcome of the last save for the PDF itself: `synced`, `skipped-protected`, `skipped-setting` (`pdfCaseReview.pdf.embedOnSave` is off) or `failed`. |

### `categories[]`

`id` (lowercase letters, digits, dashes), `name`, `color` (`#RRGGBB`, uppercase), `order` (display position), optional `description`. Colors must be unique within a file: the color is how the viewer tells categories apart.

### `highlights[]`

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | UUID assigned when the highlight first appeared. Stable forever; also written into the PDF annotation as `/NM`. |
| `categoryId` | yes | A category `id`; highlights whose category no longer exists show under "Uncategorized". |
| `page` | yes | 1-based page number. `pageLabel` carries the PDF's own label (`"iv"`, `"A-2"`) when it differs. |
| `pdfjsId` | no | The id PDF.js gives the embedded annotation (`<objectNumber>R`). Refreshed every time the PDF is re-synced; absent when the highlight is not embedded (protected PDF, embedding off, or not saved yet). |
| `rect`, `quadPoints` | yes | Geometry in PDF user space, verbatim from PDF.js. `quadPoints` comes in groups of 8 and is empty for `free` highlights. |
| `outlines`, `rotation` | no | Extra PDF.js drawing data, kept so the highlight can be re-created in the viewer. |
| `kind` | yes | `text` (selected text) or `free` (drawn over an image; `text` may then be empty). |
| `text` | yes | The highlighted passage, whitespace-normalized, hyphenated line breaks re-joined. |
| `context` | no | `before` / `after` snippets for re-anchoring (reserved for 1.1). |
| `note` | yes | Your note, Markdown subset; empty string when there is none. |
| `createdAt`, `updatedAt` | yes | ISO 8601 timestamps. `updatedAt` moves on user-visible edits (category, geometry, note), not on bookkeeping such as a refreshed `pdfjsId`. |

### `aiConsent`

Written when the eligibility question is answered yes; shown and revoked by **Review AI Consent**.

| Field | Required | Meaning |
|---|---|---|
| `provider`, `email`, `verified` | yes | Which provider the consent was given for, the account named in the dialog, and whether that email was read from the CLI's own saved login (`true`) or typed by the user (`false`). |
| `documentSha256` | yes | The PDF revision the consent applies to; a changed file re-asks. |
| `attestedAt`, `responsibilityAcknowledged` | yes | When, and that the responsibility statement was part of the dialog. |
| `eligibilityConfirmed` | no | The explicit yes to "may this document be fed into AI context on this account?". |
| `accountId`, `organization`, `authorizationLine`, `wordingVersion` | no | The `ai.accounts` entry used, the account's organization, the document's own authorization line as shown in the dialog, and the dialog wording version (a change re-asks). |

### `aiSummary`

The cached executive summary: `provider` (`claude-cli`, `codex-cli` or `manual`), optional `model` and `account`, `generatedAt`, and `text` (Markdown). Reports render it as a labeled section in grey italics; regenerating replaces it.

Optional `inputDigest` and `promptVersion` record what the summary was generated from (a digest of the highlights, notes, categories and word budget, and the prompt template version). When they no longer match the current review, reports add a "may be out of date" line to the AI section and **Summarize with AI** says the cache predates your changes; the summary is never withheld. Summaries saved before these fields existed are treated as possibly out of date.

### `aiPageContexts`

Cached AI context per page, from **Add AI Page Context**: each entry carries `page` plus the same provenance and staleness fields as `aiSummary` (`provider`, optional `model` and `account`, `generatedAt`, `text`, `inputDigest`, `promptVersion`). The digest covers only that page's highlights and page note, so editing page 4 never marks page 3's context stale. Entries are ordered by `page`; regenerating a page replaces its entry.

## How the file is written

- Keys are sorted at every level, indentation is two spaces, line endings are LF and the file ends with a newline, so diffs stay small.
- `highlights` are in reading order: page, then top edge descending, then left edge, then `id`. `categories` are ordered by `order`, `pageNotes` and `aiPageContexts` by `page`, `documentNotes` by creation time.
- The sidecar is written before the PDF, so an interrupted save never loses notes (see ADR-0005 in `docs/explanation/decisions.md` for why writes are not temp-and-rename).
- Editing the file by hand is fine; unknown properties and malformed values are rejected on open with the JSON path of the problem, and the document then opens read-only until the file is fixed.
