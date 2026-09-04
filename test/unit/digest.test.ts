import { describe, expect, it } from "vitest";
import { fnv1a64, summaryInputDigest } from "../../src/core/ai/digest";
import { SUMMARY_PROMPT_VERSION } from "../../src/core/ai/prompt";
import { reportInputFromSidecar } from "../../src/core/report/fromSidecar";
import { renderReport } from "../../src/core/report/render";
import { sampleSidecar } from "./helpers/sampleSidecar";

const CONTEXT = { generatedAt: "2026-09-02T10:00:00.000Z", includeAiSummary: true };
const STALE_LINE = "This summary may be out of date";
const UNVERIFIED_LINE = "could not be checked";

describe("fnv1a64", () => {
  it("is a 16-char hex string and separates nearby inputs", () => {
    expect(fnv1a64("")).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64("a")).not.toBe(fnv1a64("b"));
    expect(fnv1a64("ab")).not.toBe(fnv1a64("ba"));
  });
});

describe("summaryInputDigest", () => {
  it("is stable across calls and across array reordering", () => {
    const sidecar = sampleSidecar();
    const digest = summaryInputDigest(sidecar, 250);
    expect(summaryInputDigest(sampleSidecar(), 250)).toBe(digest);
    sidecar.highlights.reverse();
    sidecar.pageNotes?.reverse();
    expect(summaryInputDigest(sidecar, 250)).toBe(digest);
  });

  it("changes when a note, a quote, a category name, or the word budget changes", () => {
    const base = summaryInputDigest(sampleSidecar(), 250);

    const notes = sampleSidecar();
    const [first] = notes.highlights;
    if (!first) {
      throw new Error("sample sidecar has no highlights");
    }
    first.note = `${first.note} and one more thought`;
    expect(summaryInputDigest(notes, 250)).not.toBe(base);

    const renamed = sampleSidecar();
    const [category] = renamed.categories;
    if (!category) {
      throw new Error("sample sidecar has no categories");
    }
    category.name = "Renamed";
    expect(summaryInputDigest(renamed, 250)).not.toBe(base);

    expect(summaryInputDigest(sampleSidecar(), 100)).not.toBe(base);
  });

  it("ignores fields the prompt never sees, like rects and pdfjs ids", () => {
    const base = summaryInputDigest(sampleSidecar(), 250);
    const sidecar = sampleSidecar();
    const [first] = sidecar.highlights;
    if (!first) {
      throw new Error("sample sidecar has no highlights");
    }
    first.rect = [1, 2, 3, 4];
    first.pdfjsId = "999R";
    expect(summaryInputDigest(sidecar, 250)).toBe(base);
  });
});

describe("report staleness", () => {
  function withSummary(inputDigest?: string, promptVersion?: number) {
    const sidecar = sampleSidecar();
    sidecar.aiSummary = {
      provider: "manual",
      generatedAt: "2026-09-02T09:30:00.000Z",
      text: "Summary text.",
      ...(inputDigest !== undefined ? { inputDigest } : {}),
      ...(promptVersion !== undefined ? { promptVersion } : {}),
    };
    return sidecar;
  }

  it("marks a summary without a digest unverified, and a mismatched one stale", () => {
    const unverified = reportInputFromSidecar(withSummary(), CONTEXT).aiSummary;
    expect(unverified?.unverified).toBe(true);
    expect(unverified?.stale).toBeFalsy();
    const stale = reportInputFromSidecar(
      withSummary("0000000000000000", SUMMARY_PROMPT_VERSION),
      CONTEXT,
    ).aiSummary;
    expect(stale?.stale).toBe(true);
    expect(stale?.unverified).toBeFalsy();
  });

  it("leaves a matching summary unmarked, then marks it after a note edit", () => {
    const sidecar = withSummary();
    const summary = sidecar.aiSummary;
    if (!summary) {
      throw new Error("summary was just set");
    }
    summary.inputDigest = summaryInputDigest(sidecar, 250);
    summary.promptVersion = SUMMARY_PROMPT_VERSION;
    expect(reportInputFromSidecar(sidecar, { ...CONTEXT, aiMaxWords: 250 }).aiSummary?.stale).toBeUndefined();

    // A different word budget means a different prompt, so the cached summary is stale.
    expect(reportInputFromSidecar(sidecar, { ...CONTEXT, aiMaxWords: 120 }).aiSummary?.stale).toBe(true);

    const [first] = sidecar.highlights;
    if (!first) {
      throw new Error("sample sidecar has no highlights");
    }
    first.note = "changed after the summary was generated";
    expect(reportInputFromSidecar(sidecar, { ...CONTEXT, aiMaxWords: 250 }).aiSummary?.stale).toBe(true);
  });

  it("renders the caution line only for stale summaries", async () => {
    const stale = reportInputFromSidecar(withSummary("0000000000000000", SUMMARY_PROMPT_VERSION), CONTEXT);
    const staleMarkdown = new TextDecoder().decode((await renderReport(stale, "markdown")).bytes);
    expect(staleMarkdown).toContain(STALE_LINE);

    const unverified = reportInputFromSidecar(withSummary(), CONTEXT);
    const unverifiedMarkdown = new TextDecoder().decode((await renderReport(unverified, "markdown")).bytes);
    expect(unverifiedMarkdown).toContain(UNVERIFIED_LINE);
    expect(unverifiedMarkdown).not.toContain(STALE_LINE);

    const sidecar = withSummary();
    const summary = sidecar.aiSummary;
    if (!summary) {
      throw new Error("summary was just set");
    }
    summary.inputDigest = summaryInputDigest(sidecar);
    summary.promptVersion = SUMMARY_PROMPT_VERSION;
    const fresh = reportInputFromSidecar(sidecar, CONTEXT);
    const freshMarkdown = new TextDecoder().decode((await renderReport(fresh, "markdown")).bytes);
    expect(freshMarkdown).toContain("AI summary");
    expect(freshMarkdown).not.toContain(STALE_LINE);
  });
});
