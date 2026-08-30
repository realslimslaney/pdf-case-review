// A small, valid sidecar used by the sidecar unit tests and mirrored in docs/reference/sidecar.md.

import { DEFAULT_CATEGORIES } from "../../../src/core/categories";
import { SIDECAR_SCHEMA_URL, type Sidecar, toSidecarCategories } from "../../../src/core/sidecar/types";

export const SAMPLE_SHA256 = "0123456789abcdef".repeat(4);

export function sampleSidecar(): Sidecar {
  return {
    $schema: SIDECAR_SCHEMA_URL,
    version: 1,
    generator: "pdf-case-review/0.1.0",
    source: {
      fileName: "acme-widgets-a.pdf",
      sha256: SAMPLE_SHA256,
      byteLength: 123456,
      pageCount: 3,
      title: "Acme Widgets (A): The Pricing Decision",
      lastEmbeddedAt: "2026-09-01T14:05:10.000Z",
      pdfWrite: "synced",
    },
    categories: toSidecarCategories(DEFAULT_CATEGORIES),
    highlights: [
      {
        id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
        categoryId: "financial",
        page: 2,
        pageLabel: "2",
        pdfjsId: "12R",
        rect: [72, 500.2, 300.1, 512.4],
        quadPoints: [72, 512.4, 300.1, 512.4, 72, 500.2, 300.1, 500.2],
        kind: "text",
        text: "Gross margin fell from 41% to 33% in FY22.",
        note: "Core tension: pricing pressure against the cost base.",
        createdAt: "2026-09-01T14:00:00.000Z",
        updatedAt: "2026-09-01T14:05:10.000Z",
      },
      {
        id: "0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f",
        categoryId: "question",
        page: 1,
        pageLabel: "i",
        rect: [72, 640, 400, 652],
        quadPoints: [72, 652, 400, 652, 72, 640, 400, 640],
        kind: "text",
        text: "Why did the board approve the plan?",
        note: "",
        createdAt: "2026-09-01T14:01:00.000Z",
        updatedAt: "2026-09-01T14:01:00.000Z",
      },
    ],
    pageNotes: [
      {
        page: 3,
        note: "Exhibit 2 contradicts the narrative on page 1.",
        createdAt: "2026-09-01T14:02:00.000Z",
        updatedAt: "2026-09-01T14:02:00.000Z",
      },
    ],
    documentNotes: [
      {
        id: "thesis",
        title: "Thesis",
        note: "Hold price to protect share; fix the cost base next year.",
        createdAt: "2026-09-01T14:03:00.000Z",
        updatedAt: "2026-09-01T14:03:00.000Z",
      },
    ],
  };
}
