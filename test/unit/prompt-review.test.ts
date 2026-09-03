import { describe, expect, it } from "vitest";
import {
  cachedSummaryDocument,
  filesToPrune,
  promptStats,
  promptText,
  runFileName,
  runTimestamp,
} from "../../src/core/ai/promptReview";

describe("promptText", () => {
  it("joins system and user with one blank line, the stdin shape the providers receive", () => {
    expect(promptText({ system: "SYS", user: "USER" })).toBe("SYS\n\nUSER");
  });
});

describe("promptStats", () => {
  it("counts whitespace-separated words and estimates four characters per token", () => {
    expect(promptStats("one two  three\nfour ")).toEqual({ words: 4, chars: 20, tokens: 5 });
    expect(promptStats("")).toEqual({ words: 0, chars: 0, tokens: 0 });
  });
});

describe("run file names", () => {
  it("replaces the colons of the ISO timestamp and names every kind of file", () => {
    const stamp = runTimestamp(new Date("2026-09-03T10:11:12.345Z"));
    expect(stamp).toBe("2026-09-03T10-11-12.345Z");
    expect(runFileName("prompt", stamp)).toBe("summary-2026-09-03T10-11-12.345Z.prompt.md");
    expect(runFileName("output", stamp)).toBe("summary-2026-09-03T10-11-12.345Z.output.md");
    expect(runFileName("cached-output", stamp)).toBe("summary-cached-2026-09-03T10-11-12.345Z.output.md");
  });
});

describe("filesToPrune", () => {
  it("keeps the newest files by timestamp, whatever their prefix", () => {
    const names = [
      "summary-cached-2026-01-01T00-00-00.000Z.output.md",
      "summary-2026-03-01T00-00-00.000Z.prompt.md",
      "summary-2026-03-01T00-00-00.000Z.output.md",
      "summary-2026-02-01T00-00-00.000Z.prompt.md",
      "stray.txt",
    ];
    expect(filesToPrune(names, 2)).toEqual([
      "summary-2026-02-01T00-00-00.000Z.prompt.md",
      "summary-cached-2026-01-01T00-00-00.000Z.output.md",
      "stray.txt",
    ]);
    expect(filesToPrune(names, 10)).toEqual([]);
    expect(filesToPrune([], 2)).toEqual([]);
  });
});

describe("cachedSummaryDocument", () => {
  it("writes a provenance header, optional model and account, then the text", () => {
    expect(
      cachedSummaryDocument({
        provider: "claude-cli",
        generatedAt: "2026-09-03T10:00:00.000Z",
        text: "Summary body.",
        model: "opus",
        account: "me@example.com",
      }),
    ).toBe(
      "Generated with claude-cli on 2026-09-03T10:00:00.000Z, model opus, account me@example.com\n\nSummary body.\n",
    );
    expect(
      cachedSummaryDocument({ provider: "codex-cli", generatedAt: "2026-09-03T10:00:00.000Z", text: "Body" }),
    ).toBe("Generated with codex-cli on 2026-09-03T10:00:00.000Z\n\nBody\n");
  });
});
