// Boundary validation for sidecar files. Everything a hand-edited or foreign file could get wrong
// is reported with its JSON path. Hand-written rather than schema-driven: the schema is small,
// and `contributes.jsonValidation` already gives editor-time feedback from the same schema file.

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

const KEYS = {
  top: [
    "$schema",
    "version",
    "generator",
    "source",
    "categories",
    "highlights",
    "pageNotes",
    "documentNotes",
    "aiConsent",
    "aiSummary",
  ],
  source: [
    "fileName",
    "sha256",
    "byteLength",
    "pageCount",
    "title",
    "encrypted",
    "lastEmbeddedAt",
    "pdfWrite",
  ],
  category: ["id", "name", "color", "order", "description"],
  highlight: [
    "id",
    "categoryId",
    "page",
    "pageLabel",
    "pdfjsId",
    "rect",
    "quadPoints",
    "outlines",
    "rotation",
    "kind",
    "text",
    "context",
    "note",
    "createdAt",
    "updatedAt",
  ],
  context: ["before", "after"],
  pageNote: ["page", "note", "createdAt", "updatedAt"],
  documentNote: ["id", "title", "note", "createdAt", "updatedAt"],
  aiConsent: [
    "accountId",
    "provider",
    "email",
    "organization",
    "verified",
    "documentSha256",
    "authorizationLine",
    "attestedAt",
    "responsibilityAcknowledged",
    "wordingVersion",
  ],
  aiSummary: ["provider", "model", "account", "generatedAt", "text"],
} as const;

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

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail(path, "expected a string");
  }
  return value;
}

function expectPattern(value: unknown, path: string, regex: RegExp, expected: string): string {
  const text = expectString(value, path);
  if (!regex.test(text)) {
    fail(path, `expected ${expected}`);
  }
  return text;
}

function expectInteger(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(path, "expected an integer");
  }
  if (minimum !== undefined && value < minimum) {
    fail(path, `expected an integer >= ${minimum}`);
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a number");
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "expected a boolean");
  }
  return value;
}

function expectDateTime(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (Number.isNaN(Date.parse(text))) {
    fail(path, "expected an ISO 8601 date-time");
  }
  return text;
}

function expectOneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = expectString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return text as T;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }
  return value;
}

/** Typed access to one JSON object, rejecting keys the schema does not list. */
class Reader {
  private constructor(
    private readonly record: JsonObject,
    readonly path: string,
  ) {}

  static of(value: unknown, path: string, allowed: readonly string[]): Reader {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(path, "expected an object");
    }
    const record = value as JsonObject;
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) {
        fail(at(path, key), "unknown property");
      }
    }
    return new Reader(record, path);
  }

  has(key: string): boolean {
    return key in this.record;
  }

  at(key: string): string {
    return at(this.path, key);
  }

  raw(key: string): unknown {
    return this.record[key];
  }

  required(key: string): unknown {
    if (!(key in this.record)) {
      fail(this.at(key), "missing required property");
    }
    return this.record[key];
  }

  string(key: string): string {
    return expectString(this.required(key), this.at(key));
  }

  optionalString(key: string): string | undefined {
    return this.has(key) ? expectString(this.record[key], this.at(key)) : undefined;
  }

  pattern(key: string, regex: RegExp, expected: string): string {
    return expectPattern(this.required(key), this.at(key), regex, expected);
  }

  optionalPattern(key: string, regex: RegExp, expected: string): string | undefined {
    return this.has(key) ? expectPattern(this.record[key], this.at(key), regex, expected) : undefined;
  }

  integer(key: string, minimum?: number): number {
    return expectInteger(this.required(key), this.at(key), minimum);
  }

  optionalInteger(key: string, minimum?: number): number | undefined {
    return this.has(key) ? expectInteger(this.record[key], this.at(key), minimum) : undefined;
  }

  boolean(key: string): boolean {
    return expectBoolean(this.required(key), this.at(key));
  }

  optionalBoolean(key: string): boolean | undefined {
    return this.has(key) ? expectBoolean(this.record[key], this.at(key)) : undefined;
  }

  dateTime(key: string): string {
    return expectDateTime(this.required(key), this.at(key));
  }

  optionalDateTime(key: string): string | undefined {
    return this.has(key) ? expectDateTime(this.record[key], this.at(key)) : undefined;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    return expectOneOf(this.required(key), this.at(key), allowed);
  }

  optionalOneOf<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    return this.has(key) ? expectOneOf(this.record[key], this.at(key), allowed) : undefined;
  }

  array(key: string): unknown[] {
    return expectArray(this.required(key), this.at(key));
  }

  optionalArray(key: string): unknown[] | undefined {
    return this.has(key) ? expectArray(this.record[key], this.at(key)) : undefined;
  }

  numbers(key: string): number[] {
    const path = this.at(key);
    return expectArray(this.required(key), path).map((entry, index) => expectNumber(entry, at(path, index)));
  }
}

function readSource(value: unknown, path: string): SidecarSource {
  const reader = Reader.of(value, path, KEYS.source);
  const source: SidecarSource = {
    fileName: reader.string("fileName"),
    sha256: reader.pattern("sha256", SHA256, "a lowercase hex SHA-256"),
    byteLength: reader.integer("byteLength", 0),
    pageCount: reader.integer("pageCount", 0),
  };
  setIfDefined(source, "title", reader.optionalString("title"));
  setIfDefined(source, "encrypted", reader.optionalBoolean("encrypted"));
  setIfDefined(source, "lastEmbeddedAt", reader.optionalDateTime("lastEmbeddedAt"));
  setIfDefined(source, "pdfWrite", reader.optionalOneOf("pdfWrite", PDF_WRITE));
  return source;
}

function readCategory(value: unknown, path: string): SidecarCategory {
  const reader = Reader.of(value, path, KEYS.category);
  const category: SidecarCategory = {
    id: reader.pattern("id", CATEGORY_ID, "lowercase letters, digits or dashes"),
    name: reader.string("name"),
    color: reader.pattern("color", COLOR, "#RRGGBB in uppercase"),
    order: reader.integer("order", 0),
  };
  if (category.name.trim() === "") {
    fail(reader.at("name"), "must not be empty");
  }
  setIfDefined(category, "description", reader.optionalString("description"));
  return category;
}

function readRect(reader: Reader): Rect {
  const rect = toRect(reader.numbers("rect"));
  if (!rect) {
    fail(reader.at("rect"), "expected 4 numbers");
  }
  return rect;
}

function readContext(value: unknown, path: string): HighlightContext {
  const reader = Reader.of(value, path, KEYS.context);
  const context: HighlightContext = {};
  setIfDefined(context, "before", reader.optionalString("before"));
  setIfDefined(context, "after", reader.optionalString("after"));
  return context;
}

function readHighlight(value: unknown, path: string): SidecarHighlight {
  const reader = Reader.of(value, path, KEYS.highlight);
  const quadPoints = reader.numbers("quadPoints");
  if (quadPoints.length % 8 !== 0) {
    fail(reader.at("quadPoints"), "expected groups of 8 numbers");
  }
  const highlight: SidecarHighlight = {
    id: reader.pattern("id", UUID_PATTERN, "a UUID"),
    categoryId: reader.string("categoryId"),
    page: reader.integer("page", 1),
    rect: readRect(reader),
    quadPoints,
    kind: reader.oneOf("kind", KINDS),
    text: reader.string("text"),
    note: reader.string("note"),
    createdAt: reader.dateTime("createdAt"),
    updatedAt: reader.dateTime("updatedAt"),
  };
  setIfDefined(highlight, "pageLabel", reader.optionalString("pageLabel"));
  setIfDefined(
    highlight,
    "pdfjsId",
    reader.optionalPattern("pdfjsId", PDFJS_ID, "a PDF.js annotation id such as 12R"),
  );
  if (reader.has("outlines")) {
    highlight.outlines = reader.raw("outlines");
  }
  setIfDefined(highlight, "rotation", reader.optionalInteger("rotation"));
  if (reader.has("context")) {
    highlight.context = readContext(reader.raw("context"), reader.at("context"));
  }
  return highlight;
}

function readPageNote(value: unknown, path: string): PageNote {
  const reader = Reader.of(value, path, KEYS.pageNote);
  return {
    page: reader.integer("page", 1),
    note: reader.string("note"),
    createdAt: reader.dateTime("createdAt"),
    updatedAt: reader.dateTime("updatedAt"),
  };
}

function readDocumentNote(value: unknown, path: string): DocumentNote {
  const reader = Reader.of(value, path, KEYS.documentNote);
  return {
    id: reader.string("id"),
    title: reader.string("title"),
    note: reader.string("note"),
    createdAt: reader.dateTime("createdAt"),
    updatedAt: reader.dateTime("updatedAt"),
  };
}

function readAiConsent(value: unknown, path: string): AiConsent {
  const reader = Reader.of(value, path, KEYS.aiConsent);
  const consent: AiConsent = {
    provider: reader.string("provider"),
    email: reader.string("email"),
    verified: reader.boolean("verified"),
    documentSha256: reader.string("documentSha256"),
    attestedAt: reader.dateTime("attestedAt"),
    responsibilityAcknowledged: reader.boolean("responsibilityAcknowledged"),
  };
  setIfDefined(consent, "accountId", reader.optionalString("accountId"));
  setIfDefined(consent, "organization", reader.optionalString("organization"));
  setIfDefined(consent, "authorizationLine", reader.optionalString("authorizationLine"));
  setIfDefined(consent, "wordingVersion", reader.optionalInteger("wordingVersion"));
  return consent;
}

function readAiSummary(value: unknown, path: string): AiSummary {
  const reader = Reader.of(value, path, KEYS.aiSummary);
  const summary: AiSummary = {
    provider: reader.string("provider"),
    generatedAt: reader.dateTime("generatedAt"),
    text: reader.string("text"),
  };
  setIfDefined(summary, "model", reader.optionalString("model"));
  setIfDefined(summary, "account", reader.optionalString("account"));
  return summary;
}

/** Validates already-migrated JSON (see `migrateSidecar`) and returns the typed sidecar. */
export function validateSidecar(raw: unknown): Sidecar {
  const reader = Reader.of(raw, "", KEYS.top);
  if (reader.required("version") !== SIDECAR_VERSION) {
    fail("version", `expected ${SIDECAR_VERSION} (run migrateSidecar first)`);
  }
  const categories = reader
    .array("categories")
    .map((entry, index) => readCategory(entry, at("categories", index)));
  for (const error of validateCategories(categories)) {
    fail(at("categories", error.index), error.message);
  }
  const highlights = reader
    .array("highlights")
    .map((entry, index) => readHighlight(entry, at("highlights", index)));
  const seenIds = new Set<string>();
  highlights.forEach((highlight, index) => {
    if (seenIds.has(highlight.id)) {
      fail(at(at("highlights", index), "id"), `duplicate id ${highlight.id}`);
    }
    seenIds.add(highlight.id);
  });
  const sidecar: Sidecar = {
    version: SIDECAR_VERSION,
    source: readSource(reader.required("source"), "source"),
    categories,
    highlights,
  };
  setIfDefined(sidecar, "$schema", reader.optionalString("$schema"));
  setIfDefined(sidecar, "generator", reader.optionalString("generator"));
  setIfDefined(
    sidecar,
    "pageNotes",
    reader.optionalArray("pageNotes")?.map((entry, index) => readPageNote(entry, at("pageNotes", index))),
  );
  setIfDefined(
    sidecar,
    "documentNotes",
    reader
      .optionalArray("documentNotes")
      ?.map((entry, index) => readDocumentNote(entry, at("documentNotes", index))),
  );
  if (reader.has("aiConsent")) {
    sidecar.aiConsent = readAiConsent(reader.raw("aiConsent"), "aiConsent");
  }
  if (reader.has("aiSummary")) {
    sidecar.aiSummary = readAiSummary(reader.raw("aiSummary"), "aiSummary");
  }
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
