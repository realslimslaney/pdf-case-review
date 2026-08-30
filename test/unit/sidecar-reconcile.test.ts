import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../../src/core/categories";
import {
  type ReconcileContext,
  ReconcileSession,
  reconcileSnapshot,
  UNCATEGORIZED_ID,
  type ViewerSnapshot,
} from "../../src/core/sidecar/reconcile";
import type { SidecarHighlight } from "../../src/core/sidecar/types";
import type { SerializedHighlight } from "../../src/shared/protocol";

const RECT = [72, 684, 500, 700];
const QUAD = [72, 700, 500, 700, 72, 684, 500, 684];
const FINANCIAL = "#53FFBC";
const CONCERN = "#FF4F5F";
const STRATEGIC = "#80EBFF";

function makeContext(): ReconcileContext {
  let tick = 0;
  let ids = 0;
  return {
    categories: DEFAULT_CATEGORIES,
    now: () => `2026-09-01T14:00:${String(tick++).padStart(2, "0")}.000Z`,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    pageLabels: ["i", "2", "3"],
  };
}

function editor(
  overrides: Partial<SerializedHighlight> & Pick<SerializedHighlight, "id">,
): SerializedHighlight {
  return {
    pageIndex: 0,
    color: FINANCIAL,
    quadPoints: QUAD,
    rect: RECT,
    rotation: 0,
    text: "Gross  mar-\ngin fell",
    annotationElementId: null,
    raw: {},
    ...overrides,
  };
}

function snapshot(editors: SerializedHighlight[], extra: Partial<ViewerSnapshot> = {}): ViewerSnapshot {
  return { editors, existingUnchanged: [], deletedAnnotationIds: [], ...extra };
}

/** A highlight already in the sidecar; with a `pdfjsId` it is also embedded in the PDF. */
function embedded(id: string, pdfjsId?: string, categoryId = "financial"): SidecarHighlight {
  const highlight: SidecarHighlight = {
    id,
    categoryId,
    page: 1,
    rect: [72, 684, 500, 700],
    quadPoints: QUAD,
    kind: "text",
    text: "Gross margin fell",
    note: "embedded note",
    createdAt: "2026-09-01T13:00:00.000Z",
    updatedAt: "2026-09-01T13:00:00.000Z",
  };
  if (pdfjsId !== undefined) {
    highlight.pdfjsId = pdfjsId;
  }
  return highlight;
}

describe("reconcileSnapshot", () => {
  it("creates a highlight for a new editor, mapping color to category and capturing text", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const result = reconcileSnapshot(
      [],
      snapshot([editor({ id: "pdfjs_internal_editor_0" })]),
      session,
      context,
    );
    expect(result.changed).toBe(true);
    expect(result.created).toHaveLength(1);
    const [created] = result.highlights;
    expect(created).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      categoryId: "financial",
      page: 1,
      pageLabel: "i",
      kind: "text",
      text: "Gross margin fell",
      note: "",
      rect: RECT,
      quadPoints: QUAD,
    });
    expect(created?.createdAt).toBe(created?.updatedAt);
    expect(created?.pdfjsId).toBeUndefined();
    expect(session.uuidFor("pdfjs_internal_editor_0")).toBe(created?.id);
  });

  it("keeps identity across snapshots, records a recolor and reports no change when idle", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const first = reconcileSnapshot([], snapshot([editor({ id: "e0" })]), session, context);
    const created = first.highlights[0];
    expect(created).toBeDefined();

    const second = reconcileSnapshot(
      first.highlights,
      snapshot([editor({ id: "e0", color: CONCERN })]),
      session,
      context,
    );
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([created?.id]);
    expect(second.highlights[0]?.categoryId).toBe("concern");
    expect(second.highlights[0]?.createdAt).toBe(created?.createdAt);
    expect(created?.updatedAt).toBe("2026-09-01T14:00:00.000Z");
    expect(second.highlights[0]?.updatedAt).toBe("2026-09-01T14:00:01.000Z");

    const third = reconcileSnapshot(
      second.highlights,
      snapshot([editor({ id: "e0", color: CONCERN })]),
      session,
      context,
    );
    expect(third.changed).toBe(false);
    expect(third.highlights[0]).toBe(second.highlights[0]);
  });

  it("buckets an unknown color as uncategorized and keeps the category on an unknown recolor", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const first = reconcileSnapshot([], snapshot([editor({ id: "e0", color: "#123456" })]), session, context);
    expect(first.highlights[0]?.categoryId).toBe(UNCATEGORIZED_ID);

    const known = first.highlights.map((entry) => ({ ...entry, categoryId: "fact" }));
    const second = reconcileSnapshot(
      known,
      snapshot([editor({ id: "e0", color: "#654321" })]),
      session,
      context,
    );
    expect(second.changed).toBe(false);
    expect(second.highlights[0]?.categoryId).toBe("fact");
  });

  it("stores a free highlight with its outlines", () => {
    const context = makeContext();
    const outlines = { points: [[1, 2, 3, 4]] };
    const result = reconcileSnapshot(
      [],
      snapshot([editor({ id: "e0", quadPoints: [], text: null, raw: { outlines } })]),
      new ReconcileSession(),
      context,
    );
    expect(result.highlights[0]).toMatchObject({ kind: "free", text: "", outlines });
  });

  it("falls back to quad-intersection text and fills text in later", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const first = reconcileSnapshot(
      [],
      snapshot([editor({ id: "e0", text: null, quadText: " from  the\nexhibit " })]),
      session,
      context,
    );
    expect(first.highlights[0]?.text).toBe("from the exhibit");

    const blank = first.highlights.map((entry) => ({ ...entry, text: "" }));
    const second = reconcileSnapshot(
      blank,
      snapshot([editor({ id: "e0", text: "late text" })]),
      session,
      context,
    );
    expect(second.updated).toHaveLength(1);
    expect(second.highlights[0]?.text).toBe("late text");
    expect(second.highlights[0]?.updatedAt).toBe(blank[0]?.updatedAt);
  });

  it("deletes a viewer-created highlight when its editor vanishes and restores it on undo", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const first = reconcileSnapshot([], snapshot([editor({ id: "e0" })]), session, context);
    const annotated = first.highlights.map((entry) => ({ ...entry, note: "keep me" }));

    const gone = reconcileSnapshot(annotated, snapshot([]), session, context);
    expect(gone.deleted).toEqual([annotated[0]?.id]);
    expect(gone.highlights).toEqual([]);
    expect(session.tombstoneCount).toBe(1);

    const back = reconcileSnapshot(gone.highlights, snapshot([editor({ id: "e0" })]), session, context);
    expect(back.restored).toEqual([annotated[0]?.id]);
    expect(back.created).toEqual([]);
    expect(back.highlights[0]).toMatchObject({
      id: annotated[0]?.id,
      note: "keep me",
      createdAt: annotated[0]?.createdAt,
    });
    expect(session.tombstoneCount).toBe(0);
  });

  it("binds a file-backed editor through pdfjsId and records its edits", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const model = [embedded("8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d", "12R")];
    const result = reconcileSnapshot(
      model,
      snapshot([editor({ id: "12R", annotationElementId: "12R", color: STRATEGIC, text: null })]),
      session,
      context,
    );
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([model[0]?.id]);
    expect(result.highlights[0]).toMatchObject({
      categoryId: "strategic",
      note: "embedded note",
      pdfjsId: "12R",
    });
    expect(session.uuidFor("12R")).toBe(model[0]?.id);
  });

  it("ignores file-backed editors the sidecar does not know (foreign annotations)", () => {
    const context = makeContext();
    const result = reconcileSnapshot(
      [],
      snapshot([editor({ id: "99R", annotationElementId: "99R" })]),
      new ReconcileSession(),
      context,
    );
    expect(result.changed).toBe(false);
    expect(result.ignored).toEqual(["99R"]);
    expect(result.highlights).toEqual([]);
  });

  it("never deletes an embedded highlight by absence, only when PDF.js reports the annotation deleted", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const model = [embedded("8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d", "12R")];

    const present = reconcileSnapshot(model, snapshot([], { existingUnchanged: ["12R"] }), session, context);
    expect(present.changed).toBe(false);
    expect(session.uuidFor("12R")).toBe(model[0]?.id);

    const leftEditMode = reconcileSnapshot(present.highlights, snapshot([]), session, context);
    expect(leftEditMode.changed).toBe(false);
    expect(leftEditMode.highlights).toHaveLength(1);

    const deleted = reconcileSnapshot(
      leftEditMode.highlights,
      snapshot([], { deletedAnnotationIds: ["12R"] }),
      session,
      context,
    );
    expect(deleted.deleted).toEqual([model[0]?.id]);
    expect(deleted.highlights).toEqual([]);

    const undone = reconcileSnapshot(
      deleted.highlights,
      snapshot([], { existingUnchanged: ["12R"] }),
      session,
      context,
    );
    expect(undone.restored).toEqual([model[0]?.id]);
    expect(undone.highlights[0]).toEqual(model[0]);
  });

  it("keeps highlights that never materialized in the viewer", () => {
    const context = makeContext();
    const model = [
      embedded("8f6c1b2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d", "12R"),
      embedded("0d3a7c44-9b1e-4e2a-8f3c-5a6b7c8d9e0f"),
    ];
    const result = reconcileSnapshot(model, snapshot([]), new ReconcileSession(), context);
    expect(result.changed).toBe(false);
    expect(result.highlights).toHaveLength(2);
  });

  it("creates with the host-assigned sidecarId when the editor carries one", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    const result = reconcileSnapshot([], snapshot([editor({ id: "e7", sidecarId: id })]), session, context);
    expect(result.created).toEqual([id]);
    expect(session.uuidFor("e7")).toBe(id);
  });

  it("forgets viewer bindings on reset so a reload cannot cause deletions", () => {
    const context = makeContext();
    const session = new ReconcileSession();
    const first = reconcileSnapshot([], snapshot([editor({ id: "e0" })]), session, context);
    session.reset();
    const afterReload = reconcileSnapshot(first.highlights, snapshot([]), session, context);
    expect(afterReload.changed).toBe(false);
    expect(afterReload.highlights).toHaveLength(1);
  });
});
