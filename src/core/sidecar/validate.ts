// Boundary validation for sidecar files. Everything a hand-edited or foreign file could get wrong
// is reported with its JSON path. Hand-written rather than schema-driven: the schema is small,
// and `contributes.jsonValidation` already gives editor-time feedback from the same schema file.
// The allow-list of keys is derived from the read code itself: every accessor claims its key and
// `Reader.done()` rejects whatever was never claimed, so a new field is added in one place.

import { validateCategories } from "../categories";
import { UUID_PATTERN } from "./ids";
import {
  type AiConsent,
  type AiSummary,
  type DocumentNote,
  type HighlightContext,
  type HighlightKind,
  type PageNote,
  type PdfWriteStatus,
  type Rect,
  SIDECAR_VERSION,
  type Sidecar,
  type SidecarCategory,
  type SidecarHighlight,
  type SidecarSource,
  toRect,
} from "./types";

export class SidecarError extends Error {
  override readonly name = "SidecarError";

  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(path === "" ? detail : `${path}: ${detail}`);
  }
}

type JsonObject = Record<string, unknown>;

const SHA256 = /^[0-9a-f]{64}$/;
const COLOR = /^#[0-9A-F]{6}$/;
const CATEGORY_ID = /^[a-z][a-z0-9-]*$/;
const PDFJS_ID = /^[0-9]+R([0-9]+)?$/;
const PDF_WRITE: readonly PdfWriteStatus[] = ["synced", "skipped-protected", "skipped-setting", "failed"];
const KINDS: readonly HighlightKind[] = ["text", "free"];

function fail(path: string, detail: string): never {
  throw new SidecarError(path, detail);
}

function at(path: string, key: string | number): string {
  if (typeof key === "number") {
    return `${path}[${key}]`;
  }
  return path === "" ? key : `${path}.${key}`;
}

/** Sets an optional property only when a value is present (`exactOptionalPropertyTypes`). */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: Exclude<T[K], undefined> | undefined) {
  if (value !== undefined) {
    target[key] = value;
  }
}

/** Reads one JSON value at a path, failing with that path on a type mismatch. */
type Read<T> = (value: unknown, path: string) => T;

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail(path, "expected a string");
  }
  return value;
}

function pattern(regex: RegExp, expected: string): Read<string> {
  return (value, path) => {
    const text = string(value, path);
    if (!regex.test(text)) {
      fail(path, `expected ${expected}`);
    }
    return text;
  };
}

function integer(minimum?: number): Read<number> {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      fail(path, "expected an integer");
    }
    if (minimum !== undefined && value < minimum) {
      fail(path, `expected an integer >= ${minimum}`);
    }
    return value;
  };
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a number");
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "expected a boolean");
  }
  return value;
}

function dateTime(value: unknown, path: string): string {
  const text = string(value, path);
  if (Number.isNaN(Date.parse(text))) {
    fail(path, "expected an ISO 8601 date-time");
  }
  return text;
}

function oneOf<T extends string>(allowed: readonly T[]): Read<T> {
  return (value, path) => {
    const text = string(value, path);
    if (!(allowed as readonly string[]).includes(text)) {
      fail(path, `expected one of ${allowed.join(", ")}`);
    }
    return text as T;
  };
}

function arrayOf<T>(read: Read<T>): Read<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) {
      fail(path, "expected an array");
    }
    return value.map((entry, index) => read(entry, at(path, index)));
  };
}

const numbers = arrayOf(number);

/** Typed access to one JSON object; `done()` rejects every key no accessor claimed. */
class Reader {
  private readonly claimed = new Set<string>();

  private constructor(
    private readonly record: JsonObject,
    readonly path: string,
  ) {}

  static of(value: unknown, path: string): Reader {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(path, "expected an object");
    }
    return new Reader(value as JsonObject, path);
  }

  at(key: string): string {
    return at(this.path, key);
  }

  has(key: string): boolean {
    this.claimed.add(key);
    return key in this.record;
  }

  raw(key: string): unknown {
    this.claimed.add(key);
    return this.record[key];
  }

  required<T>(key: string, read: Read<T>): T {
    this.claimed.add(key);
    if (!(key in this.record)) {
      fail(this.at(key), "missing required property");
    }
    return read(this.record[key], this.at(key));
  }

  optional<T>(key: string, read: Read<T>): T | undefined {
    this.claimed.add(key);
    return key in this.record ? read(this.record[key], this.at(key)) : undefined;
  }

  /** Call once every field has been claimed: the read code itself is the allow-list. */
  done(): void {
    for (const key of Object.keys(this.record)) {
      if (!this.claimed.has(key)) {
        fail(this.at(key), "unknown property");
      }
    }
  }
}

function readSource(value: unknown, path: string): SidecarSource {
  const reader = Reader.of(value, path);
  const source: SidecarSource = {
    fileName: reader.required("fileName", string),
    sha256: reader.required("sha256", pattern(SHA256, "a lowercase hex SHA-256")),
    byteLength: reader.required("byteLength", integer(0)),
    pageCount: reader.required("pageCount", integer(0)),
  };
  setIfDefined(source, "title", reader.optional("title", string));
  setIfDefined(source, "encrypted", reader.optional("encrypted", boolean));
  setIfDefined(source, "lastEmbeddedAt", reader.optional("lastEmbeddedAt", dateTime));
  setIfDefined(source, "pdfWrite", reader.optional("pdfWrite", oneOf(PDF_WRITE)));
  reader.done();
  return source;
}

function readCategory(value: unknown, path: string): SidecarCategory {
  const reader = Reader.of(value, path);
  const category: SidecarCategory = {
    id: reader.required("id", pattern(CATEGORY_ID, "lowercase letters, digits or dashes")),
    name: reader.required("name", string),
    color: reader.required("color", pattern(COLOR, "#RRGGBB in uppercase")),
    order: reader.required("order", integer(0)),
  };
  if (category.name.trim() === "") {
    fail(reader.at("name"), "must not be empty");
  }
  setIfDefined(category, "description", reader.optional("description", string));
  reader.done();
  return category;
}

function readContext(value: unknown, path: string): HighlightContext {
  const reader = Reader.of(value, path);
  const context: HighlightContext = {};
  setIfDefined(context, "before", reader.optional("before", string));
  setIfDefined(context, "after", reader.optional("after", string));
  reader.done();
  return context;
}

function readRect(value: unknown, path: string): Rect {
  const rect = toRect(numbers(value, path));
  if (!rect) {
    fail(path, "expected 4 numbers");
  }
  return rect;
}

function readHighlight(value: unknown, path: string): SidecarHighlight {
  const reader = Reader.of(value, path);
  const quadPoints = reader.required("quadPoints", numbers);
  if (quadPoints.length % 8 !== 0) {
    fail(reader.at("quadPoints"), "expected groups of 8 numbers");
  }
  const highlight: SidecarHighlight = {
    id: reader.required("id", pattern(UUID_PATTERN, "a UUID")),
    categoryId: reader.required("categoryId", string),
    page: reader.required("page", integer(1)),
    rect: reader.required("rect", readRect),
    quadPoints,
    kind: reader.required("kind", oneOf(KINDS)),
    text: reader.required("text", string),
    note: reader.required("note", string),
    createdAt: reader.required("createdAt", dateTime),
    updatedAt: reader.required("updatedAt", dateTime),
  };
  setIfDefined(highlight, "pageLabel", reader.optional("pageLabel", string));
  setIfDefined(
    highlight,
    "pdfjsId",
    reader.optional("pdfjsId", pattern(PDFJS_ID, "a PDF.js annotation id such as 12R")),
  );
  if (reader.has("outlines")) {
    highlight.outlines = reader.raw("outlines");
  }
  setIfDefined(highlight, "rotation", reader.optional("rotation", integer()));
  setIfDefined(highlight, "context", reader.optional("context", readContext));
  reader.done();
  return highlight;
}

function readPageNote(value: unknown, path: string): PageNote {
  const reader = Reader.of(value, path);
  const pageNote: PageNote = {
    page: reader.required("page", integer(1)),
    note: reader.required("note", string),
    createdAt: reader.required("createdAt", dateTime),
    updatedAt: reader.required("updatedAt", dateTime),
  };
  reader.done();
  return pageNote;
}

function readDocumentNote(value: unknown, path: string): DocumentNote {
  const reader = Reader.of(value, path);
  const documentNote: DocumentNote = {
    id: reader.required("id", string),
    title: reader.required("title", string),
    note: reader.required("note", string),
    createdAt: reader.required("createdAt", dateTime),
    updatedAt: reader.required("updatedAt", dateTime),
  };
  reader.done();
  return documentNote;
}

function readAiConsent(value: unknown, path: string): AiConsent {
  const reader = Reader.of(value, path);
  const consent: AiConsent = {
    provider: reader.required("provider", string),
    email: reader.required("email", string),
    verified: reader.required("verified", boolean),
    documentSha256: reader.required("documentSha256", string),
    attestedAt: reader.required("attestedAt", dateTime),
    responsibilityAcknowledged: reader.required("responsibilityAcknowledged", boolean),
  };
  setIfDefined(consent, "accountId", reader.optional("accountId", string));
  setIfDefined(consent, "organization", reader.optional("organization", string));
  setIfDefined(consent, "authorizationLine", reader.optional("authorizationLine", string));
  setIfDefined(consent, "eligibilityConfirmed", reader.optional("eligibilityConfirmed", boolean));
  setIfDefined(consent, "wordingVersion", reader.optional("wordingVersion", integer()));
  reader.done();
  return consent;
}

function readAiSummary(value: unknown, path: string): AiSummary {
  const reader = Reader.of(value, path);
  const summary: AiSummary = {
    provider: reader.required("provider", string),
    generatedAt: reader.required("generatedAt", dateTime),
    text: reader.required("text", string),
  };
  setIfDefined(summary, "model", reader.optional("model", string));
  setIfDefined(summary, "account", reader.optional("account", string));
  setIfDefined(summary, "inputDigest", reader.optional("inputDigest", string));
  setIfDefined(summary, "promptVersion", reader.optional("promptVersion", integer(1)));
  reader.done();
  return summary;
}

/** Validates already-migrated JSON (see `migrateSidecar`) and returns the typed sidecar. */
export function validateSidecar(raw: unknown): Sidecar {
  const reader = Reader.of(raw, "");
  const version = reader.required("version", (value) => value);
  if (version !== SIDECAR_VERSION) {
    fail("version", `expected ${SIDECAR_VERSION} (run migrateSidecar first)`);
  }
  const categories = reader.required("categories", arrayOf(readCategory));
  for (const error of validateCategories(categories)) {
    fail(at("categories", error.index), error.message);
  }
  const highlights = reader.required("highlights", arrayOf(readHighlight));
  const seenIds = new Set<string>();
  highlights.forEach((highlight, index) => {
    if (seenIds.has(highlight.id)) {
      fail(at(at("highlights", index), "id"), `duplicate id ${highlight.id}`);
    }
    seenIds.add(highlight.id);
  });
  const sidecar: Sidecar = {
    version: SIDECAR_VERSION,
    source: reader.required("source", readSource),
    categories,
    highlights,
  };
  setIfDefined(sidecar, "$schema", reader.optional("$schema", string));
  setIfDefined(sidecar, "generator", reader.optional("generator", string));
  setIfDefined(sidecar, "pageNotes", reader.optional("pageNotes", arrayOf(readPageNote)));
  setIfDefined(sidecar, "documentNotes", reader.optional("documentNotes", arrayOf(readDocumentNote)));
  setIfDefined(sidecar, "aiConsent", reader.optional("aiConsent", readAiConsent));
  setIfDefined(sidecar, "aiSummary", reader.optional("aiSummary", readAiSummary));
  reader.done();
  return sidecar;
}

/** Parses sidecar text of the current version. Callers with older files run `migrateSidecar` first. */
export function parseSidecar(text: string): Sidecar {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail("", `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateSidecar(raw);
}
