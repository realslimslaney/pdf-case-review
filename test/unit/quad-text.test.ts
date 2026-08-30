import { describe, expect, it } from "vitest";
import { type TextItemGeometry, textInQuads } from "../../src/core/text/quadText";

function item(str: string, x: number, y: number, width: number, hasEOL = false): TextItemGeometry {
  return { str, x, y, width, height: 12, hasEOL };
}

/** A quad covering `left..right` on the line whose baseline is `y`. */
function quad(left: number, right: number, y: number): number[] {
  return [left, y + 13, right, y + 13, left, y - 1, right, y - 1];
}

const LINE_ONE = [item("Gross", 72, 700, 30), item("margin", 108, 700, 40, true)];
const LINE_TWO = [item("fell", 72, 686, 24), item("sharply.", 100, 686, 50, true)];

describe("textInQuads", () => {
  it("joins covered items on one line with a space at word gaps", () => {
    expect(textInQuads(LINE_ONE, quad(70, 150, 700))).toBe("Gross margin");
  });

  it("breaks lines at hasEOL so hyphenation can be undone later", () => {
    const text = textInQuads([...LINE_ONE, ...LINE_TWO], [...quad(70, 150, 700), ...quad(70, 160, 686)]);
    expect(text).toBe("Gross margin\nfell sharply.");
  });

  it("takes a proportional slice of a partly covered item", () => {
    expect(textInQuads([item("abcdefghij", 100, 700, 100)], quad(100, 150, 700))).toBe("abcde");
  });

  it("ignores items on other lines and in other columns", () => {
    const rightColumn = [item("Exhibit", 320, 700, 40), item("2", 365, 700, 8)];
    const text = textInQuads([...LINE_ONE, ...rightColumn], quad(318, 380, 700));
    expect(text).toBe("Exhibit 2");
    expect(textInQuads(LINE_ONE, quad(70, 150, 400))).toBe("");
  });

  it("concatenates adjacent fragments of one word without a space", () => {
    const fragments = [item("Ac", 72, 700, 12), item("me", 84, 700, 14)];
    expect(textInQuads(fragments, quad(70, 100, 700))).toBe("Acme");
  });

  it("returns nothing for empty quads", () => {
    expect(textInQuads(LINE_ONE, [])).toBe("");
  });
});
