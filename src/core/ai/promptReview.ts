// Pure helpers behind the prompt review tab: the text the provider reads on stdin, the size
// figures the review toast quotes, the run file names under global storage and their pruning.

import type { AiSummary } from "../sidecar/types";
import type { SummaryPrompt } from "./prompt";

/** The exact bytes a CLI provider receives; the review tab shows and edits this text. */
export function promptText(prompt: SummaryPrompt): string {
  return `${prompt.system}\n\n${prompt.user}`;
}

export interface PromptStats {
  words: number;
  chars: number;
  /** A rough four-characters-per-token estimate, enough to show where usage goes. */
  tokens: number;
}

export function promptStats(text: string): PromptStats {
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  return { words, chars: text.length, tokens: Math.ceil(text.length / 4) };
}

/** ISO timestamp with the colons replaced, so it survives every file system. */
export function runTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
}

export type RunFileKind = "prompt" | "output" | "cached-output";

export function runFileName(kind: RunFileKind, timestamp: string): string {
  switch (kind) {
    case "prompt":
      return `summary-${timestamp}.prompt.md`;
    case "output":
      return `summary-${timestamp}.output.md`;
    default:
      return `summary-cached-${timestamp}.output.md`;
  }
}

export const RUN_FILES_TO_KEEP = 20;

const TIMESTAMP_IN_NAME = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z/;

/**
 * The file names to delete so that only the newest `keep` remain. Newest is decided by the
 * timestamp inside the name (a plain name sort would rank every `summary-cached-*` file above
 * every dated one); names without a timestamp count as oldest.
 */
export function filesToPrune(names: readonly string[], keep: number = RUN_FILES_TO_KEEP): string[] {
  const keyed = names.map((name) => ({ name, stamp: TIMESTAMP_IN_NAME.exec(name)?.[0] ?? "" }));
  keyed.sort((left, right) => {
    if (left.stamp !== right.stamp) {
      return left.stamp < right.stamp ? 1 : -1;
    }
    return left.name < right.name ? 1 : left.name > right.name ? -1 : 0;
  });
  return keyed.slice(Math.max(keep, 0)).map((entry) => entry.name);
}

/** The cached summary as a document: a provenance header line, a blank line, then the text. */
export function cachedSummaryDocument(summary: AiSummary): string {
  let header = `Generated with ${summary.provider} on ${summary.generatedAt}`;
  if (summary.model) {
    header += `, model ${summary.model}`;
  }
  if (summary.account) {
    header += `, account ${summary.account}`;
  }
  return `${header}\n\n${summary.text}\n`;
}
