import { describe, expect, it } from "vitest";
import {
  categoryForColor,
  DEFAULT_CATEGORIES,
  rgbToHex,
  toHighlightEditorColors,
  validateCategories,
} from "../../src/core/categories";

describe("validateCategories", () => {
  it("accepts the defaults", () => {
    expect(validateCategories(DEFAULT_CATEGORIES)).toEqual([]);
  });

  it("rejects duplicate colors regardless of case", () => {
    const errors = validateCategories([
      { id: "a", name: "A", color: "#ffff98" },
      { id: "b", name: "B", color: "#FFFF98" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/duplicate color/);
  });

  it("rejects bad ids, bad colors and empty names", () => {
    const errors = validateCategories([{ id: "Not Valid", name: " ", color: "red" }]);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringMatching(/id "Not Valid"/),
      expect.stringMatching(/color "red"/),
      expect.stringMatching(/name must not be empty/),
    ]);
  });
});

describe("toHighlightEditorColors", () => {
  it("renders PDF.js name=hex pairs in category order", () => {
    expect(toHighlightEditorColors(DEFAULT_CATEGORIES)).toBe(
      "fact=#FFFF98,financial=#53FFBC,strategic=#80EBFF,concern=#FF4F5F,question=#FFCBE6",
    );
  });
});

describe("color mapping", () => {
  it("converts PDF.js rgb triples to uppercase hex", () => {
    expect(rgbToHex([255, 255, 152])).toBe("#FFFF98");
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
  });

  it("finds the category by color case-insensitively", () => {
    expect(categoryForColor(DEFAULT_CATEGORIES, "#53ffbc")?.id).toBe("financial");
    expect(categoryForColor(DEFAULT_CATEGORIES, "#123456")).toBeUndefined();
  });
});
