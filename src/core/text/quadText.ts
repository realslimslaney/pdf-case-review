// Recovers the text under a highlight from the page's text content and the highlight's quads.
// Used as the fallback when PDF.js has no text for an editor (free highlights, injected editors)
// and as the cross-check for the text captured from the selection (spike 2).

export interface TextItemGeometry {
  str: string;
  /** Origin in PDF user space: left edge and baseline. */
  x: number;
  y: number;
  width: number;
  /** Font size in user space; the item is taken to span `y` to `y + height`. */
  height: number;
  hasEOL: boolean;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Fraction of an item's height that must overlap a quad vertically to count as covered. */
const VERTICAL_COVERAGE = 0.5;
/** Horizontal coverage above which the whole item string is taken rather than a proportional slice. */
const WHOLE_ITEM_COVERAGE = 0.98;
/** A horizontal gap wider than this fraction of the font size separates words. */
const WORD_GAP = 0.2;

function quadBoxes(quadPoints: readonly number[]): Box[] {
  const boxes: Box[] = [];
  for (let index = 0; index + 7 < quadPoints.length; index += 8) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quadPoints.slice(index, index + 8) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    boxes.push({
      left: Math.min(x1, x3),
      right: Math.max(x2, x4),
      top: Math.max(y1, y2),
      bottom: Math.min(y3, y4),
    });
  }
  return boxes;
}

function separator(previous: TextItemGeometry, next: TextItemGeometry): string {
  if (previous.hasEOL) {
    return "\n";
  }
  const onNewLine = Math.abs(next.y - previous.y) > VERTICAL_COVERAGE * previous.height;
  const gap = next.x - (previous.x + previous.width);
  return onNewLine || gap > WORD_GAP * Math.min(previous.height, next.height) ? " " : "";
}

/**
 * The text of every item that the quads cover, in content order. Items covered only in part
 * contribute a proportional slice of their string (character widths are assumed uniform).
 */
export function textInQuads(items: readonly TextItemGeometry[], quadPoints: readonly number[]): string {
  const boxes = quadBoxes(quadPoints);
  if (boxes.length === 0) {
    return "";
  }
  const parts: string[] = [];
  let previous: TextItemGeometry | undefined;
  for (const item of items) {
    if (item.str === "" || item.width <= 0 || item.height <= 0) {
      continue;
    }
    const itemTop = item.y + item.height;
    let coveredStart = Number.POSITIVE_INFINITY;
    let coveredEnd = Number.NEGATIVE_INFINITY;
    for (const box of boxes) {
      const vertical = Math.min(box.top, itemTop) - Math.max(box.bottom, item.y);
      if (vertical < VERTICAL_COVERAGE * item.height) {
        continue;
      }
      const start = Math.max(box.left, item.x);
      const end = Math.min(box.right, item.x + item.width);
      if (end <= start) {
        continue;
      }
      coveredStart = Math.min(coveredStart, start);
      coveredEnd = Math.max(coveredEnd, end);
    }
    if (coveredEnd <= coveredStart) {
      continue;
    }
    let text = item.str;
    if ((coveredEnd - coveredStart) / item.width < WHOLE_ITEM_COVERAGE) {
      const chars = item.str.length;
      const from = Math.max(0, Math.round(((coveredStart - item.x) / item.width) * chars));
      const to = Math.min(chars, Math.round(((coveredEnd - item.x) / item.width) * chars));
      text = item.str.slice(from, to);
      if (text.trim() === "") {
        continue;
      }
    }
    if (previous) {
      parts.push(separator(previous, item));
    }
    parts.push(text);
    previous = item;
  }
  return parts.join("");
}
