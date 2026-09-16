import { describe, expect, it } from "vitest";

import { looksLikeUsageLimit } from "../../src/core/ai/providerErrors";

describe("looksLikeUsageLimit", () => {
  it("recognizes the CLI wordings for an exhausted plan", () => {
    expect(
      looksLikeUsageLimit(
        "claude exited with code 1: You've hit your limit · resets at 3pm (America/New_York)",
      ),
    ).toBe(true);
    expect(looksLikeUsageLimit("Usage limit reached for this session")).toBe(true);
    expect(looksLikeUsageLimit("codex exited with code 1: 429 Too Many Requests, quota exceeded")).toBe(true);
  });

  it("leaves other failures alone", () => {
    expect(looksLikeUsageLimit("claude timed out after 120 s")).toBe(false);
    expect(looksLikeUsageLimit("codex exited with code 1: unknown model gpt-x")).toBe(false);
    expect(looksLikeUsageLimit("")).toBe(false);
  });
});
