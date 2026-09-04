// The "document text" AI context scope (issue #22, v1): extracted text across the document,
// chunked per page with citations, with honest coverage numbers for the consent dialog and the
// prompt. Always called "Document text", never "Full PDF": extraction misses scans, image-only
// exhibits and broken reading orders, and the PDF file itself is never sent.

import { formatCitation } from "../report/model";
import { normalizeWhitespace } from "../text/normalize";

export { AI_CONTEXT_SCOPES, type AiContextScope } from "./contextScope";

export interface DocumentTextPage {
  page: number;
  pageLabel?: string;
  /** null = the viewer could not provide text (closed, timeout, or an image-only page). */
  text: string | null;
}

/** Size budget for the document-text section; pages beyond it are dropped with an explicit note. */
export const DOCUMENT_TEXT_MAX_CHARS = 400_000;

export interface DocumentTextResult {
  /** The prompt section: a coverage preamble, then per-page chunks with citations. */
  section: string;
  pagesWithText: number;
  pageCount: number;
  words: number;
  /** Set when the size budget cut the section short; the section itself says so too. */
  truncatedAfterPage?: number;
}

export function coverageLine(result: Pick<DocumentTextResult, "pagesWithText" | "pageCount" | "words">) {
  return `text extracted from ${result.pagesWithText} of ${result.pageCount} page(s), about ${result.words} words`;
}

export function buildDocumentText(
  pages: readonly DocumentTextPage[],
  maxChars: number = DOCUMENT_TEXT_MAX_CHARS,
): DocumentTextResult {
  const chunks: string[] = [];
  let pagesWithText = 0;
  let words = 0;
  let used = 0;
  let lastIncludedPage = 0;
  let truncatedAfterPage: number | undefined;
  for (const page of pages) {
    const text = normalizeWhitespace(page.text ?? "");
    if (text === "") {
      continue;
    }
    const chunk = `--- ${formatCitation(page.page, page.pageLabel, true)} ---\n${text}`;
    if (used + chunk.length > maxChars) {
      truncatedAfterPage = lastIncludedPage;
      chunks.push(
        `[Truncated: the document text exceeded the size budget after page ${truncatedAfterPage}; later pages are not included.]`,
      );
      break;
    }
    chunks.push(chunk);
    used += chunk.length;
    lastIncludedPage = page.page;
    pagesWithText += 1;
    words += text.split(" ").length;
  }
  const coverage = { pagesWithText, pageCount: pages.length, words };
  const header =
    `Document text (${coverageLine(coverage)}; image-only pages and scans are not included; ` +
    "page markers give the citation):";
  const result: DocumentTextResult = {
    section: `${header}\n\n${chunks.join("\n\n")}`,
    ...coverage,
  };
  if (truncatedAfterPage !== undefined) {
    result.truncatedAfterPage = truncatedAfterPage;
  }
  return result;
}
