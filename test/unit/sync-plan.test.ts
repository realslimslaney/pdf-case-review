import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import type { EmbeddedHighlight } from "../../src/core/pdfExport/embedHighlights";
import {
  adoptEmbedded,
  applyEmbedOutcome,
  markPdfWriteFailed,
  repairPdfjsIds,
  staleIdPairs,
  toEmbeddable,
} from "../../src/core/pdfExport/syncPlan";
import type { Sidecar, SidecarHighlight, SidecarSource } from "../../src/core/sidecar/types";
import { sampleSidecar } from "./helpers/sampleSidecar";

const NOW = "2026-09-02T09:00:00.000Z";

function source(model: Sidecar): SidecarSource {
  return { fileName: model.source.fileName, sha256: "f".repeat(64), byteLength: 999, pageCount: 3 };
}

describe("toEmbeddable", () => {
  it("maps categories to color and name and skips free highlights", () => {
    const model = sampleSidecar();
    const free: SidecarHighlight = {
      ...(model.highlights[0] as SidecarHighlight),
      id: "aaaaaaaa-0000-4000-8000-000000000009",
      quadPoints: [],
      kind: "free",
    };
    const unknown: SidecarHighlight = {
      ...(model.highlights[0] as SidecarHighlight),
      id: "aaaaaaaa-0000-4000-8000-000000000008",
      categoryId: "ghost",
    };
    const embeddable = toEmbeddable({ ...model, highlights: [...model.highlights, free, unknown] });
    expect(embeddable.map((entry) => entry.id)).toEqual([
      "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      "0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f",
      unknown.id,
    ]);
    expect(embeddable[0]).toMatchObject({ color: "#53FFBC", categoryName: "Financial", page: 2 });
    expect(embeddable[2]).toMatchObject({ color: "#CCCCCC", categoryName: "Uncategorized" });
  });
});

describe("applyEmbedOutcome", () => {
  it("records a synced write: new hash, timestamp, refreshed pdfjsIds, dropped ids for unwritten ones", () => {
    const model = sampleSidecar();
    const next = applyEmbedOutcome(
      model,
      source(model),
      {
        status: "synced",
        bytes: new Uint8Array([1]),
        written: [{ id: "0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f", pdfjsId: "40R" }],
      },
      { sha256: "a".repeat(64), byteLength: 1, at: NOW },
      "pdf-case-review/9.9.9",
    );
    expect(next.generator).toBe("pdf-case-review/9.9.9");
    expect(next.source).toEqual({
      fileName: "acme-widgets-a.pdf",
      sha256: "a".repeat(64),
      byteLength: 1,
      pageCount: 3,
      lastEmbeddedAt: NOW,
      pdfWrite: "synced",
    });
    expect(next.highlights.find((entry) => entry.id.startsWith("0d3a"))?.pdfjsId).toBe("40R");
    expect(next.highlights.find((entry) => entry.id.startsWith("8f6c"))?.pdfjsId).toBeUndefined();
  });

  it("keeps the previous embed facts and marks the file protected when the PDF is left alone", () => {
    const model = sampleSidecar();
    const next = applyEmbedOutcome(
      model,
      source(model),
      { status: "skipped-protected", bytes: null, written: [] },
      null,
      "pdf-case-review/9.9.9",
    );
    expect(next.source.pdfWrite).toBe("skipped-protected");
    expect(next.source.encrypted).toBe(true);
    expect(next.source.lastEmbeddedAt).toBe(model.source.lastEmbeddedAt);
    expect(next.source.sha256).toBe("f".repeat(64));
    expect(next.highlights).toBe(model.highlights);
  });

  it("clears a stale encrypted flag once a sync succeeds", () => {
    const model = sampleSidecar();
    model.source.encrypted = true;
    const next = applyEmbedOutcome(
      model,
      source(model),
      { status: "synced", bytes: new Uint8Array([1]), written: [] },
      { sha256: "a".repeat(64), byteLength: 1, at: NOW },
      "g",
    );
    expect(next.source.encrypted).toBeUndefined();
  });
});

describe("markPdfWriteFailed", () => {
  it("restores the previous hash, timestamp and pdfjsIds and records the failure", () => {
    const previous = sampleSidecar();
    const saved = applyEmbedOutcome(
      previous,
      source(previous),
      {
        status: "synced",
        bytes: new Uint8Array([1]),
        written: [{ id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d", pdfjsId: "50R" }],
      },
      { sha256: "a".repeat(64), byteLength: 1, at: NOW },
      "g",
    );
    const rolledBack = markPdfWriteFailed(saved, previous, { sha256: "f".repeat(64), byteLength: 999 });
    expect(rolledBack.source).toMatchObject({
      sha256: "f".repeat(64),
      byteLength: 999,
      lastEmbeddedAt: previous.source.lastEmbeddedAt,
      pdfWrite: "failed",
    });
    expect(rolledBack.highlights.find((entry) => entry.id.startsWith("8f6c"))?.pdfjsId).toBe("12R");
    expect(rolledBack.highlights.find((entry) => entry.id.startsWith("0d3a"))?.pdfjsId).toBeUndefined();
  });
});

describe("staleIdPairs", () => {
  it("lists annotation ids that changed or disappeared", () => {
    const before = sampleSidecar().highlights;
    const after = before.map((entry) => (entry.pdfjsId === "12R" ? { ...entry, pdfjsId: "60R" } : entry));
    expect(staleIdPairs(before, after)).toEqual([
      { oldPdfjsId: "12R", id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d" },
    ]);
    expect(staleIdPairs(before, before)).toEqual([]);
  });
});

const EMBEDDED: EmbeddedHighlight[] = [
  {
    id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
    page: 2,
    rect: [72, 500.2, 300.1, 512.4],
    quadPoints: [72, 512.4, 300.1, 512.4, 72, 500.2, 300.1, 500.2],
    color: "#53FFBC",
    note: "Core tension: pricing pressure against the cost base.",
    categoryName: "Financial",
    pdfjsId: "77R",
  },
  {
    id: "not-a-uuid",
    page: 1,
    rect: [72, 640, 400, 652],
    quadPoints: [72, 652, 400, 652, 72, 640, 400, 640],
    color: "#123456",
    note: "",
    categoryName: "Question",
    pdfjsId: "78R",
  },
];

describe("repairPdfjsIds", () => {
  it("refreshes ids present in the file and drops ids the file no longer has", () => {
    const model = sampleSidecar();
    const withStale = {
      ...model,
      highlights: model.highlights.map((entry) =>
        entry.pdfjsId === undefined ? { ...entry, pdfjsId: "99R" } : entry,
      ),
    };
    const repaired = repairPdfjsIds(withStale, EMBEDDED);
    expect(repaired.changed).toBe(true);
    expect(repaired.model.highlights.find((entry) => entry.id.startsWith("8f6c"))?.pdfjsId).toBe("77R");
    expect(repaired.model.highlights.find((entry) => entry.id.startsWith("0d3a"))?.pdfjsId).toBeUndefined();
    expect(repairPdfjsIds(repaired.model, EMBEDDED).changed).toBe(false);
  });
});

describe("adoptEmbedded", () => {
  it("rebuilds highlights from the PDF, keeping our uuids and resolving categories by color then name", () => {
    let counter = 0;
    const adopted = adoptEmbedded(
      EMBEDDED,
      DEFAULT_CATEGORIES,
      NOW,
      () => `aaaaaaaa-0000-4000-8000-00000000000${++counter}`,
    );
    expect(adopted).toHaveLength(2);
    expect(adopted[0]).toMatchObject({
      id: "8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d",
      categoryId: "financial",
      page: 2,
      pdfjsId: "77R",
      kind: "text",
      text: "",
      note: "Core tension: pricing pressure against the cost base.",
      createdAt: NOW,
    });
    expect(adopted[1]).toMatchObject({ id: "aaaaaaaa-0000-4000-8000-000000000001", categoryId: "question" });
  });
});
