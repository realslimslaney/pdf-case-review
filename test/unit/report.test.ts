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

describe("AI page context in the report", () => {
  const withContext = {
    ...SAMPLE_INPUT,
    pageContexts: [
      {
        page: 1,
        pageLabel: "i",
        text: "These passages establish the channel-mix problem.",
        provider: "claude-cli",
        account: "you@school.edu",
        generatedAt: "2026-09-01T14:10:00.000Z",
      },
      {
        page: 99,
        text: "Orphaned context for a page with no highlights.",
        provider: "claude-cli",
        generatedAt: "2026-09-01T14:10:00.000Z",
        stale: true,
      },
    ],
  };

  it("sits above the page's first chronological entry, with legend and provenance", () => {
    const markdown = renderMarkdown(layoutReport(buildReportModel(withContext)));
    expect(markdown).toContain("Italic grey text marks AI-generated content");
    const context = markdown.indexOf("AI context · p. i [1]");
    const firstPageOneEntry = markdown.indexOf("Distributors now accounted");
    expect(context).toBeGreaterThan(-1);
    expect(context).toBeLessThan(firstPageOneEntry);
    expect(markdown).toContain("These passages establish the channel-mix problem.");
    expect(markdown).toContain("Generated with claude-cli as you@school.edu on 2026-09-01T14:10:00.000Z.");
    expect(markdown).not.toContain("Orphaned context");
  });

  it("marks a stale context and renders inside grouped page sections too", () => {
    const stale = {
      ...withContext,
      pageContexts: [{ ...withContext.pageContexts[0], stale: true } as (typeof withContext.pageContexts)[0]],
    };
    const markdown = renderMarkdown(
      layoutReport(buildReportModel(stale, { ...DEFAULT_REPORT_OPTIONS, organization: "page" })),
    );
    expect(markdown).toContain("This context may be out of date");
    const section = markdown.indexOf("## Page i [1]");
    const context = markdown.lastIndexOf("AI context · p. i [1]");
    expect(section).toBeGreaterThan(-1);
    expect(context).toBeGreaterThan(section);
  });

  it("shows no legend when the report holds no AI content", () => {
    const markdown = renderMarkdown(layoutReport(buildReportModel(SAMPLE_INPUT)));
    expect(markdown).not.toContain("Italic grey text");
  });
});

describe("notes in the order taken", () => {
  it("omits document and page notes that hold no text", () => {
    const input = {
      ...SAMPLE_INPUT,
      pageNotes: [{ page: 3, note: "   ", createdAt: "2026-08-30T10:15:00Z" }],
      documentNotes: [{ title: "Blank thesis", note: "", createdAt: "2026-08-30T09:55:00Z" }],
    };
    const markdown = renderMarkdown(layoutReport(buildReportModel(input)));
    expect(markdown).toContain("## Notes in the order taken");
    expect(markdown).not.toContain("## Blank thesis");
    expect(markdown).not.toContain("### Page note");
  });

  it("orders timestamped entries by instant even when string order disagrees", () => {
    // "2026-01-01T06:00:00Z" sorts first as a string, but 10:00 at +05:00 is 05:00Z: the earlier instant.
    const input = {
      ...SAMPLE_INPUT,
      highlights: [],
      pageNotes: [],
      documentNotes: [
        { title: "Six Zulu", note: "Later by instant.", createdAt: "2026-01-01T06:00:00Z" },
        { title: "Ten plus five", note: "Earlier by instant.", createdAt: "2026-01-01T10:00:00+05:00" },
      ],
    };
    const markdown = renderMarkdown(layoutReport(buildReportModel(input)));
    const plusFive = markdown.indexOf("## Ten plus five");
    const zulu = markdown.indexOf("## Six Zulu");
    expect(plusFive).toBeGreaterThan(-1);
    expect(zulu).toBeGreaterThan(plusFive);
  });
});

describe("AI summary cautions", () => {
  const summary = { provider: "manual", generatedAt: "2026-09-01T14:10:00.000Z", text: "Summary." };

  it("words an unverified summary and a stale one differently", () => {
    const unverified = renderMarkdown(
      layoutReport(buildReportModel({ ...SAMPLE_INPUT, aiSummary: { ...summary, unverified: true } })),
    );
    expect(unverified).toContain("could not be checked");
    expect(unverified).not.toContain("This summary may be out of date");
    const stale = renderMarkdown(
      layoutReport(buildReportModel({ ...SAMPLE_INPUT, aiSummary: { ...summary, stale: true } })),
    );
    expect(stale).toContain("This summary may be out of date");
    expect(stale).not.toContain("could not be checked");
  });
});
