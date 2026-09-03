import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PAGE_CONTEXT_PROMPT_VERSION, pageContextInputDigest } from "../../src/core/ai/pageContext";
import { reportInputFromSidecar } from "../../src/core/report/fromSidecar";
import { buildReportModel, DEFAULT_REPORT_OPTIONS } from "../../src/core/report/model";
import { renderReport } from "../../src/core/report/render";
import { SAMPLE_SHA256, sampleSidecar } from "./helpers/sampleSidecar";

const CONTEXT = { generatedAt: "2026-09-02T10:00:00.000Z", includeAiSummary: true };

describe("reportInputFromSidecar", () => {
  it("maps source, categories, highlights and notes", () => {
    const input = reportInputFromSidecar(sampleSidecar(), CONTEXT);
    expect(input.title).toBe("Acme Widgets (A): The Pricing Decision");
    expect(input.sourceFileName).toBe("acme-widgets-a.pdf");
    expect(input.pageCount).toBe(3);
    expect(input.generatedAt).toBe(CONTEXT.generatedAt);
    expect(input.categories.map((category) => category.id)).toEqual([
      "fact",
      "financial",
      "strategic",
      "concern",
      "question",
    ]);
    const financial = input.highlights.find((highlight) => highlight.categoryId === "financial");
    expect(financial).toMatchObject({ page: 2, pageLabel: "2", top: 512.4, left: 72 });
    expect(input.pageNotes?.[0]).toMatchObject({ page: 3 });
    expect(input.documentNotes?.[0]).toMatchObject({ title: "Thesis" });
    expect(input.author).toBeUndefined();
    expect(input.aiSummary).toBeUndefined();
  });

  it("falls back to the file name for the title and to viewer labels for pages", () => {
    const sidecar = sampleSidecar();
    delete sidecar.source.title;
    const [first] = sidecar.highlights;
    if (first) {
      delete first.pageLabel;
    }
    const input = reportInputFromSidecar(sidecar, { ...CONTEXT, pageLabels: ["i", "II", "iii"] });
    expect(input.title).toBe("acme-widgets-a");
    expect(input.highlights[0]?.pageLabel).toBe("II");
    expect(input.highlights[1]?.pageLabel).toBe("i");
    expect(input.pageNotes?.[0]?.pageLabel).toBe("iii");
  });

  it("trims the author, honors the live page count and sorts document notes by creation", () => {
    const sidecar = sampleSidecar();
    sidecar.documentNotes = [
      {
        id: "later",
        title: "Later",
        note: "x",
        createdAt: "2026-09-02T09:00:00.000Z",
        updatedAt: "2026-09-02T09:00:00.000Z",
      },
      ...(sidecar.documentNotes ?? []),
    ];
    const input = reportInputFromSidecar(sidecar, { ...CONTEXT, author: "  Bren  ", pageCount: 7 });
    expect(input.author).toBe("Bren");
    expect(input.pageCount).toBe(7);
    expect(input.documentNotes?.map((note) => note.title)).toEqual(["Thesis", "Later"]);
    expect(reportInputFromSidecar(sidecar, { ...CONTEXT, author: "   " }).author).toBeUndefined();
  });

  it("includes the AI summary only when asked, stamping attestedAt only for the same file revision", () => {
    const sidecar = sampleSidecar();
    sidecar.aiSummary = { provider: "manual", generatedAt: "2026-09-02T09:30:00.000Z", text: "Summary." };
    sidecar.aiConsent = {
      provider: "manual",
      email: "you@school.edu",
      verified: false,
      documentSha256: SAMPLE_SHA256,
      attestedAt: "2026-09-02T09:29:00.000Z",
      responsibilityAcknowledged: true,
    };
    const included = reportInputFromSidecar(sidecar, CONTEXT);
    expect(included.aiSummary).toMatchObject({ provider: "manual", attestedAt: "2026-09-02T09:29:00.000Z" });
    expect(
      reportInputFromSidecar(sidecar, { ...CONTEXT, includeAiSummary: false }).aiSummary,
    ).toBeUndefined();
    sidecar.aiConsent = { ...sidecar.aiConsent, documentSha256: "f".repeat(64) };
    expect(reportInputFromSidecar(sidecar, CONTEXT).aiSummary?.attestedAt).toBeUndefined();
  });

  it("feeds buildReportModel: empty categories appear only when included", () => {
    const input = reportInputFromSidecar(sampleSidecar(), CONTEXT);
    const withEmpty = buildReportModel(input, { ...DEFAULT_REPORT_OPTIONS, includeEmptyCategories: true });
    expect(withEmpty.summary.map((row) => row.category.id)).toContain("fact");
    expect(withEmpty.summary.find((row) => row.category.id === "fact")?.count).toBe(0);
    const withoutEmpty = buildReportModel(input);
    expect(withoutEmpty.summary.map((row) => row.category.id)).toEqual(["financial", "question"]);
  });

  it("carries long bullet notes into the rendered Markdown", async () => {
    const sidecar = sampleSidecar();
    const [first] = sidecar.highlights;
    if (first) {
      first.note = "- pricing pressure on every SKU\n- cost base is fixed\n\n**Net:** margins keep falling";
    }
    const input = reportInputFromSidecar(sidecar, CONTEXT);
    const report = await renderReport(input, "markdown");
    const text = new TextDecoder().decode(report.bytes);
    expect(text).toContain("- pricing pressure on every SKU");
    expect(text).toContain("**Net:**");
  });

  it("sets AI-generated text apart with a legend and grey italics in every format", async () => {
    const sidecar = sampleSidecar();
    sidecar.aiSummary = {
      provider: "manual",
      generatedAt: "2026-09-02T09:30:00.000Z",
      text: "A crisp executive summary.\n\n- tension one\n- tension two",
    };
    const input = reportInputFromSidecar(sidecar, CONTEXT);
    const markdown = new TextDecoder().decode((await renderReport(input, "markdown")).bytes);
    expect(markdown).toContain("Italic grey text marks AI-generated content");
    expect(markdown).toContain("*A crisp executive summary.*");
    expect(markdown).toContain("- *tension one*");
    expect(markdown).toContain("Generated with manual on 2026-09-02T09:30:00.000Z.");
    const word = await renderReport(input, "docx");
    const documentXml = new TextDecoder().decode(unzipSync(word.bytes)["word/document.xml"]);
    expect(documentXml).toContain("Italic grey text marks AI-generated content");
    const summaryRun = /<w:r>(?:(?!<\/w:r>)[\s\S])*?A crisp executive summary\.[\s\S]*?<\/w:r>/.exec(
      documentXml,
    )?.[0];
    expect(summaryRun).toBeTruthy();
    expect(summaryRun).toContain("<w:i/>");
    expect(summaryRun).toContain("666666");
  }, 30_000);

  it("renders a fromSidecar-derived input through Word and PDF", async () => {
    const input = reportInputFromSidecar(sampleSidecar(), CONTEXT);
    const word = await renderReport(input, "docx");
    const documentXml = new TextDecoder().decode(unzipSync(word.bytes)["word/document.xml"]);
    expect(documentXml).toContain("Acme Widgets (A): The Pricing Decision");
    expect(documentXml).toContain("Thesis");
    expect(documentXml).toContain("Gross margin fell from 41");
    const pdf = await renderReport(input, "pdf");
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("highlight kind", () => {
  it("carries the kind so the layout can tell an image region from a failed capture", () => {
    const model = sampleSidecar();
    model.highlights = [
      {
        ...(model.highlights[0] as (typeof model.highlights)[number]),
        quadPoints: [],
        kind: "free",
        text: "",
      },
    ];
    const input = reportInputFromSidecar(model, CONTEXT);
    expect(input.highlights[0]?.kind).toBe("free");
    expect(buildReportModel(input, DEFAULT_REPORT_OPTIONS).byPage[0]?.items[0]?.kind).toBe("free");
  });
});

describe("aiPageContexts mapping", () => {
  it("maps fresh contexts and flags stale or version-bumped ones", () => {
    const sidecar = sampleSidecar();
    sidecar.aiPageContexts = [
      {
        page: 2,
        provider: "claude-cli",
        generatedAt: "2026-09-02T10:00:00.000Z",
        text: "Context for page 2.",
        inputDigest: pageContextInputDigest(sidecar, 2),
        promptVersion: PAGE_CONTEXT_PROMPT_VERSION,
      },
      {
        page: 1,
        provider: "claude-cli",
        generatedAt: "2026-09-02T10:00:00.000Z",
        text: "Context for page 1 from older content.",
        inputDigest: "0000000000000000",
        promptVersion: PAGE_CONTEXT_PROMPT_VERSION,
      },
    ];
    const input = reportInputFromSidecar(sidecar, { ...CONTEXT, pageLabels: ["i", "ii", "iii"] });
    expect(input.pageContexts?.map((entry) => [entry.page, entry.stale === true])).toEqual([
      [2, false],
      [1, true],
    ]);
    expect(input.pageContexts?.[0]?.pageLabel).toBe("ii");
  });

  it("drops AI content entirely when includeAiSummary is off", () => {
    const sidecar = sampleSidecar();
    sidecar.aiPageContexts = [
      { page: 2, provider: "claude-cli", generatedAt: "2026-09-02T10:00:00.000Z", text: "x" },
    ];
    const input = reportInputFromSidecar(sidecar, { ...CONTEXT, includeAiSummary: false });
    expect(input.pageContexts).toBeUndefined();
  });
});
