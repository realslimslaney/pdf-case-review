import { describe, expect, it } from "vitest";
import { layoutReport, noteToBlocks } from "../../src/core/report/layout";
import {
  buildReportModel,
  DEFAULT_REPORT_OPTIONS,
  formatCitation,
  formatPageList,
  normalizeQuote,
  truncateQuote,
} from "../../src/core/report/model";
import { renderMarkdown } from "../../src/core/report/renderMarkdown";
import { SAMPLE_REPORT_INPUT as SAMPLE_INPUT } from "../../src/core/report/sample";

describe("model helpers", () => {
  it("normalizes whitespace and hyphenated line breaks", () => {
    expect(normalizeQuote("Beta Fas-\ntenerS  and   more")).toBe("Beta FastenerS and more");
  });

  it("truncates at a word boundary with an ellipsis", () => {
    expect(truncateQuote("one two three four", 9)).toBe("one two…");
    expect(truncateQuote("short", 0)).toBe("short");
  });

  it("formats citations with page labels only when they differ from the index", () => {
    expect(formatCitation(4, "iv", true)).toBe("p. iv [4]");
    expect(formatCitation(4, "4", true)).toBe("p. 4");
    expect(formatCitation(4, "iv", false)).toBe("p. 4");
  });

  it("collapses page lists into ranges", () => {
    expect(formatPageList([9, 3, 5, 7, 8, 3])).toBe("3, 5, 7–9");
    expect(formatPageList([1, 2])).toBe("1, 2");
    expect(formatPageList([])).toBe("");
  });
});

describe("buildReportModel", () => {
  const model = buildReportModel(SAMPLE_INPUT);

  it("orders items by page then top-of-page and formats quotes", () => {
    expect(model.byPage.map((section) => section.page)).toEqual([1, 2, 3]);
    expect(model.byPage[0]?.items.map((item) => item.id)).toEqual(["h1", "h3"]);
    expect(model.byPage[0]?.items[1]?.quote).toBe(
      "Kim was worried that a blanket increase would hand share to Beta FastenerS.",
    );
    expect(model.byPage[0]?.heading).toBe("Page i [1]");
  });

  it("builds the summary and routes unknown categories to Uncategorized", () => {
    expect(model.summary.map((row) => [row.category.name, row.count, row.withNotes, row.pages])).toEqual([
      ["Fact", 1, 0, "1"],
      ["Financial", 1, 1, "2"],
      ["Concern", 1, 1, "1"],
      ["Uncategorized", 1, 0, "3"],
    ]);
    expect(model.meta).toMatchObject({ highlightCount: 4, noteCount: 4 });
  });

  it("keeps empty categories when asked", () => {
    const withEmpty = buildReportModel(SAMPLE_INPUT, {
      ...DEFAULT_REPORT_OPTIONS,
      includeEmptyCategories: true,
    });
    expect(withEmpty.byCategory.map((section) => section.category.id)).toEqual([
      "fact",
      "financial",
      "strategic",
      "concern",
      "question",
      "uncategorized",
    ]);
  });
});

describe("noteToBlocks", () => {
  it("parses paragraphs, emphasis and bullets and ignores unsupported syntax", () => {
    expect(noteToBlocks("Eight points — **pricing**, not *volume*.\n\n- one\n- two `x`")).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "Eight points — " },
          { text: "pricing", bold: true },
          { text: ", not " },
          { text: "volume", italic: true },
          { text: "." },
        ],
      },
      { kind: "bullets", items: [[{ text: "one" }], [{ text: "two " }, { text: "x", code: true }]] },
    ]);
    expect(noteToBlocks("   ")).toEqual([]);
  });
});

describe("layout + markdown", () => {
  it("renders chronological notes by default", () => {
    const markdown = renderMarkdown(layoutReport(buildReportModel(SAMPLE_INPUT)));
    expect(markdown).toContain("# Acme Widgets (A): The Pricing Decision");
    expect(markdown).toContain("- **Highlights:** 4 highlights · 4 notes");
    expect(markdown).toContain("| Financial `#53FFBC` | 1 | 1 | 2 |");
    expect(markdown).toContain("## Thesis");
    expect(markdown).toContain(
      "> Financial: Gross margin: 2023 41.0 percent; 2024 37.2 percent; 2025 33.1 percent. *(p. 2)*",
    );
    expect(markdown).toContain("Eight points in two years — **pricing**, not volume.");
    expect(markdown).toContain("## Notes in the order taken");
    expect(markdown).not.toContain("## Appendix");
    expect(markdown).not.toContain("## Document notes");
    expect(markdown).toContain("> Concern: Kim was worried");
    expect(markdown).toContain("### Page note · p. 3");
    expect(markdown).toContain("The real question is cost to serve.");
    expect(markdown.endsWith("\n")).toBe(true);
    expect(renderMarkdown(layoutReport(buildReportModel(SAMPLE_INPUT)))).toBe(markdown);
  });

  it("orders chronological entries by createdAt with unstamped ones last", () => {
    const model = buildReportModel(SAMPLE_INPUT);
    expect(
      model.chronological.map((entry) => (entry.kind === "highlight" ? entry.item.id : entry.kind)),
    ).toEqual(["documentNote", "h1", "h3", "h2", "pageNote", "h4"]);
  });

  it("adds grouped sections and the reading-order appendix for organization both", () => {
    const markdown = renderMarkdown(
      layoutReport(buildReportModel(SAMPLE_INPUT, { ...DEFAULT_REPORT_OPTIONS, organization: "both" })),
    );
    expect(markdown).toContain("## Document notes");
    expect(markdown).toContain(
      "> Gross margin: 2023 41.0 percent; 2024 37.2 percent; 2025 33.1 percent. *(p. 2 · Financial)*",
    );
    expect(markdown).toContain("## Appendix: notes in reading order");
    expect(markdown).toContain("### Page i [1]");
  });

  it("omits the appendix for category-only organization", () => {
    const markdown = renderMarkdown(
      layoutReport(buildReportModel(SAMPLE_INPUT, { ...DEFAULT_REPORT_OPTIONS, organization: "category" })),
    );
    expect(markdown).not.toContain("Appendix");
    expect(markdown).not.toContain("### Page i");
  });
});

describe("empty quotes by highlight kind", () => {
  const input = {
    ...SAMPLE_INPUT,
    highlights: [
      { id: "free1", categoryId: "fact", page: 2, kind: "free" as const, text: "", note: "A chart." },
      { id: "lost1", categoryId: "fact", page: 3, text: "", note: "" },
    ],
  };

  it("labels a free highlight as an image region and a failed capture as no text", () => {
    const markdown = renderMarkdown(
      layoutReport(buildReportModel(input, { ...DEFAULT_REPORT_OPTIONS, organization: "category" })),
    );
    // Category sections name the category in the citation: the color bar alone must never be
    // the only category marker on a quote.
    expect(markdown).toContain("> [image region] *(p. 2 · Fact)*");
    expect(markdown).toContain("> (no text captured) *(p. 3 · Fact)*");
  });
});
