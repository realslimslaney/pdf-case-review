import type { ReportBlock, TextRun } from "./layout";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function runsToMarkdown(runs: TextRun[], generated = false): string {
  return runs
    .map((run) => {
      let text = run.text;
      if (run.code) {
        text = `\`${text}\``;
      }
      if (run.bold) {
        text = `**${text}**`;
      }
      if (run.italic || generated) {
        text = `*${text}*`;
      }
      return text;
    })
    .join("");
}

export function renderMarkdown(blocks: ReportBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        lines.push(`${"#".repeat(block.level)} ${block.text}`, "");
        break;
      case "paragraph":
        lines.push(runsToMarkdown(block.runs, block.generated === true), "");
        break;
      case "keyValues":
        for (const [key, value] of block.entries) {
          lines.push(`- **${key}:** ${value}`);
        }
        lines.push("");
        break;
      case "table": {
        lines.push(`| ${block.header.map(escapeCell).join(" | ")} |`);
        lines.push(`| ${block.header.map(() => "---").join(" | ")} |`);
        block.rows.forEach((row, index) => {
          const swatch = block.swatches[index];
          const cells = row.map(escapeCell);
          if (swatch && cells[0] !== undefined) {
            cells[0] = `${cells[0]} \`${swatch}\``;
          }
          lines.push(`| ${cells.join(" | ")} |`);
        });
        lines.push("");
        break;
      }
      case "quote":
        lines.push(`> ${block.text} *(${block.citation})*`, "");
        break;
      case "bullets":
        for (const item of block.items) {
          lines.push(`- ${runsToMarkdown(item, block.generated === true)}`);
        }
        lines.push("");
        break;
      case "pageBreak":
        lines.push("---", "");
        break;
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
