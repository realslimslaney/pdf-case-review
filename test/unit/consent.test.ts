import { describe, expect, it } from "vitest";
import {
  CONSENT_WORDING_VERSION,
  checkRule,
  createAttestation,
  extractAuthorizationLine,
  firstMatchingRule,
  isAttestation,
  needsReconsent,
} from "../../src/core/ai/consent";
import type { AiConsent } from "../../src/core/sidecar/types";

const FACTS = { protected: true, authorizationLine: null, filePath: "/cases/acme.pdf" };

function consent(overrides: Partial<AiConsent> = {}): AiConsent {
  return {
    provider: "manual",
    email: "you@school.edu",
    verified: false,
    documentSha256: "a".repeat(64),
    attestedAt: "2026-09-02T09:00:00.000Z",
    responsibilityAcknowledged: true,
    eligibilityConfirmed: true,
    wordingVersion: CONSENT_WORDING_VERSION,
    ...overrides,
  };
}

describe("extractAuthorizationLine", () => {
  it("finds each licensing phrase and trims to a sentence", () => {
    expect(
      extractAuthorizationLine(
        "Case 9-123-456. Authorized for use only by Jane Doe until 2026-12-31. Do not copy.",
      ),
    ).toBe("Authorized for use only by Jane Doe until 2026-12-31.");
    expect(extractAuthorizationLine("This copy is licensed to J. Doe.\nPage 1")).toContain("licensed to");
    expect(extractAuthorizationLine("Prepared for the personal use of X")).toContain("personal use of X");
    expect(extractAuthorizationLine("An ordinary first page with an abstract.")).toBeNull();
  });
});

describe("firstMatchingRule", () => {
  it("matches on protected, pathGlob and authorizationLineMatches", () => {
    const protectedRule = { when: { protected: true }, email: "a@b.c" };
    expect(firstMatchingRule([protectedRule], FACTS)).toEqual({ kind: "matched", rule: protectedRule });
    expect(firstMatchingRule([protectedRule], { ...FACTS, protected: false })).toEqual({ kind: "none" });

    const globRule = { when: { pathGlob: "cases/*.pdf" }, email: "a@b.c" };
    expect(firstMatchingRule([globRule], { ...FACTS, protected: false }).kind).toBe("matched");
    expect(firstMatchingRule([{ when: { pathGlob: "other/*.pdf" }, email: "a@b.c" }], FACTS).kind).toBe(
      "none",
    );

    const lineRule = { when: { authorizationLineMatches: "Jane" }, email: "a@b.c" };
    expect(firstMatchingRule([lineRule], { ...FACTS, authorizationLine: "for Jane Doe" }).kind).toBe(
      "matched",
    );
    expect(firstMatchingRule([lineRule], { ...FACTS, authorizationLine: "for John" }).kind).toBe("none");
  });

  it("blocks when a line-conditioned rule cannot see the line", () => {
    const rule = { when: { authorizationLineMatches: "Jane" }, email: "a@b.c" };
    expect(firstMatchingRule([rule], FACTS)).toEqual({ kind: "needsAuthorizationLine", rule });
  });

  it("takes the first matching rule", () => {
    const first = { when: { protected: true }, email: "first@b.c" };
    const second = { email: "second@b.c" };
    expect(firstMatchingRule([first, second], FACTS)).toEqual({ kind: "matched", rule: first });
    expect(firstMatchingRule([first, second], { ...FACTS, protected: false })).toEqual({
      kind: "matched",
      rule: second,
    });
  });
});

describe("checkRule", () => {
  it("refuses a wrong or unknown email, case-insensitively, with no override", () => {
    const rule = { email: "You@School.edu" };
    expect(checkRule(rule, { email: "you@school.edu", verified: true })).toEqual({ ok: true });
    expect(checkRule(rule, { email: "you@gmail.com", verified: true })).toEqual({
      ok: false,
      requiredEmail: "You@School.edu",
    });
    expect(checkRule(rule, { email: null, verified: false })).toEqual({
      ok: false,
      requiredEmail: "You@School.edu",
    });
    expect(checkRule({ use: "school" }, { email: null, verified: false })).toEqual({ ok: true });
  });
});

describe("needsReconsent", () => {
  const current = {
    provider: "manual",
    email: "you@school.edu",
    documentSha256: "a".repeat(64),
    protected: false,
  };

  it("re-asks on any change of login, provider, file or wording, and always for protected", () => {
    expect(needsReconsent(consent(), current)).toBe(false);
    expect(needsReconsent(undefined, current)).toBe(true);
    expect(needsReconsent(consent(), { ...current, protected: true })).toBe(true);
    expect(needsReconsent(consent(), { ...current, email: "Other@school.edu" })).toBe(true);
    expect(needsReconsent(consent({ email: "YOU@school.edu" }), current)).toBe(false);
    expect(needsReconsent(consent(), { ...current, provider: "claude-cli" })).toBe(true);
    expect(needsReconsent(consent(), { ...current, documentSha256: "b".repeat(64) })).toBe(true);
    expect(needsReconsent(consent({ wordingVersion: CONSENT_WORDING_VERSION - 1 }), current)).toBe(true);
    const { eligibilityConfirmed: _unconfirmed, ...withoutConfirmation } = consent();
    expect(needsReconsent(withoutConfirmation, current)).toBe(true);
  });
});

describe("createAttestation", () => {
  it("requires an email, a timestamp and the acknowledged responsibility", () => {
    expect(isAttestation(createAttestation(consent()))).toBe(true);
    expect(() => createAttestation(consent({ email: "" }))).toThrow();
    expect(() => createAttestation(consent({ responsibilityAcknowledged: false }))).toThrow();
    expect(isAttestation({})).toBe(false);
    expect(isAttestation({ record: { email: "a@b.c" } })).toBe(false);
  });
});
