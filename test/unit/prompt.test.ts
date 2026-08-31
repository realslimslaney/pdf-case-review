import { describe, expect, it } from "vitest";
import { type Attestation, createAttestation } from "../../src/core/ai/consent";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "../../src/core/ai/prompt";
import type { AiConsent } from "../../src/core/sidecar/types";

const RECORD: AiConsent = {
  provider: "manual",
  email: "you@school.edu",
  verified: false,
  documentSha256: "a".repeat(64),
  attestedAt: "2026-09-02T09:00:00.000Z",
  responsibilityAcknowledged: true,
  eligibilityConfirmed: true,
};

describe("buildSummaryPrompt", () => {
  it("cannot be called without an attestation", () => {
    // @ts-expect-error the attestation parameter is required: forgetting the gate is a type error
    expect(() => buildSummaryPrompt("body", { maxWords: 250 })).toThrow(/attestation/i);
    expect(() => buildSummaryPrompt("body", { maxWords: 250 }, {} as Attestation)).toThrow(/attestation/i);
    expect(() =>
      buildSummaryPrompt("body", { maxWords: 250 }, { record: {} } as unknown as Attestation),
    ).toThrow(/attestation/i);
  });

  it("builds the shared template with the word budget", () => {
    const prompt = buildSummaryPrompt("# Notes\n\nBody.", { maxWords: 100 }, createAttestation(RECORD));
    expect(prompt.system).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(prompt.user).toContain("# Notes");
    expect(prompt.user).toContain("at most 100 words");
    expect(prompt.user).toContain("3 to 5 key tensions");
  });

  it("falls back to the default word budget for nonsense values", () => {
    const prompt = buildSummaryPrompt("x", { maxWords: -3 }, createAttestation(RECORD));
    expect(prompt.user).toContain("at most 250 words");
  });
});
