import { describe, expect, it } from "vitest";
import {
  CATEGORY_PRESETS,
  categoryAt,
  DEFAULT_CATEGORIES,
  isCategoryList,
  validateCategories,
  validatePresets,
} from "../../src/core/categories";

describe("CATEGORY_PRESETS", () => {
  it("ships valid palettes with unique colors", () => {
    for (const [name, categories] of Object.entries(CATEGORY_PRESETS)) {
      expect(validateCategories(categories), name).toEqual([]);
    }
    expect(CATEGORY_PRESETS["Business case"]).toBe(DEFAULT_CATEGORIES);
  });
});

describe("validatePresets", () => {
  it("keeps valid presets (normalized) and reports the broken ones by name", () => {
    const result = validatePresets({
      Mine: [{ id: "a", name: "A", color: "#abcdef" }],
      Broken: [{ id: "Bad Id", name: "B", color: "#000000" }],
      Empty: [],
      Shape: [{ id: "x" }],
    });
    expect(Object.keys(result.presets)).toEqual(["Mine"]);
    expect(result.presets["Mine"]?.[0]?.color).toBe("#ABCDEF");
    expect(result.errors.map((error) => error.preset)).toEqual(["Broken", "Empty", "Shape"]);
    expect(result.errors[0]?.message).toMatch(/id "Bad Id"/);
  });

  it("rejects non-object input", () => {
    expect(validatePresets([]).errors).toHaveLength(1);
    expect(validatePresets(null).presets).toEqual({});
  });
});

describe("isCategoryList", () => {
  it("accepts well-shaped lists and rejects everything else", () => {
    expect(isCategoryList(DEFAULT_CATEGORIES)).toBe(true);
    expect(isCategoryList([])).toBe(false);
    expect(isCategoryList("fact")).toBe(false);
    expect(isCategoryList([{ id: "fact" }])).toBe(false);
  });
});

describe("categoryAt", () => {
  it("maps 1-based keybinding indexes onto the palette", () => {
    expect(categoryAt(DEFAULT_CATEGORIES, 1)?.id).toBe("fact");
    expect(categoryAt(DEFAULT_CATEGORIES, 5)?.id).toBe("question");
    expect(categoryAt(DEFAULT_CATEGORIES, 6)).toBeUndefined();
    expect(categoryAt(DEFAULT_CATEGORIES, 0)).toBeUndefined();
    expect(categoryAt(DEFAULT_CATEGORIES, 1.5)).toBeUndefined();
  });
});
