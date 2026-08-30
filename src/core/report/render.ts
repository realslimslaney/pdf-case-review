// One entry point for every output format. Word and PDF renderers are imported lazily so the
// extension's activation path never pays for docx/pdfmake (+ fonts).

import { layoutReport } from "./layout";
import { buildReportModel, DEFAULT_REPORT_OPTIONS, type ReportInput, type ReportOptions } from "./model";
import { renderMarkdown } from "./renderMarkdown";

export type ReportFormat = "markdown" | "docx" | "pdf";

export const REPORT_EXTENSIONS: Record<ReportFormat, string> = { markdown: "md", docx: "docx", pdf: "pdf" };

export interface RenderedReport {
  format: ReportFormat;
  extension: string;
  bytes: Uint8Array;
}

export async function renderReport(
  input: ReportInput,
  format: ReportFormat,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): Promise<RenderedReport> {
  const model = buildReportModel(input, options);
  const blocks = layoutReport(model);
  const footer = `${model.title} — PDF Case Review`;
  switch (format) {
    case "markdown":
      return {
        format,
        extension: REPORT_EXTENSIONS.markdown,
        bytes: new TextEncoder().encode(renderMarkdown(blocks)),
      };
    case "docx": {
      const { renderDocx } = await import("./renderDocx");
      return { format, extension: REPORT_EXTENSIONS.docx, bytes: await renderDocx(blocks, footer) };
    }
    case "pdf": {
      const { renderPdf } = await import("./renderPdf");
      return { format, extension: REPORT_EXTENSIONS.pdf, bytes: await renderPdf(blocks, footer) };
    }
  }
}
