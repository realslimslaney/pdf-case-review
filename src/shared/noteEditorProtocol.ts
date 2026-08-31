// The typed message contract between the extension host and the note editor view. Separate from
// the PDF viewer protocol: a different webview with a different lifecycle. Messages from the view
// are validated in full at the boundary; every mutating message names its target so the host can
// drop messages that raced a target switch.

export type NoteTarget =
  | { kind: "highlight"; id: string }
  | { kind: "page"; page: number }
  | { kind: "document"; id: string };

export interface NoteEditorCategory {
  id: string;
  name: string;
  color: string;
}

export interface NoteEditorLoad {
  type: "load";
  /** The PDF document the target belongs to; echoed back on every mutating message. */
  documentUri: string;
  target: NoteTarget;
  /** Heading: the document note's title, `Page 3`, or `Highlight`. */
  title: string;
  /** The highlighted passage; null for page and document notes. */
  quote: string | null;
  /** `p. 12` or `p. iv [4]`; empty for document notes. */
  citation: string;
  /** The document's palette; empty when the target has no category (page and document notes). */
  categories: NoteEditorCategory[];
  categoryId: string | null;
  note: string;
}

export type HostToNoteEditorMessage =
  | NoteEditorLoad
  | { type: "clear"; reason: "noDocument" | "noTarget" }
  /** A saveNote was applied to the model; the view announces it through its live region. */
  | { type: "saved" };

/**
 * Every mutating message is fully addressed (document plus target), so a save flushed while the
 * host was already switched to another note, or another document, still lands where it belongs.
 */
export type NoteEditorToHostMessage =
  | { type: "ready" }
  | { type: "saveNote"; documentUri: string; target: NoteTarget; note: string }
  | { type: "setCategory"; documentUri: string; target: NoteTarget; categoryId: string }
  | { type: "deleteTarget"; documentUri: string; target: NoteTarget }
  | { type: "revealTarget"; documentUri: string; target: NoteTarget };

/** One line under the title saying what kind of note this is and where it lands in the report. */
export function noteScopeLine(target: NoteTarget): string {
  switch (target.kind) {
    case "highlight":
      return "Highlight note · shown beneath its quote in the report";
    case "page":
      return `Page note · shown with page ${target.page} in the report`;
    case "document":
      return "Document note · shown under Document notes at the top of the report";
  }
}

export function isNoteTarget(value: unknown): value is NoteTarget {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const target = value as Record<string, unknown>;
  switch (target["kind"]) {
    case "highlight":
    case "document":
      return typeof target["id"] === "string";
    case "page":
      return typeof target["page"] === "number" && Number.isInteger(target["page"]) && target["page"] >= 1;
    default:
      return false;
  }
}

export function isNoteEditorToHostMessage(value: unknown): value is NoteEditorToHostMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  const addressed =
    typeof message["documentUri"] === "string" &&
    message["documentUri"] !== "" &&
    isNoteTarget(message["target"]);
  switch (message["type"]) {
    case "ready":
      return true;
    case "saveNote":
      return addressed && typeof message["note"] === "string";
    case "setCategory":
      return addressed && typeof message["categoryId"] === "string";
    case "deleteTarget":
    case "revealTarget":
      return addressed;
    default:
      return false;
  }
}

export function sameNoteTarget(left: NoteTarget, right: NoteTarget): boolean {
  switch (left.kind) {
    case "highlight":
      return right.kind === "highlight" && right.id === left.id;
    case "page":
      return right.kind === "page" && right.page === left.page;
    case "document":
      return right.kind === "document" && right.id === left.id;
  }
}
