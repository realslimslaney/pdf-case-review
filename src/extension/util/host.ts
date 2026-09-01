/** CLI providers and terminals need a Node extension host; the web host has no processes. */
export function isDesktopHost(): boolean {
  return typeof process !== "undefined" && typeof process.versions?.node === "string";
}
