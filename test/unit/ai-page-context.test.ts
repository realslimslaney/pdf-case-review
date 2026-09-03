import { describe, expect, it } from "vitest";

import { createAttestation } from "../../src/core/ai/consent";
import {
  buildPageContextPrompt,
  PAGE_CONTEXT_PROMPT_VERSION,
  pageContextInputDigest,
  pagesNeedingContext,
} from "../../src/core/ai/pageContext";
import type { Sidecar, SidecarHighlight } from "../../src/core/sidecar/types";
import { sampleSidecar } from "./helpers/sampleSidecar";

function highlightOn(page: number, index: number, note = ""): SidecarHighlight {
  return {
    id: `00000000-0000-4000-8000-${`${page}`.padStart(4, "0")}${`${index}`.padStart(8, "0")}`,
    categoryId: "fact",
    page,
    rect: [72, 700 - index * 20, 300, 712 - index * 20],
    quadPoints: [72, 712, 300, 712, 72, 700, 300, 700],
    kind: "text",
    text: `Passage ${index} on page ${page}.`,
    note,
    createdAt: "2026-09-01T14:00:00.000Z",
    updatedAt: "2026-09-01T14:00:00.000Z",
  };
}

function denseSidecar(): Sidecar {
  const sidecar = sampleSidecar();
  sidecar.highlights = [
    // Page 5: five highlights, one noted (qualifies at min 4).
    ...[1, 2, 3, 4].map((index) => highlightOn(5, index)),
    highlightOn(5, 5, "the one note"),
    // Page 6: four highlights, two noted (does not qualify: half carry notes).
    highlightOn(6, 1, "noted"),
    highlightOn(6, 2, "noted"),
    highlightOn(6, 3),
    highlightOn(6, 4),
    // Page 7: three highlights, none noted (below the threshold).
    ...[1, 2, 3].map((index) => highlightOn(7, index)),
  ];
  return sidecar;
}

const ATTESTATION = createAttestation({
  provider: "claude-cli",
  email: "you@school.edu",
  verified: false,
  documentSha256: "0123456789abcdef".repeat(4),
  attestedAt: "2026-09-02T10:00:00.000Z",
  responsibilityAcknowledged: true,
});

describe("pagesNeedingContext", () => {
  it("offers pages with enough highlights and too few notes, in page order", () => {
    expect(pagesNeedingContext(denseSidecar(), 4)).toEqual([5]);
    expect(pagesNeedingContext(denseSidecar(), 3)).toEqual([5, 7]);
  });

  it("offers nothing when every cluster is annotated or small", () => {
    expect(pagesNeedingContext(sampleSidecar(), 4)).toEqual([]);
  });
});

describe("buildPageContextPrompt", () => {
  it("carries the page's quotes, notes, category names and the reader's page note", () => {
    const sidecar = denseSidecar();
    sidecar.pageNotes = [
      {
        page: 5,
        note: "Watch the margins.",
        createdAt: "2026-09-01T14:02:00.000Z",
        updatedAt: "2026-09-01T14:02:00.000Z",
      },
    ];
    const prompt = buildPageContextPrompt(sidecar, 5, undefined, ATTESTATION);
    expect(prompt.user).toContain('page 5 of "Acme Widgets (A): The Pricing Decision"');
    expect(prompt.user).toContain('[Fact] "Passage 1 on page 5."');
    expect(prompt.user).toContain("(note: the one note)");
    expect(prompt.user).toContain("Watch the margins.");
    expect(prompt.user).toContain("2 to 4 sentences");
    expect(prompt.user).not.toContain("Passage 1 on page 6");
  });

  it("names the page label when it differs from the index", () => {
    const prompt = buildPageContextPrompt(denseSidecar(), 5, "v", ATTESTATION);
    expect(prompt.user).toContain("page v [5]");
  });

  it("refuses to build without a real attestation", () => {
    expect(() => buildPageContextPrompt(denseSidecar(), 5, undefined, {} as never)).toThrow(/attestation/);
  });
});

describe("pageContextInputDigest", () => {
  it("is stable, page-scoped and sensitive to that page's content", () => {
    const base = pageContextInputDigest(denseSidecar(), 5);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(pageContextInputDigest(denseSidecar(), 5)).toBe(base);
    expect(pageContextInputDigest(denseSidecar(), 6)).not.toBe(base);

    const edited = denseSidecar();
    const target = edited.highlights.find((highlight) => highlight.page === 5);
    if (target) {
      target.note = "a new thought";
    }
    expect(pageContextInputDigest(edited, 5)).not.toBe(base);

    const otherPage = denseSidecar();
    const other = otherPage.highlights.find((highlight) => highlight.page === 6);
    if (other) {
      other.note = "changed elsewhere";
    }
    expect(pageContextInputDigest(otherPage, 5)).toBe(base);
  });

  it("bakes in the prompt version", () => {
    expect(PAGE_CONTEXT_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
