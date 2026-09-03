import { unzipSync, unzlibSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS } from "../../src/core/report/model";
import { renderReport } from "../../src/core/report/render";
import { SAMPLE_REPORT_INPUT as SAMPLE_INPUT } from "../../src/core/report/sample";

function inflatedStream(doc: PDFDocument, value: PDFObject | undefined): string {
  const stream = doc.context.lookup(value);
  if (!(stream instanceof PDFRawStream)) {
    return "";
  }
  const filter = String(stream.dict.get(PDFName.of("Filter")));
  const bytes = filter === "/FlateDecode" ? unzlibSync(stream.contents) : stream.contents;
  return new TextDecoder("latin1").decode(bytes);
}

/** A hex string's UTF-16 code units as text; a ligature target like `<0066 0069>` carries spaces. */
function utf16(hex: string): string {
  const units = hex.replace(/\s/g, "").match(/.{1,4}/g) ?? [];
  return String.fromCharCode(...units.map((unit) => Number.parseInt(unit, 16)));
}

/** Glyph id to text from a font's ToUnicode CMap (pdfkit writes bfrange entries with array targets). */
function glyphMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const [, body = ""] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, low = "", high = "", target = ""] of body.matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f\s]+>)/gi,
    )) {
      const start = Number.parseInt(low, 16);
      const targets = [...target.matchAll(/<([0-9a-f\s]+)>/gi)].map(([, hex = ""]) => hex);
      for (let code = start; code <= Number.parseInt(high, 16); code += 1) {
        const hex = targets.length > 1 ? targets[code - start] : targets[0];
        if (hex !== undefined) {
          map.set(
            code,
            targets.length > 1
              ? utf16(hex)
              : String.fromCharCode(Number.parseInt(hex.replace(/\s/g, ""), 16) + code - start),
          );
        }
      }
    }
  }
  for (const [, body = ""] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, source = "", target = ""] of body.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f\s]+)>/gi)) {
      map.set(Number.parseInt(source, 16), utf16(target));
    }
  }
  return map;
}

/** The text a PDF's content streams show, decoded through each font's ToUnicode CMap. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const lines: string[] = [];
  for (const page of doc.getPages()) {
    const fonts = new Map<string, Map<number, string>>();
    const fontDict = doc.context.lookup(page.node.Resources()?.get(PDFName.of("Font")));
    if (fontDict instanceof PDFDict) {
      for (const [name, value] of fontDict.entries()) {
        const font = doc.context.lookup(value);
        if (font instanceof PDFDict) {
          fonts.set(String(name), glyphMap(inflatedStream(doc, font.get(PDFName.of("ToUnicode")))));
        }
      }
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    const content = streams.map((stream) => inflatedStream(doc, stream)).join("\n");
    // pdfmake positions every word with its own text matrix, so a line is the words sharing a y.
    let glyphs = new Map<number, string>();
    let line = "";
    let lineY: string | undefined;
    for (const [, font, y, hex] of content.matchAll(
      /(\/\S+)\s+[\d.]+\s+Tf|(?:[\d.-]+\s+){5}([\d.-]+)\s+Tm|<([0-9a-f]+)>/gi,
    )) {
      if (font !== undefined) {
        glyphs = fonts.get(font) ?? new Map();
      } else if (y !== undefined) {
        if (y !== lineY) {
          lines.push(line);
          line = "";
          lineY = y;
        }
      } else if (hex !== undefined) {
        line += (hex.match(/.{1,4}/g) ?? [])
          .map((glyph) => glyphs.get(Number.parseInt(glyph, 16)) ?? "")
          .join("");
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

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

  it("carries the chronological section into Word by default", async () => {
    const report = await renderReport(SAMPLE_INPUT, "docx");
    const documentXml = new TextDecoder().decode(unzipSync(report.bytes)["word/document.xml"]);
    expect(documentXml).toContain("Notes in the order taken");
    expect(documentXml).not.toContain("Appendix: notes in reading order");
  }, 20_000);

  it("carries the chronological section into PDF by default", async () => {
    const report = await renderReport(SAMPLE_INPUT, "pdf");
    const text = await pdfText(report.bytes);
    expect(text).toContain("Notes in the order taken");
    expect(text).not.toContain("Appendix: notes in reading order");
  }, 20_000);

  it("produces Markdown as UTF-8 bytes", async () => {
    const report = await renderReport(SAMPLE_INPUT, "markdown");
    expect(new TextDecoder().decode(report.bytes)).toContain("# Acme Widgets");
  });
});
