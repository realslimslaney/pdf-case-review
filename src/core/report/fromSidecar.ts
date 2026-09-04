// Maps the sidecar (the on-disk truth) to the report pipeline's input. Pure; the caller provides
// only what it alone knows: the moment, the author setting, the viewer's live page data.

import { summaryInputDigest } from "../ai/digest";
import { PAGE_CONTEXT_PROMPT_VERSION, pageContextInputDigest } from "../ai/pageContext";
import { SUMMARY_PROMPT_VERSION } from "../ai/prompt";
import { sortDocumentNotes } from "../sidecar/serialize";
import { type Sidecar, sortedCategories } from "../sidecar/types";
import type {
  ReportAiSummary,
  ReportHighlightInput,
  ReportInput,
  ReportPageContextInput,
  ReportPageNoteInput,
} from "./model";

export interface ReportInputContext {
  /** ISO timestamp for the title block. */
  generatedAt: string;
  author?: string;
  /** The viewer's page labels (index = page - 1); fills labels the sidecar does not carry. */
  pageLabels?: readonly string[];
  /** The viewer's live page count; the sidecar carries 0 until the first save. */
  pageCount?: number;
  includeAiSummary: boolean;
  /** Current `pdfCaseReview.ai.maxWords`, for the staleness check; defaults to `DEFAULT_MAX_WORDS`. */
  aiMaxWords?: number;
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
      kind: highlight.kind,
      text: highlight.text,
      note: highlight.note,
      createdAt: highlight.createdAt,
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
      const entry: ReportPageNoteInput = { page: note.page, note: note.note, createdAt: note.createdAt };
      const pageLabel = labelFor(note.page);
      if (pageLabel !== undefined) {
        entry.pageLabel = pageLabel;
      }
      return entry;
    });
  }
  if (sidecar.documentNotes && sidecar.documentNotes.length > 0) {
    input.documentNotes = sortDocumentNotes(sidecar.documentNotes).map(({ title, note, createdAt }) => ({
      title,
      note,
      createdAt,
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
    if (sidecar.aiSummary.contextScope === "document-text") {
      summary.contextScope = "document-text";
    }
    const fresh =
      sidecar.aiSummary.promptVersion === SUMMARY_PROMPT_VERSION &&
      sidecar.aiSummary.inputDigest ===
        summaryInputDigest(
          sidecar,
          context.aiMaxWords,
          sidecar.aiSummary.contextScope === "document-text" ? "document-text" : "notes",
        );
    if (sidecar.aiSummary.inputDigest === undefined) {
      summary.unverified = true;
    } else if (!fresh) {
      summary.stale = true;
    }
    input.aiSummary = summary;
  }
  if (context.includeAiSummary && sidecar.aiPageContexts && sidecar.aiPageContexts.length > 0) {
    input.pageContexts = sidecar.aiPageContexts.map((pageContext) => {
      const entry: ReportPageContextInput = {
        page: pageContext.page,
        text: pageContext.text,
        provider: pageContext.provider,
        generatedAt: pageContext.generatedAt,
      };
      const fresh =
        pageContext.promptVersion === PAGE_CONTEXT_PROMPT_VERSION &&
        pageContext.inputDigest === pageContextInputDigest(sidecar, pageContext.page);
      if (pageContext.inputDigest === undefined) {
        entry.unverified = true;
      } else if (!fresh) {
        entry.stale = true;
      }
      if (pageContext.model !== undefined) {
        entry.model = pageContext.model;
      }
      if (pageContext.account !== undefined) {
        entry.account = pageContext.account;
      }
      const pageLabel = labelFor(pageContext.page);
      if (pageLabel !== undefined) {
        entry.pageLabel = pageLabel;
      }
      return entry;
    });
  }
  return input;
}
