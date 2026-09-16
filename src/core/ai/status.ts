// The AI status bar text: provider and the account the active document runs under, derived from
// settings and rules only (no CLI is asked), so it can refresh on every edit.

import { type AccountResolution, type AiProvider, PROVIDER_LABEL } from "./accounts";

export interface AiStatusInput {
  provider: "off" | AiProvider;
  /** Undefined when the provider is off. */
  resolution: AccountResolution | undefined;
  /** CLI providers only run on desktop VS Code. */
  desktop: boolean;
}

export interface AiStatus {
  text: string;
  /** True when the run would be refused as configured. */
  warning: boolean;
}

export function aiStatusText(input: AiStatusInput): AiStatus {
  if (input.provider === "off") {
    return { text: "$(sparkle) AI off", warning: false };
  }
  const label = PROVIDER_LABEL[input.provider];
  if (!input.desktop) {
    return { text: `$(sparkle) ${label} · desktop only`, warning: false };
  }
  const resolution = input.resolution ?? { kind: "none" };
  switch (resolution.kind) {
    case "none":
      return { text: `$(sparkle) ${label}`, warning: false };
    case "resolved":
      return { text: `$(sparkle) ${label} · ${resolution.accountId}`, warning: false };
    case "needsAuthorizationLine":
      return { text: `$(sparkle) ${label} · rule pending`, warning: false };
    case "missingForProvider":
      return { text: `$(warning) ${label} · no "${resolution.accountId}" login`, warning: true };
    case "unknownId":
      return { text: `$(warning) ${label} · "${resolution.accountId}" unknown`, warning: true };
  }
}

/** The rule condition in words for tooltips: the path glob, "protected documents", or "always". */
export function describeRule(rule: {
  when?: { protected?: boolean; authorizationLineMatches?: string; pathGlob?: string };
}): string {
  const when = rule.when ?? {};
  const parts: string[] = [];
  if (when.pathGlob !== undefined) {
    parts.push(`pathGlob ${when.pathGlob}`);
  }
  if (when.protected !== undefined) {
    parts.push(when.protected ? "protected documents" : "unprotected documents");
  }
  if (when.authorizationLineMatches !== undefined) {
    parts.push(`authorization line matches /${when.authorizationLineMatches}/`);
  }
  return parts.length > 0 ? parts.join(", ") : "always";
}
