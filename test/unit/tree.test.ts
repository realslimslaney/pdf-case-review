import { describe, expect, it } from "vitest";
import type { SidecarHighlight } from "../../src/core/sidecar/types";
import { buildTree, highlightLabel, IMAGE_REGION_LABEL, NO_TEXT_LABEL } from "../../src/core/tree";
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
  it("lists non-empty categories in order with counts, quotes and citations", () => {
    const groups = buildTree(sampleSidecar(), "category");
    expect(groups.map((group) => [group.label, group.description])).toEqual([
      ["Financial", "1 highlight"],
      ["Question", "1 highlight"],
    ]);
    const [financial] = groups;
    expect(financial?.color).toBe("#53FFBC");
    expect(financial?.children[0]).toMatchObject({
      id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      label: "Gross margin fell from 41% to 33% in FY22.",
      description: "p. 2",
      page: 2,
      color: "#53FFBC",
    });
    expect(financial?.children[0]?.tooltip).toContain("Core tension");
    expect(groups[1]?.children[0]?.description).toBe("p. i [1]");
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
});

describe("buildTree by page", () => {
  it("groups in page order with page labels and per-page counts", () => {
    const model = sampleSidecar();
    model.highlights.push(extra({ id: "aaaaaaaa-0000-4000-8000-000000000002", page: 1, pageLabel: "i" }));
    const groups = buildTree(model, "page");
    expect(groups.map((group) => [group.label, group.description])).toEqual([
      ["Page i [1]", "2 highlights"],
      ["Page 2", "1 highlight"],
    ]);
    expect(groups[0]?.children.map((child) => child.color)).toEqual(["#FFCBE6", "#FFFF98"]);
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
