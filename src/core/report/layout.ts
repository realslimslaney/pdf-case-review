// Turns a ReportModel into a flat list of layout blocks — the one place that decides what the
// report looks like, so the Markdown, Word and PDF renderers cannot drift from each other.

import { lexer, type Token, type Tokens } from "marked";

import type { ReportItem, ReportModel } from "./model";

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; color?: string }
  | { kind: "paragraph"; runs: TextRun[]; muted?: boolean }
  | { kind: "keyValues"; entries: [string, string][] }
  | { kind: "table"; header: string[]; rows: string[][]; swatches: (string | null)[] }
  | { kind: "quote"; text: string; citation: string; color: string }
  | { kind: "bullets"; items: TextRun[][] }
  | { kind: "pageBreak" };

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
  const quote = item.quote === "" ? `[image region, ${item.citation}]` : item.quote;
  blocks.push({
    kind: "quote",
    text: withCategoryPrefix ? `${item.category.name}: ${quote}` : quote,
    citation: item.citation,
    color: item.category.color,
  });
  blocks.push(...noteToBlocks(item.note));
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

  if (model.aiSummary) {
    const { provider, model: modelName, account, generatedAt, attestedAt, text } = model.aiSummary;
    blocks.push({ kind: "heading", level: 2, text: "AI summary" });
    blocks.push(...noteToBlocks(text));
    blocks.push({
      kind: "paragraph",
      muted: true,
      runs: [
        {
          text: `Generated with ${provider}${modelName ? ` (${modelName})` : ""}${account ? ` as ${account}` : ""} on ${generatedAt}${attestedAt ? `; eligibility attested on ${attestedAt}` : ""}.`,
          italic: true,
        },
      ],
    });
  }

  blocks.push({ kind: "heading", level: 2, text: "Summary" });
  blocks.push({
    kind: "table",
    header: ["Category", "Highlights", "With notes", "Pages"],
    rows: model.summary.map((row) => [row.category.name, `${row.count}`, `${row.withNotes}`, row.pages]),
    swatches: model.summary.map((row) => row.category.color),
  });

  if (model.documentNotes.length > 0) {
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
        blocks.push({ kind: "paragraph", muted: true, runs: [{ text: "No highlights.", italic: true }] });
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
      if (section.pageNote) {
        blocks.push(...noteToBlocks(section.pageNote));
      }
      for (const item of section.items) {
        blocks.push(...itemBlocks(item, true));
      }
    }
  }

  return blocks;
}
