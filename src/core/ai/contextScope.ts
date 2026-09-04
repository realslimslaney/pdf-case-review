// The AI context scopes, narrowest first. The order is the consent rule: a consent recorded for
// a wider scope covers runs at any narrower one, and only widening re-asks.

export const AI_CONTEXT_SCOPES = ["notes", "document-text"] as const;

export type AiContextScope = (typeof AI_CONTEXT_SCOPES)[number];

export function scopeRank(scope: string | undefined): number {
  const index = (AI_CONTEXT_SCOPES as readonly string[]).indexOf(scope ?? "notes");
  return index < 0 ? 0 : index;
}
