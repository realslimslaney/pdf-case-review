// Word renderer for the report blocks (docx library; runs in Node and in the browser).

import {
  AlignmentType,
  BorderStyle,
  Document,
  TextRun as DocxTextRun,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";

import type { ReportBlock, TextRun } from "./layout";

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

const MUTED = "666666";

function hex(color: string): string {
  return color.replace("#", "").toUpperCase();
}

function runs(items: TextRun[], extra: { italics?: boolean; color?: string } = {}): DocxTextRun[] {
  return items.map(
    (run) =>
      new DocxTextRun({
        text: run.text,
        bold: run.bold === true,
        italics: run.italic === true || extra.italics === true,
        ...(run.code ? { font: "Consolas" } : {}),
        ...(extra.color ? { color: extra.color } : {}),
      }),
  );
}

function swatchCell(color: string | null): TableCell {
  return new TableCell({
    width: { size: 4, type: WidthType.PERCENTAGE },
    ...(color ? { shading: { type: ShadingType.CLEAR, fill: hex(color), color: "auto" } } : {}),
    children: [new Paragraph("")],
  });
}

function textCell(text: string, options: { bold?: boolean; widthPercent: number }): TableCell {
  return new TableCell({
    width: { size: options.widthPercent, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new DocxTextRun({ text, bold: options.bold === true })] })],
  });
}

function blockToDocx(block: ReportBlock): (Paragraph | Table)[] {
  switch (block.kind) {
    case "heading":
      return [
        new Paragraph({
          heading: HEADING_LEVELS[block.level],
          children: [
            ...(block.color ? [new DocxTextRun({ text: "■ ", color: hex(block.color) })] : []),
            new DocxTextRun({ text: block.text }),
          ],
        }),
      ];
    case "paragraph":
      return [new Paragraph({ children: runs(block.runs, block.muted ? { color: MUTED } : {}) })];
    case "keyValues":
      return block.entries.map(
        ([key, value]) =>
          new Paragraph({
            children: [new DocxTextRun({ text: `${key}: `, bold: true }), new DocxTextRun({ text: value })],
          }),
      );
    case "table": {
      const widths = [4, 40, 14, 14, 28];
      const header = new TableRow({
        tableHeader: true,
        children: [
          swatchCell(null),
          ...block.header.map((text, index) =>
            textCell(text, { bold: true, widthPercent: widths[index + 1] ?? 20 }),
          ),
        ],
      });
      const rows = block.rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: [
              swatchCell(block.swatches[rowIndex] ?? null),
              ...row.map((text, index) => textCell(text, { widthPercent: widths[index + 1] ?? 20 })),
            ],
          }),
      );
      return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] })];
    }
    case "quote":
      return [
        new Paragraph({
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: hex(block.color), space: 8 } },
          children: [
            new DocxTextRun({ text: block.text, italics: true }),
            new DocxTextRun({ text: ` (${block.citation})`, color: MUTED }),
          ],
        }),
      ];
    case "bullets":
      return block.items.map((item) => new Paragraph({ bullet: { level: 0 }, children: runs(item) }));
    case "pageBreak":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

export async function renderDocx(blocks: ReportBlock[], footerText: string): Promise<Uint8Array> {
  const children = blocks.flatMap(blockToDocx);
  const document = new Document({
    creator: "PDF Case Review",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new DocxTextRun({ text: `${footerText} · page `, color: MUTED, size: 18 }),
                  new DocxTextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 18 }),
                  new DocxTextRun({ text: " of ", color: MUTED, size: 18 }),
                  new DocxTextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 18 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}
