import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  type EmbeddableHighlight,
  embedHighlights,
  isProtectedPdf,
  ProtectedPdfError,
  readEmbeddedHighlights,
} from "../../src/core/pdfExport/embedHighlights";

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["Page one text", "Page two text"]) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 12, font });
  }
  return doc.save();
}

const highlights: EmbeddableHighlight[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    page: 1,
    rect: [72, 695, 200, 712],
    quadPoints: [72, 712, 200, 712, 72, 695, 200, 695],
    color: "#53FFBC",
    note: "Margin fell — core tension.",
    categoryName: "Financial",
    updatedAt: "2026-09-01T14:05:10Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    page: 2,
    rect: [72, 695, 150, 712],
    quadPoints: [72, 712, 150, 712, 72, 695, 150, 695],
    color: "#FF4F5F",
    note: "",
    categoryName: "Concern",
    updatedAt: "2026-09-01T14:06:00Z",
  },
];

describe("embedHighlights", () => {
  it("writes highlight annotations that read back with id, color, note and category", async () => {
    const { bytes, written } = await embedHighlights(await twoPagePdf(), highlights);
    expect(written.map((entry) => entry.id)).toEqual(highlights.map((entry) => entry.id));
    expect(written[0]?.pdfjsId).toMatch(/^\d+R$/);

    const embedded = await readEmbeddedHighlights(bytes);
    expect(embedded).toHaveLength(2);
    expect(embedded[0]).toMatchObject({
      id: highlights[0]?.id,
      page: 1,
      color: "#53FFBC",
      note: "Margin fell — core tension.",
      categoryName: "Financial",
      pdfjsId: written[0]?.pdfjsId,
    });
    expect(embedded[0]?.quadPoints).toEqual([72, 712, 200, 712, 72, 695, 200, 695]);
    expect(embedded[1]).toMatchObject({ page: 2, color: "#FF4F5F", categoryName: "Concern" });
  });

  it("is idempotent: re-embedding replaces our annotations instead of duplicating them", async () => {
    const first = await embedHighlights(await twoPagePdf(), highlights);
    const second = await embedHighlights(first.bytes, [highlights[0] as EmbeddableHighlight]);
    const embedded = await readEmbeddedHighlights(second.bytes);
    expect(embedded.map((entry) => entry.id)).toEqual([highlights[0]?.id]);

    const doc = await PDFDocument.load(second.bytes);
    const annotsOnPageTwo = doc.getPage(1).node.Annots()?.size() ?? 0;
    expect(annotsOnPageTwo).toBe(0);
  });

  it("leaves annotations made by other tools alone", async () => {
    const doc = await PDFDocument.load(await twoPagePdf());
    const foreign = doc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [10, 10, 20, 20],
      QuadPoints: [10, 20, 20, 20, 10, 10, 20, 10],
      C: [1, 1, 0],
    });
    doc.getPage(0).node.addAnnot(doc.context.register(foreign));
    const withForeign = await doc.save();

    const { bytes } = await embedHighlights(withForeign, highlights);
    const after = await PDFDocument.load(bytes);
    const pageOneAnnots = after.getPage(0).node.Annots()?.size() ?? 0;
    // foreign highlight + our highlight + our popup
    expect(pageOneAnnots).toBe(3);
    expect(await readEmbeddedHighlights(bytes)).toHaveLength(2);
  });

  it("skips highlights whose page is out of range", async () => {
    const { written } = await embedHighlights(await twoPagePdf(), [
      { ...(highlights[0] as EmbeddableHighlight), page: 9 },
    ]);
    expect(written).toEqual([]);
  });
});

describe("protected PDFs", () => {
  const fixture = resolve(__dirname, "../fixtures/static/encrypted-case.pdf");

  it.skipIf(!existsSync(fixture))("refuses to write into an encrypted PDF", async () => {
    const bytes = new Uint8Array(readFileSync(fixture));
    expect(await isProtectedPdf(bytes)).toBe(true);
    await expect(embedHighlights(bytes, highlights)).rejects.toBeInstanceOf(ProtectedPdfError);
  });

  it("reports an ordinary PDF as unprotected", async () => {
    expect(await isProtectedPdf(await twoPagePdf())).toBe(false);
  });
});
