import { describe, expect, it } from "vitest";
import { isSidecarFileName, sidecarFileName, sidecarFolderPath } from "../../src/core/sidecar/location";

describe("sidecar location", () => {
  it("names the beside-the-PDF sidecar", () => {
    expect(sidecarFileName("case.pdf")).toBe("case.pdf.review.json");
    expect(sidecarFileName("Acme Widgets (A) ü.pdf")).toBe("Acme Widgets (A) ü.pdf.review.json");
  });

  it("collects folder sidecars under .pdf-case-review with forward slashes", () => {
    expect(sidecarFolderPath("cases/week 1/Acme ä.pdf")).toBe(
      ".pdf-case-review/cases/week 1/Acme ä.pdf.review.json",
    );
    expect(sidecarFolderPath("cases\\week 1\\case.pdf")).toBe(
      ".pdf-case-review/cases/week 1/case.pdf.review.json",
    );
    expect(sidecarFolderPath("/case.pdf")).toBe(".pdf-case-review/case.pdf.review.json");
  });

  it("recognizes sidecar file names", () => {
    expect(isSidecarFileName("case.pdf.review.json")).toBe(true);
    expect(isSidecarFileName("case.pdf")).toBe(false);
    expect(isSidecarFileName("review.json")).toBe(false);
  });
});
