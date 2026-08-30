/** RFC 4122 form, any version, case-insensitive: what the sidecar and `/NM` carry. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 v4 through Web Crypto: available in Node 22, browsers and the web extension host. */
export function newHighlightId(): string {
  return globalThis.crypto.randomUUID();
}
