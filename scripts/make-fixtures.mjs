// Generates deterministic, fully synthetic PDF fixtures into test/fixtures/generated/.
// Nothing here is derived from any published case; the text is invented.
//
//   pnpm fixtures

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PDFDocument, PDFName, rgb, StandardFonts } from "pdf-lib";

const root = dirname(import.meta.dirname);
const outDir = join(root, "test", "fixtures", "generated");

const PAGE = { width: 612, height: 792, margin: 72 };

const pages = [
  {
    heading: "Acme Widgets (A): The Pricing Decision",
    paragraphs: [
      "In March 2026, Dana Kim, chief executive of Acme Widgets, faced a decision that would shape the company for a decade. Gross margin had fallen from 41 percent to 33 percent over three years while unit volume grew by a third.",
      "Acme sold industrial fasteners to two customer segments: original equipment manufacturers, who bought on annual contracts, and distributors, who bought on spot terms. Distributors now accounted for 58 percent of revenue but only 31 percent of contribution.",
      "The board had asked Kim to present a plan by the June meeting. Three options were on the table: raise list prices across the board, introduce a tiered pricing structure, or exit the distributor channel entirely.",
      "Kim was worried that a blanket increase would hand share to Beta Fasteners, whose new plant in Ohio had come online in January with capacity equal to a quarter of the North American market.",
    ],
  },
  {
    heading: "Exhibit 1: Selected Financial Data (fiscal years ending December 31)",
    paragraphs: [
      "Revenue: 2023 $412 million; 2024 $468 million; 2025 $531 million.",
      "Gross margin: 2023 41.0 percent; 2024 37.2 percent; 2025 33.1 percent.",
      "Operating expenses as a share of revenue: 2023 22.4 percent; 2024 23.1 percent; 2025 24.8 percent.",
      "Working capital days: 2023 61; 2024 74; 2025 89. Inventory accounted for most of the increase, reflecting distributors' demand for next-day availability.",
      "Net debt to EBITDA: 2023 1.1x; 2024 1.8x; 2025 2.6x. The revolving credit facility carried a covenant of 3.0x.",
    ],
  },
  {
    heading: "The Sales Organization",
    paragraphs: [
      "Acme's 140 sales representatives were paid a base salary plus commission on revenue, not contribution. Several senior representatives told Kim privately that a tiered structure would be impossible to explain to customers.",
      "The head of distribution sales argued that exiting the channel would strand $60 million of inventory and trigger penalty clauses in eleven logistics contracts.",
      "Kim wondered whether the real question was not price but cost to serve, and whether Acme understood its own economics well enough to make either call.",
      "Discussion question: What should Kim recommend to the board, and what would she need to believe for that recommendation to be right?",
    ],
  },
];

function wrap(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function makeSampleCase() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Acme Widgets (A): The Pricing Decision");
  pdf.setAuthor("PDF Case Review fixtures");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pages.forEach((content, index) => {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    const maxWidth = PAGE.width - 2 * PAGE.margin;
    let y = PAGE.height - PAGE.margin;
    page.drawText(content.heading, { x: PAGE.margin, y, size: 14, font: bold });
    y -= 28;
    for (const paragraph of content.paragraphs) {
      for (const line of wrap(paragraph, serif, 11, maxWidth)) {
        page.drawText(line, { x: PAGE.margin, y, size: 11, font: serif, color: rgb(0.1, 0.1, 0.1) });
        y -= 15;
      }
      y -= 9;
    }
    page.drawText(`Acme Widgets (A) · page ${index + 1} of ${pages.length}`, {
      x: PAGE.margin,
      y: PAGE.margin / 2,
      size: 8,
      font: serif,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  // Page labels: front matter as roman numerals is common in real cases; the first page
  // here is labelled "i" so citation tests can check label-vs-index handling.
  pdf.catalog.set(
    PDFName.of("PageLabels"),
    pdf.context.obj({
      Nums: [0, pdf.context.obj({ S: PDFName.of("r") }), 1, pdf.context.obj({ S: PDFName.of("D") })],
    }),
  );

  return pdf.save({ useObjectStreams: false });
}

/** A "scanned" case: page images only, no embedded fonts, no text layer anywhere. */
async function makeScannedCase() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Scanned Case (no text layer)");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    // Grey "photograph" of a page: a border, rule lines and a figure, drawn as vector shapes so
    // the file stays tiny while still containing nothing a text layer could be built from.
    page.drawRectangle({
      x: PAGE.margin / 2,
      y: PAGE.margin / 2,
      width: PAGE.width - PAGE.margin,
      height: PAGE.height - PAGE.margin,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });
    for (let line = 0; line < 30; line += 1) {
      const width = (PAGE.width - 2 * PAGE.margin) * (line % 5 === 4 ? 0.6 : 0.94);
      page.drawRectangle({
        x: PAGE.margin,
        y: PAGE.height - PAGE.margin - 20 * (line + 1),
        width,
        height: 6,
        color: rgb(0.75, 0.75, 0.75),
      });
    }
    page.drawEllipse({
      x: PAGE.width / 2,
      y: PAGE.margin + 90,
      xScale: 90,
      yScale: 45 + 20 * index,
      color: rgb(0.55, 0.55, 0.55),
    });
  }
  return pdf.save({ useObjectStreams: false });
}

const LARGE_PAGES = 300;

/** A 300-page case with deterministic text on every page; small on disk, heavy to render. */
async function makeLargeCase() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Omega Industries (B): The Long Annual Report");
  pdf.setAuthor("PDF Case Review fixtures");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE.width - 2 * PAGE.margin;
  for (let index = 0; index < LARGE_PAGES; index += 1) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - PAGE.margin;
    page.drawText(`Section ${index + 1}: Operating Review`, { x: PAGE.margin, y, size: 14, font: bold });
    y -= 28;
    const source = pages[index % pages.length];
    for (const paragraph of source.paragraphs) {
      const text = `Item ${index + 1}. ${paragraph}`;
      for (const line of wrap(text, serif, 11, maxWidth)) {
        page.drawText(line, { x: PAGE.margin, y, size: 11, font: serif, color: rgb(0.1, 0.1, 0.1) });
        y -= 15;
      }
      y -= 9;
    }
    page.drawText(`Omega Industries (B) · page ${index + 1} of ${LARGE_PAGES}`, {
      x: PAGE.margin,
      y: PAGE.margin / 2,
      size: 8,
      font: serif,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  return pdf.save({ useObjectStreams: false });
}

const HEAVY_ATTACHMENT_BYTES = 80 * 1024 * 1024;

/** Deterministic incompressible bytes from a xorshift32 stream, so the heavy file is ~80 MB. */
function noiseBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x2f6e2b1e;
  for (let index = 0; index < length; index += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
    if (index + 1 < length) bytes[index + 1] = (state >>> 8) & 0xff;
    if (index + 2 < length) bytes[index + 2] = (state >>> 16) & 0xff;
    if (index + 3 < length) bytes[index + 3] = (state >>> 24) & 0xff;
  }
  return bytes;
}

/**
 * The 300-page case grown to ~80 MB with an incompressible attachment. Opt-in only
 * (`pnpm fixtures --heavy` or FIXTURES_HEAVY=1): it exists for the manual memory pass
 * (test/manual/memory-pass.md), never for CI or automated tests.
 */
async function makeHeavyCase() {
  const pdf = await PDFDocument.load(await makeLargeCase());
  pdf.setTitle("Omega Industries (B): The Heavy Annual Report");
  await pdf.attach(noiseBytes(HEAVY_ATTACHMENT_BYTES), "exhibit-archive.bin", {
    mimeType: "application/octet-stream",
    description: "Synthetic incompressible payload to reach a realistic file size.",
  });
  return pdf.save({ useObjectStreams: false });
}

const heavy = process.argv.includes("--heavy") || process.env.FIXTURES_HEAVY === "1";
const fixtures = [
  ["sample-case.pdf", makeSampleCase],
  ["scanned-case.pdf", makeScannedCase],
  ["large-case.pdf", makeLargeCase],
  ...(heavy ? [["heavy-case.pdf", makeHeavyCase]] : []),
];

mkdirSync(outDir, { recursive: true });
for (const [name, make] of fixtures) {
  const bytes = await make();
  writeFileSync(join(outDir, name), bytes);
  process.stdout.write(`Wrote test/fixtures/generated/${name} (${bytes.length} bytes)\n`);
}
