// Turns a ReportModel into a flat list of layout blocks: the one place that decides what the
// report looks like, so the Markdown, Word and PDF renderers cannot drift from each other.

import { lexer, type Token, type Tokens } from "marked";

import { IMAGE_REGION_LABEL, NO_TEXT_LABEL } from "../tree";
import type { ReportItem, ReportModel, ReportPageContext } from "./model";

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; color?: string }
  | { kind: "paragraph"; runs: TextRun[]; muted?: boolean; generated?: boolean }
  | { kind: "keyValues"; entries: [string, string][] }
  | { kind: "table"; header: string[]; rows: string[][]; swatches: (string | null)[] }
  | { kind: "quote"; text: string; citation: string; color: string }
  | { kind: "bullets"; items: TextRun[][]; generated?: boolean }
  | { kind: "pageBreak" };

export const AI_LEGEND = "Italic grey text marks AI-generated content; it is not the reader's own writing.";

/** Flags AI-generated blocks so every renderer sets them apart (grey italics) from the reader's text. */
function markGenerated(blocks: ReportBlock[]): ReportBlock[] {
  return blocks.map((block) =>
    block.kind === "paragraph" || block.kind === "bullets" ? { ...block, generated: true } : block,
  );
}

function inlineRuns(tokens: Token[] | undefined, style: Partial<TextRun> = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text":
      case "escape":
        runs.push({ text: (token as Tokens.Text).text, ...style });
        break;
      case "strong":
        runs.push(...inlineRuns((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns((token as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case "codespan":
        runs.push({ text: (token as Tokens.Codespan).text, ...style, code: true });
        break;
      case "link":
        runs.push(...inlineRuns((token as Tokens.Link).tokens, style));
        break;
      case "br":
        runs.push({ text: "\n", ...style });
        break;
      default:
        if ("raw" in token && typeof token.raw === "string") {
          runs.push({ text: token.raw, ...style });
        }
    }
  }
  return runs;
}

/** Notes are Markdown; only paragraphs, bullets, bold, italic and code spans are honoured. */
export function noteToBlocks(note: string): ReportBlock[] {
  if (note.trim() === "") {
    return [];
  }
  const blocks: ReportBlock[] = [];
  for (const token of lexer(note)) {
    switch (token.type) {
      case "paragraph":
        blocks.push({ kind: "paragraph", runs: inlineRuns((token as Tokens.Paragraph).tokens) });
        break;
      case "list":
        blocks.push({
          kind: "bullets",
          items: (token as Tokens.List).items.map((item) => {
            const inner = item.tokens.flatMap((inner) =>
              inner.type === "text" || inner.type === "paragraph"
                ? inlineRuns(
                    (inner as Tokens.Text).tokens ?? [
                      { type: "text", raw: inner.raw, text: inner.raw } as Token,
                    ],
                  )
                : [{ text: inner.raw }],
            );
            return inner;
          }),
        });
        break;
      case "heading":
        blocks.push({
          kind: "paragraph",
          runs: inlineRuns((token as Tokens.Heading).tokens, { bold: true }),
        });
        break;
      case "space":
        break;
      default:
        blocks.push({ kind: "paragraph", runs: [{ text: token.raw.trim() }] });
    }
  }
  return blocks;
}

function itemBlocks(item: ReportItem, withCategoryPrefix: boolean): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  // The same labels the Highlights tree uses: a free highlight marks a region of a scanned page,
  // while an empty text highlight simply failed to capture its passage. The block's own citation
  // carries the page either way.
  const quote = item.quote !== "" ? item.quote : item.kind === "free" ? IMAGE_REGION_LABEL : NO_TEXT_LABEL;
  blocks.push({
    kind: "quote",
    text: withCategoryPrefix ? `${item.category.name}: ${quote}` : quote,
    // Without the prefix, the color bar would be the only per-quote category marker, which fails
    // without color vision or when a quote is read out of its section; name it in the citation.
    citation: withCategoryPrefix ? item.citation : `${item.citation} · ${item.category.name}`,
    color: item.category.color,
  });
  blocks.push(...noteToBlocks(item.note));
  return blocks;
}

function pageContextBlocks(context: ReportPageContext): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  blocks.push({ kind: "heading", level: 3, text: `AI context · ${context.citation}` });
  if (context.stale) {
    blocks.push({
      kind: "paragraph",
      muted: true,
      runs: [
        {
          text:
            "This context may be out of date: the page's highlights or notes changed after it was " +
            "generated.",
        },
      ],
    });
  }
  blocks.push(...markGenerated(noteToBlocks(context.text)));
  blocks.push({
    kind: "paragraph",
    muted: true,
    runs: [
      {
        text: `Generated with ${context.provider}${context.model ? ` (${context.model})` : ""}${context.account ? ` as ${context.account}` : ""} on ${context.generatedAt}.`,
      },
    ],
  });
  return blocks;
}

export function layoutReport(model: ReportModel): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const { meta, options } = model;

  blocks.push({ kind: "heading", level: 1, text: model.title });
  blocks.push({
    kind: "keyValues",
    entries: [
      ["Source", `${meta.sourceFileName} (${meta.pageCount} pages)`],
      ...(meta.author ? [["Author", meta.author] as [string, string]] : []),
      ["Generated", meta.generatedAt],
      ["Highlights", `${meta.highlightCount} highlights · ${meta.noteCount} notes`],
    ],
  });

  const hasAiContent =
    model.aiSummary !== null || model.chronological.some((entry) => entry.kind === "pageContext");
  if (hasAiContent) {
    blocks.push({ kind: "paragraph", muted: true, runs: [{ text: AI_LEGEND }] });
  }

  blocks.push({ kind: "heading", level: 2, text: "Summary" });
  blocks.push({
    kind: "table",
    header: ["Category", "Highlights", "With notes", "Pages"],
    rows: model.summary.map((row) => [row.category.name, `${row.count}`, `${row.withNotes}`, row.pages]),
    swatches: model.summary.map((row) => row.category.color),
  });

  if (model.chronological.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: "Notes in the order taken" });
    for (const entry of model.chronological) {
      switch (entry.kind) {
        case "highlight":
          blocks.push(...itemBlocks(entry.item, true));
          break;
        case "pageNote":
          blocks.push({ kind: "heading", level: 3, text: `Page note · ${entry.citation}` });
          blocks.push(...noteToBlocks(entry.note));
          break;
        case "documentNote":
          blocks.push({ kind: "heading", level: 3, text: entry.title });
          blocks.push(...noteToBlocks(entry.note));
          break;
        case "pageContext":
          blocks.push(...pageContextBlocks(entry.context));
          break;
      }
    }
  }

  if (options.organization !== "none" && model.documentNotes.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: "Document notes" });
    for (const note of model.documentNotes) {
      blocks.push({ kind: "heading", level: 3, text: note.title });
      blocks.push(...noteToBlocks(note.note));
    }
  }

  if (options.organization === "category" || options.organization === "both") {
    for (const section of model.byCategory) {
      blocks.push({ kind: "heading", level: 2, text: section.category.name, color: section.category.color });
      if (section.items.length === 0) {
        blocks.push({ kind: "paragraph", muted: true, runs: [{ text: "No highlights." }] });
      }
      for (const item of section.items) {
        blocks.push(...itemBlocks(item, false));
      }
    }
  }

  if (options.organization === "page" || options.organization === "both") {
    if (options.organization === "both") {
      blocks.push({ kind: "pageBreak" });
      blocks.push({ kind: "heading", level: 2, text: "Appendix: notes in reading order" });
    }
    for (const section of model.byPage) {
      blocks.push({ kind: "heading", level: options.organization === "both" ? 3 : 2, text: section.heading });
      if (section.context) {
        blocks.push(...pageContextBlocks(section.context));
      }
      if (section.pageNote) {
        blocks.push(...noteToBlocks(section.pageNote));
      }
      for (const item of section.items) {
        blocks.push(...itemBlocks(item, true));
      }
    }
  }

  if (model.aiSummary) {
    const {
      provider,
      model: modelName,
      account,
      generatedAt,
      attestedAt,
      text,
      stale,
      contextScope,
    } = model.aiSummary;
    blocks.push({ kind: "heading", level: 2, text: "AI summary" });
    if (stale) {
      blocks.push({
        kind: "paragraph",
        muted: true,
        runs: [
          {
            text:
              "This summary may be out of date: highlights or notes changed after it was generated. " +
              "Run Summarize with AI again to refresh it.",
          },
        ],
      });
    }
    blocks.push(...markGenerated(noteToBlocks(text)));
    blocks.push({
      kind: "paragraph",
      muted: true,
      runs: [
        {
          text: `Generated with ${provider}${modelName ? ` (${modelName})` : ""}${account ? ` as ${account}` : ""}${contextScope === "document-text" ? " using document text" : ""} on ${generatedAt}${attestedAt ? `; eligibility attested on ${attestedAt}` : ""}.`,
        },
      ],
    });
  }

  return blocks;
}
