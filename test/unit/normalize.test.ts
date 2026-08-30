import { describe, expect, it } from "vitest";
import {
  joinHyphenatedBreaks,
  normalizeCapturedText,
  normalizeWhitespace,
} from "../../src/core/text/normalize";

describe("text normalization", () => {
  it("re-joins words hyphenated across a line break", () => {
    expect(joinHyphenatedBreaks("gross mar-\n  gin fell")).toBe("gross margin fell");
  });

  it("keeps hyphens that are not at a line break", () => {
    expect(joinHyphenatedBreaks("a well-known case")).toBe("a well-known case");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeWhitespace("  a \n\t b  ")).toBe("a b");
  });

  it("applies both steps for captured text", () => {
    expect(normalizeCapturedText(" Gross  mar-\ngin\nfell ")).toBe("Gross margin fell");
  });
});
