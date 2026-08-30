import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import { migrateSidecar } from "../../src/core/sidecar/migrate";
import { serializeSidecar } from "../../src/core/sidecar/serialize";
import { emptySidecar } from "../../src/core/sidecar/types";
import { parseSidecar, SidecarError, validateSidecar } from "../../src/core/sidecar/validate";
import { SAMPLE_SHA256, sampleSidecar } from "./helpers/sampleSidecar";

type Json = Record<string, unknown>;

/** The sample as raw JSON, with `edit` applied, ready for `validateSidecar`. */
function edited(edit: (raw: Json) => void): Json {
  const raw = JSON.parse(serializeSidecar(sampleSidecar())) as Json;
  edit(raw);
  return raw;
}

function child(raw: Json, key: string): Json {
  return raw[key] as Json;
}

function item(raw: Json, key: string, index: number): Json {
  return (raw[key] as Json[])[index] as Json;
}

function rejects(raw: unknown, pattern: RegExp): void {
  expect(() => validateSidecar(raw)).toThrowError(SidecarError);
  expect(() => validateSidecar(raw)).toThrowError(pattern);
}

describe("parseSidecar", () => {
  it("accepts the sample and returns the typed model", () => {
    const parsed = parseSidecar(serializeSidecar(sampleSidecar()));
    expect(parsed.version).toBe(1);
    expect(parsed.source.pdfWrite).toBe("synced");
    expect(parsed.categories).toHaveLength(5);
    expect(parsed.highlights.find((entry) => entry.pdfjsId === "12R")?.categoryId).toBe("financial");
    expect(parsed.pageNotes?.[0]?.page).toBe(3);
    expect(parsed.documentNotes?.[0]?.id).toBe("thesis");
  });

  it("accepts an empty sidecar", () => {
    const sidecar = emptySidecar(
      { fileName: "case.pdf", sha256: SAMPLE_SHA256, byteLength: 10, pageCount: 1 },
      DEFAULT_CATEGORIES,
      "pdf-case-review/0.1.0",
    );
    expect(parseSidecar(serializeSidecar(sidecar))).toEqual(sidecar);
  });

  it("rejects invalid JSON with a SidecarError", () => {
    expect(() => parseSidecar("{ nope")).toThrowError(/invalid JSON/);
  });
});

describe("validateSidecar", () => {
  it("rejects unknown properties at every level, naming the path", () => {
    rejects(
      edited((raw) => {
        raw["extra"] = 1;
      }),
      /^extra: unknown property$/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["color"] = "#FFFFFF";
      }),
      /^highlights\[0\]\.color: unknown property$/,
    );
  });

  it("rejects missing required properties", () => {
    rejects(
      edited((raw) => {
        Reflect.deleteProperty(item(raw, "highlights", 1), "note");
      }),
      /highlights\[1\]\.note: missing required property/,
    );
    rejects(
      edited((raw) => {
        Reflect.deleteProperty(raw, "source");
      }),
      /^source: missing required property$/,
    );
  });

  it("rejects the wrong version", () => {
    rejects(
      edited((raw) => {
        raw["version"] = 2;
      }),
      /version: expected 1/,
    );
  });

  it("rejects malformed values with the schema's patterns", () => {
    rejects(
      edited((raw) => {
        item(raw, "categories", 0)["color"] = "#ffff98";
      }),
      /categories\[0\]\.color: expected #RRGGBB in uppercase/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["id"] = "not-a-uuid";
      }),
      /highlights\[0\]\.id: expected a UUID/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["pdfjsId"] = "twelve";
      }),
      /highlights\[0\]\.pdfjsId: expected a PDF.js annotation id/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["page"] = 0;
      }),
      /highlights\[0\]\.page: expected an integer >= 1/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["rect"] = [1, 2, 3];
      }),
      /highlights\[0\]\.rect: expected 4 numbers/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["quadPoints"] = [1, 2, 3, 4, 5, 6, 7];
      }),
      /highlights\[0\]\.quadPoints: expected groups of 8 numbers/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["kind"] = "ink";
      }),
      /highlights\[0\]\.kind: expected one of text, free/,
    );
    rejects(
      edited((raw) => {
        item(raw, "highlights", 0)["createdAt"] = "yesterday";
      }),
      /highlights\[0\]\.createdAt: expected an ISO 8601 date-time/,
    );
    rejects(
      edited((raw) => {
        child(raw, "source")["sha256"] = "ABC";
      }),
      /source\.sha256: expected a lowercase hex SHA-256/,
    );
    rejects(
      edited((raw) => {
        child(raw, "source")["pdfWrite"] = "maybe";
      }),
      /source\.pdfWrite: expected one of synced, skipped-protected, skipped-setting, failed/,
    );
  });

  it("rejects duplicate highlight ids and category collisions", () => {
    rejects(
      edited((raw) => {
        item(raw, "highlights", 1)["id"] = item(raw, "highlights", 0)["id"];
      }),
      /highlights\[1\]\.id: duplicate id/,
    );
    rejects(
      edited((raw) => {
        item(raw, "categories", 1)["color"] = item(raw, "categories", 0)["color"];
      }),
      /categories\[1\]: duplicate color/,
    );
    rejects(
      edited((raw) => {
        item(raw, "categories", 1)["id"] = item(raw, "categories", 0)["id"];
      }),
      /categories\[1\]: duplicate id/,
    );
  });

  it("keeps outlines opaque and context optional", () => {
    const parsed = validateSidecar(
      edited((raw) => {
        item(raw, "highlights", 0)["outlines"] = { points: [[1, 2]] };
        item(raw, "highlights", 0)["context"] = { before: "…the " };
      }),
    );
    const highlight = parsed.highlights[0];
    expect(highlight?.outlines).toEqual({ points: [[1, 2]] });
    expect(highlight?.context).toEqual({ before: "…the " });
  });
});

describe("migrateSidecar", () => {
  it("passes a current-version file through untouched", () => {
    const raw: unknown = JSON.parse(serializeSidecar(sampleSidecar()));
    const result = migrateSidecar(raw);
    expect(result.migrated).toBe(false);
    expect(result.fromVersion).toBe(1);
    expect(result.value).toBe(raw);
  });

  it("refuses files newer than this build", () => {
    expect(() => migrateSidecar({ version: 2 })).toThrowError(/newer than this extension supports/);
  });

  it("refuses versions without a migration path", () => {
    expect(() => migrateSidecar({ version: 0 })).toThrowError(/no migration from version 0/);
    expect(() => migrateSidecar({ version: "1" })).toThrowError(/version: expected an integer/);
    expect(() => migrateSidecar([])).toThrowError(/expected an object/);
  });
});
