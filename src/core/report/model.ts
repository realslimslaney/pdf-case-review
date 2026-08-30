// The report model: everything the renderers need, computed once from the sidecar data.
// Pure module: no vscode, DOM or Node. Layout decisions live in layout.ts; this file only
// organizes and formats.

export interface ReportCategory {
  id: string;
  name: string;
  /** `#RRGGBB` */
  color: string;
}

export interface ReportHighlightInput {
  id: string;
  categoryId: string;
  /** 1-based page index. */
  page: number;
  pageLabel?: string;
  /** Top edge in PDF user space; higher = earlier on the page. Used only for ordering. */
  top?: number;
  left?: number;
  text: string;
  note: string;
}

export interface ReportPageNoteInput {
  page: number;
  pageLabel?: string;
  note: string;
}

export interface ReportDocumentNoteInput {
  title: string;
  note: string;
}

export interface ReportAiSummary {
  provider: string;
  model?: string;
  account?: string;
  generatedAt: string;
  text: string;
  attestedAt?: string;
}

export interface ReportInput {
  title: string;
  sourceFileName: string;
  pageCount: number;
  author?: string;
  generatedAt: string;
  categories: ReportCategory[];
  highlights: ReportHighlightInput[];
  pageNotes?: ReportPageNoteInput[];
  documentNotes?: ReportDocumentNoteInput[];
  aiSummary?: ReportAiSummary;
}

export interface ReportOptions {
  organization: "category" | "page" | "both";
  /** 0 = unlimited. */
  quoteMaxChars: number;
  includeEmptyCategories: boolean;
  usePageLabels: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  organization: "both",
  quoteMaxChars: 300,
  includeEmptyCategories: false,
  usePageLabels: true,
};

export interface ReportItem {
  id: string;
  category: ReportCategory;
  page: number;
  /** e.g. `p. 12` or `p. iv [4]`. */
  citation: string;
  quote: string;
  note: string;
}

export interface CategorySection {
  category: ReportCategory;
  items: ReportItem[];
}

export interface PageSection {
  page: number;
  heading: string;
  pageNote: string | null;
  items: ReportItem[];
}

export interface SummaryRow {
  category: ReportCategory;
  count: number;
  withNotes: number;
  pages: string;
}

export interface ReportModel {
  title: string;
  meta: {
    sourceFileName: string;
    pageCount: number;
    author: string | null;
    generatedAt: string;
    highlightCount: number;
    noteCount: number;
  };
  options: ReportOptions;
  aiSummary: ReportAiSummary | null;
  summary: SummaryRow[];
  documentNotes: ReportDocumentNoteInput[];
  byCategory: CategorySection[];
  byPage: PageSection[];
  uncategorized: ReportItem[];
}

const UNCATEGORIZED: ReportCategory = { id: "uncategorized", name: "Uncategorized", color: "#CCCCCC" };

/** Collapses whitespace and re-joins words hyphenated across line breaks. */
export function normalizeQuote(text: string): string {
  return text
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncates at a word boundary and appends an ellipsis; `maxChars` 0 = unlimited. */
export function truncateQuote(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  const cut = text.slice(0, maxChars);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maxChars / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

export function formatCitation(page: number, pageLabel: string | undefined, usePageLabels: boolean): string {
  if (usePageLabels && pageLabel && pageLabel !== String(page)) {
    return `p. ${pageLabel} [${page}]`;
  }
  return `p. ${page}`;
}

/** `[3, 5, 7, 8, 9]` → `3, 5, 7–9`. */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index] as number;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index] as number;
    }
    parts.push(end - start >= 2 ? `${start}–${end}` : end === start ? `${start}` : `${start}, ${end}`);
    index += 1;
  }
  return parts.join(", ");
}

function readingOrder(left: ReportHighlightInput, right: ReportHighlightInput): number {
  if (left.page !== right.page) {
    return left.page - right.page;
  }
  const topDelta = (right.top ?? 0) - (left.top ?? 0);
  if (topDelta !== 0) {
    return topDelta;
  }
  return (left.left ?? 0) - (right.left ?? 0);
}

export function buildReportModel(
  input: ReportInput,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): ReportModel {
  const categoriesById = new Map(input.categories.map((category) => [category.id, category]));
  const items: ReportItem[] = [...input.highlights].sort(readingOrder).map((highlight) => ({
    id: highlight.id,
    category: categoriesById.get(highlight.categoryId) ?? UNCATEGORIZED,
    page: highlight.page,
    citation: formatCitation(highlight.page, highlight.pageLabel, options.usePageLabels),
    quote: truncateQuote(normalizeQuote(highlight.text), options.quoteMaxChars),
    note: highlight.note.trim(),
  }));

  const summary: SummaryRow[] = input.categories
    .map((category) => {
      const own = items.filter((item) => item.category.id === category.id);
      return {
        category,
        count: own.length,
        withNotes: own.filter((item) => item.note !== "").length,
        pages: formatPageList(own.map((item) => item.page)),
      };
    })
    .filter((row) => options.includeEmptyCategories || row.count > 0);

  const uncategorized = items.filter((item) => item.category.id === UNCATEGORIZED.id);
  if (uncategorized.length > 0) {
    summary.push({
      category: UNCATEGORIZED,
      count: uncategorized.length,
      withNotes: uncategorized.filter((item) => item.note !== "").length,
      pages: formatPageList(uncategorized.map((item) => item.page)),
    });
  }

  const byCategory: CategorySection[] = [
    ...input.categories,
    ...(uncategorized.length > 0 ? [UNCATEGORIZED] : []),
  ]
    .map((category) => ({ category, items: items.filter((item) => item.category.id === category.id) }))
    .filter((section) => options.includeEmptyCategories || section.items.length > 0);

  const pageNotes = new Map((input.pageNotes ?? []).map((note) => [note.page, note]));
  const pagesWithContent = [...new Set([...items.map((item) => item.page), ...pageNotes.keys()])].sort(
    (left, right) => left - right,
  );
  const byPage: PageSection[] = pagesWithContent.map((page) => {
    const pageItems = items.filter((item) => item.page === page);
    const label =
      pageItems[0]?.citation ?? formatCitation(page, pageNotes.get(page)?.pageLabel, options.usePageLabels);
    return {
      page,
      heading: label.replace(/^p\. /, "Page "),
      pageNote: pageNotes.get(page)?.note.trim() || null,
      items: pageItems,
    };
  });

  const noteCount =
    items.filter((item) => item.note !== "").length +
    (input.pageNotes ?? []).filter((note) => note.note.trim() !== "").length +
    (input.documentNotes ?? []).filter((note) => note.note.trim() !== "").length;

  return {
    title: input.title,
    meta: {
      sourceFileName: input.sourceFileName,
      pageCount: input.pageCount,
      author: input.author ?? null,
      generatedAt: input.generatedAt,
      highlightCount: items.length,
      noteCount,
    },
    options,
    aiSummary: input.aiSummary ?? null,
    summary,
    documentNotes: (input.documentNotes ?? []).filter((note) => note.note.trim() !== ""),
    byCategory,
    byPage,
    uncategorized,
  };
}
