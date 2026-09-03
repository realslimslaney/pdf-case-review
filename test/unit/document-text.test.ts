import { describe, expect, it } from "vitest";
import { createAttestation, needsReconsent } from "../../src/core/ai/consent";
import { summaryInputDigest } from "../../src/core/ai/digest";
import { buildDocumentText, coverageLine } from "../../src/core/ai/documentText";
import { buildSummaryPrompt } from "../../src/core/ai/prompt";
import { serializeSidecar } from "../../src/core/sidecar/serialize";
import { parseSidecar } from "../../src/core/sidecar/validate";
import { sampleSidecar } from "./helpers/sampleSidecar";

const PAGES = [
  { page: 1, pageLabel: "i", text: "  Opening   context. " },
  { page: 2, text: null },
  { page: 3, text: "Exhibit discussion." },
];

describe("buildDocumentText", () => {
  it("chunks pages with citations, skips empty ones and counts coverage honestly", () => {
    const result = buildDocumentText(PAGES);
    expect(result.pagesWithText).toBe(2);
    expect(result.pageCount).toBe(3);
    expect(result.words).toBe(4);
    expect(result.section).toContain("--- p. i [1] ---\nOpening context.");
    expect(result.section).toContain("--- p. 3 ---\nExhibit discussion.");
    expect(result.section).not.toContain("p. 2");
    expect(result.section).toContain(coverageLine(result));
    expect(result.truncatedAfterPage).toBeUndefined();
  });

  it("stops at the size budget and says so in the section", () => {
    const long = [
      { page: 1, text: "a".repeat(60) },
      { page: 2, text: "b".repeat(60) },
      { page: 3, text: "c".repeat(60) },
    ];
    const result = buildDocumentText(long, 150);
    expect(result.pagesWithText).toBe(2);
    expect(result.truncatedAfterPage).toBe(2);
    expect(result.section).toContain("exceeded the size budget after page 2");
    expect(result.section).not.toContain("ccc");
  });
});

describe("prompt and digest with the document-text scope", () => {
  const attestation = createAttestation({
    provider: "manual",
    email: "you@school.edu",
    verified: false,
    documentSha256: "0123456789abcdef".repeat(4),
    attestedAt: "2026-09-03T10:00:00.000Z",
    responsibilityAcknowledged: true,
  });

  it("appends the document text between the notes body and the instruction", () => {
    const documentText = buildDocumentText(PAGES);
    const prompt = buildSummaryPrompt("# Notes body", { maxWords: 100 }, attestation, documentText);
    const body = prompt.user.indexOf("# Notes body");
    const section = prompt.user.indexOf("Document text (");
    const instruction = prompt.user.indexOf("Write an executive summary");
    expect(body).toBeGreaterThanOrEqual(0);
    expect(section).toBeGreaterThan(body);
    expect(instruction).toBeGreaterThan(section);
    expect(prompt.system).toContain("notes and document text provided");
    expect(prompt.system).toContain("cite the page markers");
  });

  it("keeps the notes-only system prompt byte-identical without document text", () => {
    const prompt = buildSummaryPrompt("# Notes body", { maxWords: 100 }, attestation);
    expect(prompt.system).toBe(
      "You are helping a reader synthesize their own reading notes on a document. " +
        "Use only the highlights and notes provided; do not invent facts.",
    );
  });

  it("scope changes the digest; the notes digest is unchanged from before scopes existed", () => {
    const sidecar = sampleSidecar();
    const notes = summaryInputDigest(sidecar, 250);
    expect(summaryInputDigest(sidecar, 250, "notes")).toBe(notes);
    expect(summaryInputDigest(sidecar, 250, "document-text")).not.toBe(notes);
  });
});

describe("needsReconsent on scope changes", () => {
  const stored = {
    provider: "manual",
    email: "you@school.edu",
    verified: false,
    documentSha256: "abc",
    attestedAt: "2026-09-03T10:00:00.000Z",
    responsibilityAcknowledged: true,
    eligibilityConfirmed: true,
    wordingVersion: 1,
    contextScope: "notes",
  };
  const current = {
    provider: "manual",
    email: "you@school.edu",
    documentSha256: "abc",
    protected: false,
  };

  it("re-asks when the scope widens to document text and when it narrows back", () => {
    expect(needsReconsent(stored, { ...current, contextScope: "notes" })).toBe(false);
    expect(needsReconsent(stored, { ...current, contextScope: "document-text" })).toBe(true);
    expect(
      needsReconsent({ ...stored, contextScope: "document-text" }, { ...current, contextScope: "notes" }),
    ).toBe(true);
  });

  it("treats a pre-scope consent as notes-only", () => {
    const { contextScope, ...legacy } = stored;
    expect(needsReconsent(legacy, { ...current, contextScope: "notes" })).toBe(false);
    expect(needsReconsent(legacy, { ...current, contextScope: "document-text" })).toBe(true);
  });
});

describe("sidecar round-trip of contextScope", () => {
  it("keeps contextScope on aiSummary and aiConsent through serialize and parse", () => {
    const sidecar = sampleSidecar();
    sidecar.aiSummary = {
      provider: "manual",
      generatedAt: "2026-09-03T10:00:00.000Z",
      text: "Summary.",
      contextScope: "document-text",
    };
    sidecar.aiConsent = {
      provider: "manual",
      email: "you@school.edu",
      verified: false,
      documentSha256: sidecar.source.sha256,
      attestedAt: "2026-09-03T10:00:00.000Z",
      responsibilityAcknowledged: true,
      contextScope: "document-text",
    };
    const parsed = parseSidecar(serializeSidecar(sidecar));
    expect(parsed.aiSummary?.contextScope).toBe("document-text");
    expect(parsed.aiConsent?.contextScope).toBe("document-text");
  });
});
