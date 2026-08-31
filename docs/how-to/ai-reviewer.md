# Use Claude Code or Codex as your reviewer

Two independent ways to bring AI into a review, both optional and off by default. Either way, only your highlighted excerpts and notes are involved, never the PDF itself, and the report sets AI text apart in grey italics with a legend.

## A. The built-in executive summary

1. Install a CLI and sign in once: `npm i -g @anthropic-ai/claude-code` then run `claude`, or `npm i -g @openai/codex` then run `codex`.
2. Run **PDF Case Review: Choose AI Provider...**. The picker probes both CLIs and shows, per option, the signed-in account or a one-line install fix.
3. Open your case and run **PDF Case Review: Summarize with AI**.

Before anything is sent you answer one direct question: *may this document be fed into AI context on this account?* The dialog names the signed-in email (read from the CLI's own saved login, never from asking a model), shows the document's authorization line when page 1 has one ("authorized for use only by..."), and counts what will be sent. Answering yes records the attestation in the sidecar; the report's AI section is stamped with provider, model, account and dates. Cancel and nothing is sent; the report still renders without a summary.

The summary is cached in the sidecar (`aiSummary`), so re-rendering the report never re-calls the model; **Summarize with AI** offers to regenerate.

### No CLI? Use the clipboard

**PDF Case Review: Copy Summary Prompt** passes the same eligibility question, then puts the prompt and your notes on the clipboard. Paste into claude.ai, chatgpt.com or any chat, copy the answer, and run **Paste AI Summary**. It is saved and reported like any other provider's output, labeled `manual`.

### Enforce the right account

If some documents must only be processed under a specific login (a school account, say), add a rule:

```jsonc
// settings.json
"pdfCaseReview.ai.requiredAccount": [
  { "when": { "protected": true }, "email": "you@school.edu" }
]
```

When a rule matches and the signed-in email differs, the AI step is refused with no override; sign out of the CLI (`/logout` in `claude`), sign in with the right account, and retry. Rules can also match on `authorizationLineMatches` (a regex against the document's own authorization line) or `pathGlob`.

### Two accounts without logging out

If you switch accounts often, keep a second CLI login in its own directory and register it:

```jsonc
"pdfCaseReview.ai.accounts": [
  { "id": "school", "provider": "claude-cli", "configDir": "~/.claude-school" }
],
"pdfCaseReview.ai.requiredAccount": [
  { "when": { "protected": true }, "email": "you@school.edu", "use": "school" }
]
```

To create that login once, run the CLI with the directory set, for example in PowerShell: `$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-school"; claude` and sign in. From then on the extension sets `CLAUDE_CONFIG_DIR` (or `CODEX_HOME`) on the spawned CLI itself and verifies the email it finds there; you never export environment variables for VS Code.

## B. The agent reads your notes directly

Because the sidecar is plain JSON, a terminal agent can work with your notes without any integration. In Claude Code or Codex, from the folder with your case:

> Read `ferrari-2025.pdf.review.json`. It follows the schema at
> <https://raw.githubusercontent.com/realslimslaney/pdf-case-review/main/schemas/review.schema.json>:
> highlights with categories, quotes and notes, plus page and document notes.
> Summarize my notes by category, flag contradictions between highlights,
> and draft three discussion questions for class.

Reusable version for a repo: drop the same instructions into `AGENTS.md`, or as a Claude Code skill in `.claude/skills/pdf-case-review/SKILL.md`:

```markdown
---
name: pdf-case-review
description: Work with PDF Case Review sidecars (<file>.pdf.review.json) when the user asks about their reading notes or highlights.
---

Sidecars follow schemas/review.schema.json from realslimslaney/pdf-case-review:
`highlights[]` carry categoryId, page, text (the quote) and note; `pageNotes[]` and
`documentNotes[]` carry page and document level notes; `categories[]` maps ids to names.
Cite quotes with their page. Never invent content that is not in the file; say so when
the notes do not cover a question.
```

This "ask questions about my notes" path sends whatever your agent reads to your agent's provider under your own CLI login, so the same eligibility judgment applies: it is your responsibility to use it on content your account may process.
