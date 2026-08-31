// Round trips across the highlight conversions (core/highlight/convert): fields must survive
// every leg, including a real embed and read-back through pdf-lib.

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import { adoptEmbedded, createHighlight, toEmbeddable, toInjectable } from "../../src/core/highlight/convert";
import { embedHighlights, readEmbeddedHighlights } from "../../src/core/pdfExport/embedHighlights";
import type { SidecarHighlight } from "../../src/core/sidecar/types";
import type { SerializedHighlight } from "../../src/shared/protocol";
import { sampleSidecar } from "./helpers/sampleSidecar";

const NOW = "2026-09-01T15:00:00.000Z";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Page ${index + 1}`, { x: 72, y: 720, size: 12, font });
  }
  return pdf.save({ useObjectStreams: false });
}

function serializedEditor(overrides: Partial<SerializedHighlight> = {}): SerializedHighlight {
  return {
    id: "pdfjs_internal_editor_0",
    pageIndex: 1,
    color: "#53FFBC",
    quadPoints: [72, 512, 300, 512, 72, 500, 300, 500],
    rect: [72, 500, 300, 512],
    rotation: 0,
    text: "captured text",
    annotationElementId: null,
    raw: {},
    ...overrides,
  };
}

describe("createHighlight", () => {
  const context = { categories: DEFAULT_CATEGORIES, now: () => NOW, pageLabels: ["i", "2"] };

  it("maps a text editor onto the sidecar shape with category from the color", () => {
    const highlight = createHighlight("uuid-1", serializedEditor(), context);
    expect(highlight).toMatchObject({
      id: "uuid-1",
      categoryId: "financial",
      page: 2,
      pageLabel: "2",
      kind: "text",
      text: "captured text",
    });
    expect(highlight.rotation).toBeUndefined();
    expect(highlight.pdfjsId).toBeUndefined();
  });

  it("keeps the outlines and rotation of a free editor", () => {
    const outlines = [[1, 2, 3, 4]];
    const highlight = createHighlight(
      "uuid-2",
      serializedEditor({ quadPoints: [], rotation: 90, raw: { outlines } }),
      context,
    );
    expect(highlight.kind).toBe("free");
    expect(highlight.outlines).toEqual(outlines);
    expect(highlight.rotation).toBe(90);
  });
});

describe("toEmbeddable -> embed -> read back -> adoptEmbedded round trip", () => {
  it("keeps id, geometry, note and category across a real pdf-lib embed", async () => {
    const model = sampleSidecar();
    const embeddable = toEmbeddable(model);
    expect(embeddable).toHaveLength(2);

    const result = await embedHighlights(await blankPdf(3), embeddable);
    const readBack = await readEmbeddedHighlights(result.bytes);
    expect(readBack).toHaveLength(2);

    const adopted = adoptEmbedded(readBack, model.categories, NOW, () => "fresh-id");
    for (const original of model.highlights) {
      const roundTripped = adopted.find((entry) => entry.id === original.id);
      expect(roundTripped, original.id).toBeDefined();
      expect(roundTripped).toMatchObject({
        categoryId: original.categoryId,
        page: original.page,
        note: original.note,
        kind: "text",
      });
      expect(roundTripped?.quadPoints).toEqual(original.quadPoints);
      expect(roundTripped?.pdfjsId).toBeDefined();
    }
  });
});

describe("toInjectable", () => {
  const base: SidecarHighlight = {
    id: "uuid-3",
    categoryId: "concern",
    page: 3,
    rect: [10, 20, 30, 40],
    quadPoints: [],
    kind: "free",
    text: "",
    note: "",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("carries outlines, opacity and rotation for a free highlight", () => {
    const injectable = toInjectable({ ...base, outlines: [[1, 2]], rotation: 180 }, DEFAULT_CATEGORIES);
    expect(injectable?.pageIndex).toBe(2);
    expect(injectable?.data).toMatchObject({
      annotationType: 9,
      opacity: 1,
      rotation: 180,
      outlines: [[1, 2]],
      rect: [10, 20, 30, 40],
    });
    expect(injectable?.data["quadPoints"]).toBeUndefined();
  });

  it("prefers quads when present and returns undefined with no geometry at all", () => {
    const quads = [1, 2, 3, 4, 5, 6, 7, 8];
    const withQuads = toInjectable({ ...base, kind: "text", quadPoints: quads }, DEFAULT_CATEGORIES);
    expect(withQuads?.data["quadPoints"]).toEqual(quads);
    expect(toInjectable(base, DEFAULT_CATEGORIES)).toBeUndefined();
  });
});
