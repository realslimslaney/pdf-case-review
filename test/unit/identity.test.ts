import { describe, expect, it } from "vitest";
import { parseClaudeAuthStatus, parseCodexAuthJson } from "../../src/core/ai/identity";

function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.sig`;
}

describe("parseClaudeAuthStatus", () => {
  it("reads the JSON status of current Claude Code builds", () => {
    const identity = parseClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "reader@school.edu",
        orgId: "8457c416-…",
        orgName: "School",
        subscriptionType: "max",
      }),
    );
    expect(identity).toEqual({
      provider: "claude-cli",
      loggedIn: true,
      email: "reader@school.edu",
      organization: "School",
      detail: "claude.ai · max",
      verified: true,
    });
  });

  it("falls back to prose output and reports unverified when no email is present", () => {
    expect(parseClaudeAuthStatus("Logged in via OAuth profile default (workspace: main)")).toMatchObject({
      loggedIn: true,
      email: null,
      verified: false,
    });
    expect(parseClaudeAuthStatus("Not logged in")).toMatchObject({ loggedIn: false, verified: false });
  });
});

describe("parseCodexAuthJson", () => {
  it("reads the email and plan from the id-token claims", () => {
    const authJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: fakeJwt({
          email: "reader@school.edu",
          "https://api.openai.com/auth": {
            chatgpt_plan_type: "plus",
            organizations: [{ title: "Personal" }],
          },
        }),
        access_token: "x",
      },
    });
    expect(parseCodexAuthJson(authJson, "Logged in using ChatGPT")).toEqual({
      provider: "codex-cli",
      loggedIn: true,
      email: "reader@school.edu",
      organization: "Personal",
      detail: "chatgpt · ChatGPT plus",
      verified: true,
    });
  });

  it("treats an API-key login as unverifiable", () => {
    expect(parseCodexAuthJson(JSON.stringify({ OPENAI_API_KEY: "sk-…", auth_mode: "apikey" }))).toMatchObject(
      {
        loggedIn: true,
        email: null,
        verified: false,
        detail: "API key",
      },
    );
  });

  it("degrades gracefully on garbage", () => {
    expect(parseCodexAuthJson("not json", "Not logged in")).toMatchObject({
      loggedIn: false,
      verified: false,
    });
  });
});
