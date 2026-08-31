// The `pdfCaseReview.categories` default lives in two hand-maintained places: the package.json
// configuration contribution and DEFAULT_CATEGORIES. This test fails when they drift apart.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "../../src/core/categories";

interface Manifest {
  contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
}

describe("package.json configuration defaults", () => {
  it("pdfCaseReview.categories deep-equals DEFAULT_CATEGORIES", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf8"),
    ) as Manifest;
    const contributed = manifest.contributes.configuration.properties["pdfCaseReview.categories"];
    expect(contributed?.default).toEqual(DEFAULT_CATEGORIES);
  });
});
