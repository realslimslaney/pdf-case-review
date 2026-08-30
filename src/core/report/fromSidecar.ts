// Maps the sidecar (the on-disk truth) to the report pipeline's input. Pure; the caller provides
// only what it alone knows: the moment, the author setting, the viewer's live page data.

import { sortDocumentNotes } from "../sidecar/serialize";
import { type Sidecar, sortedCategories } from "../sidecar/types";
import type { ReportAiSummary, ReportHighlightInput, ReportInput, ReportPageNoteInput } from "./model";

export interface ReportInputContext {
  /** ISO timestamp for the title block. */
  generatedAt: string;
  author?: string;
  /** The viewer's page labels (index = page - 1); fills labels the sidecar does not carry. */
  pageLabels?: readonly string[];
  /** The viewer's live page count; the sidecar carries 0 until the first save. */
  pageCount?: number;
  includeAiSummary: boolean;
}

export function reportInputFromSidecar(sidecar: Sidecar, context: ReportInputContext): ReportInput {
  const labelFor = (page: number, stored?: string): string | undefined =>
    stored ?? context.pageLabels?.[page - 1];

  const highlights: ReportHighlightInput[] = sidecar.highlights.map((highlight) => {
    const entry: ReportHighlightInput = {
      id: highlight.id,
      categoryId: highlight.categoryId,
      page: highlight.page,
      top: highlight.rect[3],
      left: highlight.rect[0],
      text: highlight.text,
      note: highlight.note,
    };
    const pageLabel = labelFor(highlight.page, highlight.pageLabel);
    if (pageLabel !== undefined) {
      entry.pageLabel = pageLabel;
    }
    return entry;
  });

  const input: ReportInput = {
    title: sidecar.source.title ?? sidecar.source.fileName.replace(/\.pdf$/i, ""),
    sourceFileName: sidecar.source.fileName,
    pageCount: context.pageCount || sidecar.source.pageCount,
    generatedAt: context.generatedAt,
    categories: sortedCategories(sidecar.categories).map(({ id, name, color }) => ({ id, name, color })),
    highlights,
  };
  const author = context.author?.trim();
  if (author) {
    input.author = author;
  }
  if (sidecar.pageNotes && sidecar.pageNotes.length > 0) {
    input.pageNotes = sidecar.pageNotes.map((note) => {
      const entry: ReportPageNoteInput = { page: note.page, note: note.note };
      const pageLabel = labelFor(note.page);
      if (pageLabel !== undefined) {
        entry.pageLabel = pageLabel;
      }
      return entry;
    });
  }
  if (sidecar.documentNotes && sidecar.documentNotes.length > 0) {
    input.documentNotes = sortDocumentNotes(sidecar.documentNotes).map(({ title, note }) => ({
      title,
      note,
    }));
  }
  if (context.includeAiSummary && sidecar.aiSummary) {
    const summary: ReportAiSummary = {
      provider: sidecar.aiSummary.provider,
      generatedAt: sidecar.aiSummary.generatedAt,
      text: sidecar.aiSummary.text,
    };
    if (sidecar.aiSummary.model !== undefined) {
      summary.model = sidecar.aiSummary.model;
    }
    if (sidecar.aiSummary.account !== undefined) {
      summary.account = sidecar.aiSummary.account;
    }
    if (sidecar.aiConsent && sidecar.aiConsent.documentSha256 === sidecar.source.sha256) {
      // An attestation for an earlier revision of the file must not stamp the report.
      summary.attestedAt = sidecar.aiConsent.attestedAt;
    }
    input.aiSummary = summary;
  }
  return input;
}
