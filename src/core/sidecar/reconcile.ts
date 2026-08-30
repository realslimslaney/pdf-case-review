// Maps what the viewer reports (a full snapshot of PDF.js highlight editors) onto the sidecar
// model. Pure and deterministic so the id bookkeeping is unit-tested; the host feeds it every
// `editorsChanged` message.
//
// Three id spaces (ADR-0004): the sidecar uuid (forever), the PDF.js annotation id `<n>R`
// (`pdfjsId`, until the next embed), and the viewer id (`annotationElementId ?? editor.id`, one
// viewer load). Only the session below knows viewer ids; the host resets it on every load.

import type { SerializedHighlight } from "../../shared/protocol";
import { type Category, categoryForColor } from "../categories";
import { normalizeCapturedText } from "../text/normalize";
import type { SidecarHighlight } from "./types";

export const UNCATEGORIZED_ID = "uncategorized";
const RECENTLY_DELETED_LIMIT = 200;

export interface ViewerSnapshot {
  editors: readonly SerializedHighlight[];
  /** Viewer ids of file-backed editors whose `serialize()` returned null (unchanged). */
  existingUnchanged: readonly string[];
  /** Annotation ids PDF.js reports as deleted from the file. */
  deletedAnnotationIds: readonly string[];
}

export interface ReconcileContext {
  categories: readonly Category[];
  /** ISO 8601 timestamp for `createdAt` / `updatedAt`. */
  now: () => string;
  newId: () => string;
  /** Page labels by page index, when the document defines them. */
  pageLabels?: readonly string[] | null;
}

export interface ReconcileResult {
  highlights: SidecarHighlight[];
  created: string[];
  updated: string[];
  deleted: string[];
  restored: string[];
  /** Viewer ids of file-backed editors the sidecar does not know (foreign annotations), left alone. */
  ignored: string[];
  changed: boolean;
}

/** Per-viewer-load bookkeeping, owned by the host and never persisted. */
export class ReconcileSession {
  private readonly uuidByViewerId = new Map<string, string>();
  private readonly viewerIdByUuid = new Map<string, string>();
  /** Viewer ids that belong to file-backed editors (PDF.js drops those whenever it leaves edit mode). */
  private readonly fileBackedViewerIds = new Set<string>();
  /** Deleted highlights keyed by viewer id: an undo re-adds the same editor, so its id comes back. */
  private readonly tombstones = new Map<string, SidecarHighlight>();

  uuidFor(viewerId: string): string | undefined {
    return this.uuidByViewerId.get(viewerId);
  }

  viewerIdFor(uuid: string): string | undefined {
    return this.viewerIdByUuid.get(uuid);
  }

  isFileBacked(viewerId: string): boolean {
    return this.fileBackedViewerIds.has(viewerId);
  }

  /**
   * Binds a viewer id to a highlight. `fileBacked` says whether the editor backs an annotation in
   * the file (`annotationElementId` set); it decides whether absence from a snapshot means deleted.
   * Also used after an embed to alias the annotation ids the current load still uses.
   */
  bind(viewerId: string, uuid: string, fileBacked: boolean): void {
    const previous = this.viewerIdByUuid.get(uuid);
    if (previous !== undefined && previous !== viewerId) {
      this.uuidByViewerId.delete(previous);
      this.fileBackedViewerIds.delete(previous);
    }
    this.uuidByViewerId.set(viewerId, uuid);
    this.viewerIdByUuid.set(uuid, viewerId);
    if (fileBacked) {
      this.fileBackedViewerIds.add(viewerId);
    } else {
      this.fileBackedViewerIds.delete(viewerId);
    }
  }

  unbind(uuid: string): void {
    const viewerId = this.viewerIdByUuid.get(uuid);
    if (viewerId !== undefined) {
      this.uuidByViewerId.delete(viewerId);
      this.viewerIdByUuid.delete(uuid);
      this.fileBackedViewerIds.delete(viewerId);
    }
  }

  bury(viewerId: string, highlight: SidecarHighlight): void {
    this.tombstones.delete(viewerId);
    this.tombstones.set(viewerId, highlight);
    while (this.tombstones.size > RECENTLY_DELETED_LIMIT) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.tombstones.delete(oldest);
    }
  }

  exhume(viewerId: string): SidecarHighlight | undefined {
    const highlight = this.tombstones.get(viewerId);
    if (highlight) {
      this.tombstones.delete(viewerId);
    }
    return highlight;
  }

  exhumeById(uuid: string): SidecarHighlight | undefined {
    for (const [viewerId, highlight] of this.tombstones) {
      if (highlight.id === uuid) {
        this.tombstones.delete(viewerId);
        return highlight;
      }
    }
    return undefined;
  }

  get tombstoneCount(): number {
    return this.tombstones.size;
  }

  /** Editor ids do not survive a viewer load; call this when the viewer reports `viewerLoaded`. */
  reset(): void {
    this.uuidByViewerId.clear();
    this.viewerIdByUuid.clear();
    this.fileBackedViewerIds.clear();
    this.tombstones.clear();
  }
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toRect(values: readonly number[]): [number, number, number, number] | undefined {
  const [x1, y1, x2, y2] = values;
  if (values.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }
  return [x1, y1, x2, y2];
}

/** The editor's own text first, then the quad-intersection fallback, normalized either way. */
function capturedText(editor: SerializedHighlight): string {
  return normalizeCapturedText(editor.text ?? editor.quadText ?? "");
}

function pageLabelFor(context: ReconcileContext, pageIndex: number): string | undefined {
  return context.pageLabels?.[pageIndex];
}

function createHighlight(
  id: string,
  editor: SerializedHighlight,
  context: ReconcileContext,
): SidecarHighlight {
  const now = context.now();
  const category = categoryForColor(context.categories, editor.color);
  const highlight: SidecarHighlight = {
    id,
    categoryId: category?.id ?? UNCATEGORIZED_ID,
    page: editor.pageIndex + 1,
    rect: toRect(editor.rect) ?? [0, 0, 0, 0],
    quadPoints: [...editor.quadPoints],
    kind: editor.quadPoints.length > 0 ? "text" : "free",
    text: capturedText(editor),
    note: "",
    createdAt: now,
    updatedAt: now,
  };
  const pageLabel = pageLabelFor(context, editor.pageIndex);
  if (pageLabel !== undefined) {
    highlight.pageLabel = pageLabel;
  }
  if (editor.annotationElementId) {
    highlight.pdfjsId = editor.annotationElementId;
  }
  if (editor.rotation !== 0) {
    highlight.rotation = editor.rotation;
  }
  const outlines = editor.raw["outlines"];
  if (outlines !== undefined) {
    highlight.outlines = outlines;
  }
  return highlight;
}

/**
 * Applies the editor's current state to a known highlight. Returns the same object when nothing
 * changed; `updatedAt` moves only for user-visible edits (category, geometry), not for derived
 * data such as `pdfjsId`, a filled-in page label or late-arriving text.
 */
function withEditorState(
  current: SidecarHighlight,
  editor: SerializedHighlight,
  context: ReconcileContext,
): SidecarHighlight {
  const changes: Partial<SidecarHighlight> = {};
  let edited = false;
  const category = categoryForColor(context.categories, editor.color);
  if (category && category.id !== current.categoryId) {
    changes.categoryId = category.id;
    edited = true;
  }
  const rect = toRect(editor.rect);
  if (rect && !sameNumbers(rect, current.rect)) {
    changes.rect = rect;
    edited = true;
  }
  if (!sameNumbers(editor.quadPoints, current.quadPoints)) {
    changes.quadPoints = [...editor.quadPoints];
    edited = true;
  }
  if (editor.rotation !== (current.rotation ?? 0)) {
    changes.rotation = editor.rotation;
    edited = true;
  }
  const outlines = editor.raw["outlines"];
  if (outlines !== undefined && JSON.stringify(outlines) !== JSON.stringify(current.outlines)) {
    changes.outlines = outlines;
    edited = true;
  }
  if (current.text === "") {
    const text = capturedText(editor);
    if (text !== "") {
      changes.text = text;
    }
  }
  const pageLabel = pageLabelFor(context, editor.pageIndex);
  if (current.pageLabel === undefined && pageLabel !== undefined) {
    changes.pageLabel = pageLabel;
  }
  if (editor.annotationElementId && editor.annotationElementId !== current.pdfjsId) {
    changes.pdfjsId = editor.annotationElementId;
  }
  if (Object.keys(changes).length === 0) {
    return current;
  }
  return edited ? { ...current, ...changes, updatedAt: context.now() } : { ...current, ...changes };
}

/**
 * Reconciles the sidecar highlights with a viewer snapshot. Mutates `session`; returns a new
 * highlight list (unchanged entries keep their object identity).
 *
 * Resolution order for each editor: an existing session binding, the `sidecarId` the host gave the
 * editor, a model highlight with the same `pdfjsId`, a tombstone from a recent delete (undo), else
 * a new highlight. Deletion must be proven: an editor the viewer created vanished from the
 * snapshot, or PDF.js reports a file-backed annotation deleted. Absence alone never deletes a
 * highlight bound to a file-backed editor, because PDF.js drops those whenever it leaves
 * highlight mode; and highlights never materialized in the viewer are kept as they are.
 */
export function reconcileSnapshot(
  highlights: readonly SidecarHighlight[],
  snapshot: ViewerSnapshot,
  session: ReconcileSession,
  context: ReconcileContext,
): ReconcileResult {
  const result = new Map(highlights.map((highlight) => [highlight.id, highlight]));
  const uuidByPdfjsId = new Map<string, string>();
  for (const highlight of highlights) {
    if (highlight.pdfjsId !== undefined) {
      uuidByPdfjsId.set(highlight.pdfjsId, highlight.id);
    }
  }
  const seen = new Set<string>();
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const restored: string[] = [];
  const ignored: string[] = [];

  for (const editor of snapshot.editors) {
    const viewerId = editor.id;
    seen.add(viewerId);
    const known =
      session.uuidFor(viewerId) ??
      editor.sidecarId ??
      (editor.annotationElementId ? uuidByPdfjsId.get(editor.annotationElementId) : undefined);
    const fileBacked = editor.annotationElementId !== null;
    const current = known === undefined ? undefined : result.get(known);
    if (known !== undefined && current !== undefined) {
      const next = withEditorState(current, editor, context);
      if (next !== current) {
        result.set(known, next);
        updated.push(known);
      }
      session.bind(viewerId, known, fileBacked);
      continue;
    }
    const tombstone =
      session.exhume(viewerId) ?? (known === undefined ? undefined : session.exhumeById(known));
    if (tombstone) {
      result.set(tombstone.id, withEditorState(tombstone, editor, context));
      restored.push(tombstone.id);
      session.bind(viewerId, tombstone.id, fileBacked);
      continue;
    }
    if (fileBacked && known === undefined) {
      ignored.push(viewerId);
      continue;
    }
    const id = known ?? context.newId();
    result.set(id, createHighlight(id, editor, context));
    created.push(id);
    session.bind(viewerId, id, fileBacked);
  }

  for (const viewerId of snapshot.existingUnchanged) {
    seen.add(viewerId);
    const tombstone = session.exhume(viewerId);
    if (tombstone) {
      result.set(tombstone.id, tombstone);
      restored.push(tombstone.id);
      session.bind(viewerId, tombstone.id, true);
    } else if (session.uuidFor(viewerId) === undefined) {
      const uuid = uuidByPdfjsId.get(viewerId);
      if (uuid !== undefined) {
        session.bind(viewerId, uuid, true);
      }
    }
  }

  const deletedAnnotations = new Set(snapshot.deletedAnnotationIds);
  for (const highlight of highlights) {
    if (!result.has(highlight.id)) {
      continue;
    }
    const viewerId = session.viewerIdFor(highlight.id);
    const vanished = viewerId !== undefined && !session.isFileBacked(viewerId) && !seen.has(viewerId);
    const deletedInFile =
      (viewerId !== undefined && deletedAnnotations.has(viewerId)) ||
      (highlight.pdfjsId !== undefined && deletedAnnotations.has(highlight.pdfjsId));
    if (vanished || deletedInFile) {
      result.delete(highlight.id);
      deleted.push(highlight.id);
      session.bury(viewerId ?? highlight.pdfjsId ?? highlight.id, highlight);
      session.unbind(highlight.id);
    }
  }

  return {
    highlights: [...result.values()],
    created,
    updated,
    deleted,
    restored,
    ignored,
    changed: created.length + updated.length + deleted.length + restored.length > 0,
  };
}
