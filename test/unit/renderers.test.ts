import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS } from "../../src/core/report/model";
import { renderReport } from "../../src/core/report/render";
import { SAMPLE_REPORT_INPUT as SAMPLE_INPUT } from "../../src/core/report/sample";

describe("renderReport", () => {
  it("produces a Word document whose XML carries the headings, quotes and page numbers", async () => {
    const report = await renderReport(SAMPLE_INPUT, "docx", {
      ...DEFAULT_REPORT_OPTIONS,
      organization: "both",
    });
    expect(report.extension).toBe("docx");
    const files = unzipSync(report.bytes);
    const documentXml = new TextDecoder().decode(files["word/document.xml"]);
    expect(documentXml).toContain("Acme Widgets (A): The Pricing Decision");
    expect(documentXml).toContain("Gross margin: 2023 41.0 percent");
    expect(documentXml).toContain("Appendix: notes in reading order");
    expect(documentXml).toContain('w:val="Heading1"');
    expect(documentXml).toContain('w:fill="53FFBC"');
    const footerXml = new TextDecoder().decode(files["word/footer1.xml"]);
    expect(footerXml).toContain("PAGE");
  }, 20_000);

  it("produces a multi-page PDF with embedded Roboto", async () => {
    const report = await renderReport(SAMPLE_INPUT, "pdf", {
      ...DEFAULT_REPORT_OPTIONS,
      organization: "both",
    });
    expect(report.extension).toBe("pdf");
    expect(Array.from(report.bytes.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const doc = await PDFDocument.load(report.bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toContain("Acme Widgets");
    const raw = new TextDecoder("latin1").decode(report.bytes);
    expect(raw).toContain("Roboto");
  }, 20_000);

  it("produces Markdown as UTF-8 bytes", async () => {
    const report = await renderReport(SAMPLE_INPUT, "markdown");
    expect(new TextDecoder().decode(report.bytes)).toContain("# Acme Widgets");
  });
});
