import { describe, expect, it } from "vitest";
import { serializeSidecar, sortHighlights, stableStringify } from "../../src/core/sidecar/serialize";
import { countNotes, type SidecarHighlight } from "../../src/core/sidecar/types";
import { parseSidecar } from "../../src/core/sidecar/validate";
import { sampleSidecar } from "./helpers/sampleSidecar";

function highlight(id: string, page: number, top: number, left: number): SidecarHighlight {
  return {
    id,
    categoryId: "fact",
    page,
    rect: [left, top - 12, left + 100, top],
    quadPoints: [],
    kind: "free",
    text: "",
    note: "",
    createdAt: "2026-09-01T14:00:00.000Z",
    updatedAt: "2026-09-01T14:00:00.000Z",
  };
}

describe("stableStringify", () => {
  it("sorts keys at every level, drops undefined values, uses LF and ends with a newline", () => {
    const text = stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } });
    expect(text).toBe(
      '{\n  "a": {\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
    expect(text).not.toContain("\r");
  });
});

describe("sortHighlights", () => {
  it("orders by page, then top edge descending, then left edge, then id", () => {
    const sorted = sortHighlights([
      highlight("d", 2, 700, 72),
      highlight("c", 1, 500, 72),
      highlight("b", 1, 700, 300),
      highlight("a", 1, 700, 72),
      highlight("f", 1, 700, 72),
      highlight("e", 1, 700, 72),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "e", "f", "b", "c", "d"]);
  });
});

describe("serializeSidecar", () => {
  it("writes sorted keys with highlights in reading order and categories by order", () => {
    const text = serializeSidecar(sampleSidecar());
    const lines = text.split("\n");
    expect(lines.slice(0, 9)).toEqual([
      "{",
      '  "$schema": "https://raw.githubusercontent.com/realslimslaney/pdf-case-review/main/schemas/review.schema.json",',
      '  "categories": [',
      "    {",
      '      "color": "#FFFF98",',
      '      "id": "fact",',
      '      "name": "Fact",',
      '      "order": 0',
      "    },",
    ]);
    const parsed = parseSidecar(text);
    expect(parsed.highlights.map((entry) => entry.page)).toEqual([1, 2]);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("round-trips through parseSidecar unchanged", () => {
    const text = serializeSidecar(sampleSidecar());
    expect(serializeSidecar(parseSidecar(text))).toBe(text);
  });

  it("does not depend on the input order of highlights, categories or notes", () => {
    const sidecar = sampleSidecar();
    sidecar.documentNotes?.push({
      id: "later",
      title: "Later",
      note: "",
      createdAt: "2026-09-02T09:00:00.000Z",
      updatedAt: "2026-09-02T09:00:00.000Z",
    });
    sidecar.pageNotes?.push({
      page: 1,
      note: "First page.",
      createdAt: "2026-09-02T09:00:00.000Z",
      updatedAt: "2026-09-02T09:00:00.000Z",
    });
    const shuffled = {
      ...sidecar,
      categories: [...sidecar.categories].reverse(),
      highlights: [...sidecar.highlights].reverse(),
      pageNotes: [...(sidecar.pageNotes ?? [])].reverse(),
      documentNotes: [...(sidecar.documentNotes ?? [])].reverse(),
    };
    expect(serializeSidecar(shuffled)).toBe(serializeSidecar(sidecar));
  });
});

describe("countNotes", () => {
  it("counts non-empty highlight and page notes plus every document note", () => {
    const sidecar = sampleSidecar();
    expect(countNotes(sidecar)).toBe(3);
    sidecar.pageNotes?.push({
      page: 1,
      note: "   ",
      createdAt: "2026-09-02T09:00:00.000Z",
      updatedAt: "2026-09-02T09:00:00.000Z",
    });
    expect(countNotes(sidecar)).toBe(3);
    const { pageNotes: _pageNotes, documentNotes: _documentNotes, ...bare } = sidecar;
    expect(countNotes(bare)).toBe(1);
  });
});
