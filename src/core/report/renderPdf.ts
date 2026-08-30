// PDF renderer for the report blocks (pdfmake browser build + bundled Roboto; runs in Node and
// in the browser). Loaded lazily by the extension because the font VFS is ~840 KB.

import pdfMake from "pdfmake/build/pdfmake";
import vfs from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import type { ReportBlock, TextRun } from "./layout";

const MUTED = "#666666";
let fontsRegistered = false;

function ensureFonts(): void {
  if (!fontsRegistered) {
    pdfMake.addVirtualFileSystem(vfs);
    fontsRegistered = true;
  }
}

function runs(items: TextRun[], extra: { italics?: boolean; color?: string } = {}): Content {
  return items.map((run) => ({
    text: run.text,
    bold: run.bold === true,
    italics: run.italic === true || extra.italics === true,
    ...(extra.color ? { color: extra.color } : {}),
  }));
}

function blockToPdf(block: ReportBlock): Content {
  switch (block.kind) {
    case "heading": {
      const text: Content = { text: block.text, style: `h${block.level}` };
      if (!block.color) {
        return text;
      }
      return {
        table: { widths: [6, "*"], body: [[{ text: "", fillColor: block.color }, text]] },
        layout: "noBorders",
        margin: [0, 10, 0, 4],
      };
    }
    case "paragraph":
      return {
        text: runs(
          block.runs,
          block.generated ? { italics: true, color: MUTED } : block.muted ? { color: MUTED } : {},
        ),
        margin: [0, 0, 0, 6],
      };
    case "keyValues":
      return {
        stack: block.entries.map(([key, value]) => ({ text: [{ text: `${key}: `, bold: true }, value] })),
        margin: [0, 0, 0, 10],
      };
    case "table":
      return {
        table: {
          headerRows: 1,
          widths: [8, "*", "auto", "auto", "auto"],
          body: [
            [{ text: "" }, ...block.header.map((text) => ({ text, bold: true }))],
            ...block.rows.map((row, index) => {
              const swatch = block.swatches[index];
              return [swatch ? { text: "", fillColor: swatch } : { text: "" }, ...row];
            }),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 12],
      };
    case "quote":
      return {
        table: {
          widths: [3, "*"],
          body: [
            [
              { text: "", fillColor: block.color },
              {
                text: [
                  { text: block.text, italics: true },
                  { text: ` (${block.citation})`, color: MUTED },
                ],
                margin: [6, 2, 0, 2],
              },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 4, 0, 4],
        unbreakable: true,
      };
    case "bullets":
      return {
        ul: block.items.map((item) => ({
          text: runs(item, block.generated ? { italics: true, color: MUTED } : {}),
        })),
        margin: [0, 0, 0, 6],
      };
    case "pageBreak":
      return { text: "", pageBreak: "after" };
  }
}

export async function renderPdf(blocks: ReportBlock[], footerText: string): Promise<Uint8Array> {
  ensureFonts();
  const definition: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageMargins: [54, 54, 54, 54],
    info: { title: footerText, creator: "PDF Case Review" },
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 10] },
      h2: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] },
      h3: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
    },
    footer: (currentPage, pageCount) => ({
      text: `${footerText} · page ${currentPage} of ${pageCount}`,
      alignment: "center",
      color: MUTED,
      fontSize: 8,
      margin: [0, 20, 0, 0],
    }),
    content: blocks.map(blockToPdf),
  };
  const buffer = await pdfMake.createPdf(definition).getBuffer();
  return new Uint8Array(buffer);
}
