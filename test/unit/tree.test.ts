import { describe, expect, it } from "vitest";
import type { SidecarHighlight } from "../../src/core/sidecar/types";
import {
  buildTree,
  DOCUMENT_NOTES_LABEL,
  highlightLabel,
  IMAGE_REGION_LABEL,
  NO_TEXT_LABEL,
  PAGE_NOTE_DESCRIPTION,
} from "../../src/core/tree";
import { sampleSidecar } from "./helpers/sampleSidecar";

function extra(overrides: Partial<SidecarHighlight> & Pick<SidecarHighlight, "id">): SidecarHighlight {
  return {
    categoryId: "fact",
    page: 3,
    rect: [72, 100, 300, 112],
    quadPoints: [72, 112, 300, 112, 72, 100, 300, 100],
    kind: "text",
    text: "x",
    note: "",
    createdAt: "2026-09-01T14:00:00.000Z",
    updatedAt: "2026-09-01T14:00:00.000Z",
    ...overrides,
  };
}

describe("buildTree by category", () => {
  it("lists document notes first, then non-empty categories with counts, quotes and citations", () => {
    const groups = buildTree(sampleSidecar(), "category");
    expect(groups.map((group) => [group.label, group.description])).toEqual([
      [DOCUMENT_NOTES_LABEL, "1 note"],
      ["Financial", "1 highlight"],
      ["Question", "1 highlight"],
    ]);
    const financial = groups[1];
    expect(financial?.color).toBe("#53FFBC");
    expect(financial?.children[0]).toMatchObject({
      id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      label: "Gross margin fell from 41% to 33% in FY22.",
      description: "p. 2",
      page: 2,
      color: "#53FFBC",
    });
    expect(financial?.children[0]?.tooltip).toContain("Core tension");
    expect(groups[2]?.children[0]?.description).toBe("p. i [1]");
  });

  it("buckets unknown categories as Uncategorized and truncates long quotes", () => {
    const model = sampleSidecar();
    model.highlights.push(
      extra({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        categoryId: "ghost",
        text: "A very long sentence that keeps going well past the sixty character limit of a tree row.",
      }),
    );
    const groups = buildTree(model, "category");
    const last = groups[groups.length - 1];
    expect(last?.label).toBe("Uncategorized");
    expect(last?.children[0]?.label.length).toBeLessThanOrEqual(61);
    expect(last?.children[0]?.label.endsWith("…")).toBe(true);
  });

  it("shows document note titles with the note as description, sorted by creation time", () => {
    const model = sampleSidecar();
    model.documentNotes = [
      {
        id: "later",
        title: "Later",
        note: "",
        createdAt: "2026-09-02T09:00:00.000Z",
        updatedAt: "2026-09-02T09:00:00.000Z",
      },
      ...(model.documentNotes ?? []),
    ];
    const groups = buildTree(model, "category");
    const notes = groups[0];
    expect(notes?.kind).toBe("documentNotes");
    expect(notes?.children.map((child) => [child.kind, child.label])).toEqual([
      ["documentNote", "Thesis"],
      ["documentNote", "Later"],
    ]);
    expect(notes?.children[0]?.description).toContain("Hold price");
  });
});

describe("buildTree by page", () => {
  it("groups in page order with page labels, per-page counts and page-note rows first", () => {
    const model = sampleSidecar();
    model.highlights.push(extra({ id: "aaaaaaaa-0000-4000-8000-000000000002", page: 1, pageLabel: "i" }));
    const groups = buildTree(model, "page");
    expect(groups.map((group) => [group.label, group.description])).toEqual([
      [DOCUMENT_NOTES_LABEL, "1 note"],
      ["Page i [1]", "2 highlights"],
      ["Page 2", "1 highlight"],
      ["Page 3", "1 note"],
    ]);
    expect(groups[1]?.children.map((child) => (child.kind === "highlight" ? child.color : null))).toEqual([
      "#FFCBE6",
      "#FFFF98",
    ]);
    const pageThree = groups[3];
    expect(pageThree?.children[0]).toMatchObject({
      kind: "pageNote",
      page: 3,
      description: PAGE_NOTE_DESCRIPTION,
    });
    expect(pageThree?.children[0]?.label).toContain("Exhibit 2");
  });

  it("puts a page note above the highlights of the same page", () => {
    const model = sampleSidecar();
    model.pageNotes = [
      {
        page: 2,
        note: "Margin bridge lives here.",
        createdAt: "2026-09-01T14:02:00.000Z",
        updatedAt: "2026-09-01T14:02:00.000Z",
      },
    ];
    const groups = buildTree(model, "page");
    const pageTwo = groups.find((group) => group.kind === "page" && group.id === "2");
    expect(pageTwo?.children.map((child) => child.kind)).toEqual(["pageNote", "highlight"]);
    expect(pageTwo?.description).toBe("1 highlight");
  });
});

describe("highlightLabel", () => {
  it("names free and empty highlights", () => {
    expect(highlightLabel(extra({ id: "a", kind: "free", quadPoints: [], text: "" }))).toBe(
      IMAGE_REGION_LABEL,
    );
    expect(highlightLabel(extra({ id: "b", text: "  " }))).toBe(NO_TEXT_LABEL);
  });
});
