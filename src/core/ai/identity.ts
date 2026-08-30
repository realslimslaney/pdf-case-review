// Who is the AI provider logged in as? Pure parsers for the identity data each CLI exposes;
// the extension host (desktop only) runs the commands / reads the files and hands the text here.
// Identity always comes from stored login metadata or the CLI's own status output, never
// from asking the model (plan §9.4).

export interface ProviderIdentity {
  provider: "claude-cli" | "codex-cli";
  loggedIn: boolean;
  email: string | null;
  organization: string | null;
  /** Free-form detail shown to the user (subscription, plan, auth mode). */
  detail: string | null;
  /** True when the email came from the tool's own output rather than a guess or user input. */
  verified: boolean;
}

/**
 * Parses `claude auth status` (JSON on recent Claude Code versions; older builds print prose).
 * Example: {"loggedIn":true,"authMethod":"claude.ai","email":"…","orgName":"…","subscriptionType":"max"}
 */
export function parseClaudeAuthStatus(output: string): ProviderIdentity {
  const base: ProviderIdentity = {
    provider: "claude-cli",
    loggedIn: false,
    email: null,
    organization: null,
    detail: null,
    verified: false,
  };
  const trimmed = output.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const email = typeof parsed["email"] === "string" ? parsed["email"] : null;
      const organization = typeof parsed["orgName"] === "string" ? parsed["orgName"] : null;
      const parts = [parsed["authMethod"], parsed["subscriptionType"]].filter(
        (value): value is string => typeof value === "string" && value !== "",
      );
      return {
        ...base,
        loggedIn: parsed["loggedIn"] === true,
        email,
        organization,
        detail: parts.length > 0 ? parts.join(" · ") : null,
        verified: email !== null,
      };
    } catch {
      return base;
    }
  }
  // Prose fallback: look for an email-shaped token and a "logged in" phrase.
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(trimmed)?.[0] ?? null;
  const loggedIn = /logged in/i.test(trimmed) && !/not logged in/i.test(trimmed);
  return {
    ...base,
    loggedIn,
    email,
    verified: email !== null,
    detail: loggedIn ? (trimmed.split("\n")[0] ?? null) : null,
  };
}

/** Decodes a JWT payload without verifying it; we only display the claims, never trust them. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split(".")[1];
  if (!segment) {
    return null;
  }
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Reads the identity from Codex's `auth.json` (under `CODEX_HOME`, default `~/.codex`).
 * `codex login status` only reports the auth mode; the email lives in the id-token claims.
 */
export function parseCodexAuthJson(authJson: string, loginStatusOutput = ""): ProviderIdentity {
  const base: ProviderIdentity = {
    provider: "codex-cli",
    loggedIn: /logged in/i.test(loginStatusOutput) && !/not logged in/i.test(loginStatusOutput),
    email: null,
    organization: null,
    detail: null,
    verified: false,
  };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(authJson) as Record<string, unknown>;
  } catch {
    return base;
  }
  const authMode = typeof parsed["auth_mode"] === "string" ? parsed["auth_mode"] : null;
  const tokens = parsed["tokens"];
  if (typeof parsed["OPENAI_API_KEY"] === "string" && parsed["OPENAI_API_KEY"] !== "" && !tokens) {
    return { ...base, loggedIn: true, detail: "API key", verified: false };
  }
  const idToken =
    tokens &&
    typeof tokens === "object" &&
    typeof (tokens as Record<string, unknown>)["id_token"] === "string"
      ? ((tokens as Record<string, unknown>)["id_token"] as string)
      : null;
  const claims = idToken ? decodeJwtPayload(idToken) : null;
  if (!claims) {
    return { ...base, detail: authMode };
  }
  const email = typeof claims["email"] === "string" ? claims["email"] : null;
  const openai = claims["https://api.openai.com/auth"];
  let organization: string | null = null;
  let plan: string | null = null;
  if (openai && typeof openai === "object") {
    const record = openai as Record<string, unknown>;
    plan = typeof record["chatgpt_plan_type"] === "string" ? record["chatgpt_plan_type"] : null;
    const organizations = record["organizations"];
    if (Array.isArray(organizations)) {
      const titles = organizations
        .map((entry) =>
          entry && typeof entry === "object" ? (entry as Record<string, unknown>)["title"] : null,
        )
        .filter((title): title is string => typeof title === "string");
      organization = titles.length > 0 ? titles.join(", ") : null;
    }
  }
  const detailParts = [authMode, plan ? `ChatGPT ${plan}` : null].filter(
    (part): part is string => part !== null,
  );
  return {
    ...base,
    loggedIn: base.loggedIn || email !== null,
    email,
    organization,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    verified: email !== null,
  };
}
