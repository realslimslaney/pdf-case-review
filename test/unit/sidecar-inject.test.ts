import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import { missingFromFile, toInjectable } from "../../src/core/sidecar/inject";
import type { SidecarHighlight } from "../../src/core/sidecar/types";
import { sampleSidecar } from "./helpers/sampleSidecar";

describe("missingFromFile", () => {
  it("keeps highlights without a pdfjsId or whose annotation is not in the file", () => {
    const highlights = sampleSidecar().highlights;
    expect(missingFromFile(highlights, new Set(["12R"])).map((entry) => entry.pdfjsId)).toEqual([undefined]);
    expect(missingFromFile(highlights, new Set()).length).toBe(2);
  });
});

describe("toInjectable", () => {
  it("builds PDF.js highlight data with the category color as 0-255 components", () => {
    const [financial] = sampleSidecar().highlights;
    const injectable = toInjectable(financial as SidecarHighlight, DEFAULT_CATEGORIES);
    expect(injectable).toEqual({
      sidecarId: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      pageIndex: 1,
      data: {
        annotationType: 9,
        color: [0x53, 0xff, 0xbc],
        opacity: 1,
        rect: [72, 500.2, 300.1, 512.4],
        rotation: 0,
        quadPoints: [72, 512.4, 300.1, 512.4, 72, 500.2, 300.1, 500.2],
      },
    });
  });

  it("uses the outlines for a free highlight and grey for an unknown category", () => {
    const [base] = sampleSidecar().highlights;
    const free: SidecarHighlight = {
      ...(base as SidecarHighlight),
      categoryId: "ghost",
      quadPoints: [],
      kind: "free",
      outlines: { points: [[1, 2, 3, 4]] },
    };
    const injectable = toInjectable(free, DEFAULT_CATEGORIES);
    expect(injectable?.data["outlines"]).toEqual({ points: [[1, 2, 3, 4]] });
    expect(injectable?.data["color"]).toEqual([0xcc, 0xcc, 0xcc]);
    expect(toInjectable({ ...free, outlines: undefined }, DEFAULT_CATEGORIES)).toBeUndefined();
  });
});
