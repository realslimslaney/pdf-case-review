/** RFC 4122 v4 through Web Crypto: available in Node 22, browsers and the web extension host. */
export function newHighlightId(): string {
  return globalThis.crypto.randomUUID();
}
