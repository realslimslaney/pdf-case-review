import { describe, expect, it } from "vitest";
import { isNoteEditorToHostMessage, isNoteTarget, sameNoteTarget } from "../../src/shared/noteEditorProtocol";

describe("isNoteTarget", () => {
  it("accepts the three target kinds and rejects malformed values", () => {
    expect(isNoteTarget({ kind: "highlight", id: "a" })).toBe(true);
    expect(isNoteTarget({ kind: "document", id: "a" })).toBe(true);
    expect(isNoteTarget({ kind: "page", page: 3 })).toBe(true);
    expect(isNoteTarget({ kind: "page", page: 0 })).toBe(false);
    expect(isNoteTarget({ kind: "page", page: "3" })).toBe(false);
    expect(isNoteTarget({ kind: "highlight" })).toBe(false);
    expect(isNoteTarget({ kind: "pageNote", page: 3 })).toBe(false);
    expect(isNoteTarget(null)).toBe(false);
    expect(isNoteTarget("highlight")).toBe(false);
  });
});

describe("isNoteEditorToHostMessage", () => {
  const target = { kind: "highlight", id: "a" };
  const documentUri = "file:///case.pdf";

  it("validates every message shape in full, including the document address", () => {
    expect(isNoteEditorToHostMessage({ type: "ready" })).toBe(true);
    expect(isNoteEditorToHostMessage({ type: "saveNote", documentUri, target, note: "x" })).toBe(true);
    expect(isNoteEditorToHostMessage({ type: "saveNote", target, note: "x" })).toBe(false);
    expect(isNoteEditorToHostMessage({ type: "saveNote", documentUri: "", target, note: "x" })).toBe(false);
    expect(isNoteEditorToHostMessage({ type: "saveNote", documentUri, target, note: 3 })).toBe(false);
    expect(isNoteEditorToHostMessage({ type: "saveNote", documentUri, note: "x" })).toBe(false);
    expect(isNoteEditorToHostMessage({ type: "setCategory", documentUri, target, categoryId: "fact" })).toBe(
      true,
    );
    expect(isNoteEditorToHostMessage({ type: "setCategory", documentUri, target })).toBe(false);
    expect(isNoteEditorToHostMessage({ type: "deleteTarget", documentUri, target })).toBe(true);
    expect(isNoteEditorToHostMessage({ type: "revealTarget", documentUri, target })).toBe(true);
    expect(isNoteEditorToHostMessage({ type: "load", documentUri, target })).toBe(false);
    expect(isNoteEditorToHostMessage(undefined)).toBe(false);
  });
});

describe("sameNoteTarget", () => {
  it("matches only targets of the same kind and identity", () => {
    expect(sameNoteTarget({ kind: "highlight", id: "a" }, { kind: "highlight", id: "a" })).toBe(true);
    expect(sameNoteTarget({ kind: "highlight", id: "a" }, { kind: "highlight", id: "b" })).toBe(false);
    expect(sameNoteTarget({ kind: "highlight", id: "a" }, { kind: "document", id: "a" })).toBe(false);
    expect(sameNoteTarget({ kind: "page", page: 3 }, { kind: "page", page: 3 })).toBe(true);
    expect(sameNoteTarget({ kind: "page", page: 3 }, { kind: "page", page: 4 })).toBe(false);
    expect(sameNoteTarget({ kind: "document", id: "a" }, { kind: "document", id: "a" })).toBe(true);
  });
});
