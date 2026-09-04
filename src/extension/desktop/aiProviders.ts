// Desktop-only: spawns the provider CLIs for the executive summary. The prompt goes to stdin and
// stdin is always closed (an open non-TTY pipe hangs Codex); 120 s timeout; cancellation kills the
// whole child tree. Loaded via dynamic import behind trust and desktop guards.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CancellationToken } from "vscode";
import type { SummaryPrompt } from "../../core/ai/prompt";
import { promptText } from "../../core/ai/promptReview";
import { expandHome } from "./identity";

export const PROVIDER_TIMEOUT_MS = 120_000;

export class ProviderRunCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export interface SpawnPlan {
  binary: string;
  args: string[];
  /** Environment overrides layered over process.env. */
  env: Record<string, string>;
}

/**
 * Pure argv/env construction, unit-tested; `lastMessageFile` is Codex's robust output channel.
 * The summary is a text-in text-out call, never an agent run: `--tools=` disables every Claude
 * tool (the `=` form survives the Windows shell join, where an empty `""` argument would vanish)
 * and also makes the CLI ignore user and project settings; Codex gets its strictest sandbox.
 * The caller runs both from an empty scratch directory so a prompt-injected instruction inside a
 * highlight cannot reach project files or project agent rules.
 */
export function spawnPlan(
  provider: "claude-cli" | "codex-cli",
  options: { model?: string; configDir?: string; lastMessageFile?: string },
): SpawnPlan {
  const env: Record<string, string> = {};
  if (provider === "claude-cli") {
    if (options.configDir) {
      env["CLAUDE_CONFIG_DIR"] = expandHome(options.configDir);
    }
    const args = ["-p", "--output-format", "text", "--tools="];
    if (options.model) {
      args.push("--model", options.model);
    }
    return { binary: "claude", args, env };
  }
  if (options.configDir) {
    env["CODEX_HOME"] = expandHome(options.configDir);
  }
  const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.lastMessageFile) {
    args.push("--output-last-message", options.lastMessageFile);
  }
  args.push("-");
  return { binary: "codex", args, env };
}

function killTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

export interface RunProviderOptions {
  model?: string;
  configDir?: string;
  token?: CancellationToken;
  timeoutMs?: number;
}

/** A string prompt (the reviewed tab's text) goes to stdin verbatim; an object is joined first. */
export async function runProvider(
  provider: "claude-cli" | "codex-cli",
  prompt: SummaryPrompt | string,
  options: RunProviderOptions = {},
): Promise<string> {
  const stdinText = typeof prompt === "string" ? prompt : promptText(prompt);
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const scratchDir = await mkdtemp(join(tmpdir(), "pdf-case-review-"));
  let lastMessageFile: string | undefined;
  if (provider === "codex-cli") {
    lastMessageFile = join(scratchDir, "last-message.txt");
  }
  const planOptions: Parameters<typeof spawnPlan>[1] = {};
  if (options.model) {
    planOptions.model = options.model;
  }
  if (options.configDir) {
    planOptions.configDir = options.configDir;
  }
  if (lastMessageFile) {
    planOptions.lastMessageFile = lastMessageFile;
  }
  const plan = spawnPlan(provider, planOptions);

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(plan.binary, plan.args, {
        shell: process.platform === "win32",
        windowsHide: true,
        cwd: scratchDir,
        env: { ...process.env, ...plan.env },
      });
      const out: Buffer[] = [];
      const errors: Buffer[] = [];
      let settled: "timeout" | "cancel" | undefined;
      const timer = setTimeout(() => {
        settled = "timeout";
        killTree(child);
      }, timeoutMs);
      const cancellation = options.token?.onCancellationRequested(() => {
        settled = "cancel";
        killTree(child);
      });
      child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => errors.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        cancellation?.dispose();
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        cancellation?.dispose();
        if (settled === "cancel") {
          reject(new ProviderRunCancelled());
          return;
        }
        if (settled === "timeout") {
          reject(new Error(`${plan.binary} timed out after ${Math.round(timeoutMs / 1000)} s`));
          return;
        }
        if (code !== 0) {
          const stderr = Buffer.concat(errors).toString("utf8").trim().slice(-400);
          reject(new Error(`${plan.binary} exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
          return;
        }
        resolve(Buffer.concat(out).toString("utf8"));
      });
      child.stdin?.end(stdinText);
    });
    if (lastMessageFile) {
      try {
        const last = (await readFile(lastMessageFile, "utf8")).trim();
        if (last !== "") {
          return last;
        }
      } catch {
        // fall through to stdout
      }
    }
    return stdout.trim();
  } finally {
    if (scratchDir) {
      void rm(scratchDir, { recursive: true, force: true });
    }
  }
}
