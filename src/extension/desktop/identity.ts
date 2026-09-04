// Desktop-only: runs the provider CLIs / reads their auth files and hands the text to the pure
// parsers in core/ai/identity. Loaded via dynamic import behind trust and desktop guards so the
// future web bundle never sees Node built-ins.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { type ProviderIdentity, parseClaudeAuthStatus, parseCodexAuthJson } from "../../core/ai/identity";

const run = promisify(execFile);

const EXEC_TIMEOUT_MS = 15_000;

export function expandHome(dir: string): string {
  return dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\") ? join(homedir(), dir.slice(1)) : dir;
}

/** Fixed argument lists only; the shell is needed on Windows to resolve npm's `.cmd` shims. */
async function execCli(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string | null> {
  try {
    const { stdout } = await run(command, args, {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      shell: process.platform === "win32",
      env: { ...process.env, ...env },
    });
    return stdout;
  } catch (error) {
    // `auth status` can exit non-zero when logged out yet still print the JSON we want.
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" && stdout.trim() !== "" ? stdout : null;
  }
}

function notFound(provider: "claude-cli" | "codex-cli", detail: string): ProviderIdentity {
  return { provider, loggedIn: false, email: null, organization: null, detail, verified: false };
}

export async function whoAmIClaude(configDir?: string): Promise<ProviderIdentity> {
  const env = configDir ? { CLAUDE_CONFIG_DIR: expandHome(configDir) } : undefined;
  const output = await execCli("claude", ["auth", "status"], env);
  if (output === null) {
    return notFound("claude-cli", "claude CLI not found or not responding");
  }
  return parseClaudeAuthStatus(output);
}

export async function whoAmICodex(configDir?: string): Promise<ProviderIdentity> {
  const home = expandHome(configDir ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex"));
  try {
    return parseCodexAuthJson(await readFile(join(home, "auth.json"), "utf8"));
  } catch {
    return notFound("codex-cli", `no auth.json under ${home}`);
  }
}

export async function whoAmIForAccount(account: {
  provider: "claude-cli" | "codex-cli";
  configDir: string;
}): Promise<ProviderIdentity> {
  return account.provider === "claude-cli" ? whoAmIClaude(account.configDir) : whoAmICodex(account.configDir);
}

async function onPath(binary: string): Promise<boolean> {
  const finder = process.platform === "win32" ? "where" : "which";
  return (await execCli(finder, [binary])) !== null;
}

/** One-line install instructions, shown wherever a CLI turns out to be missing. */
export const INSTALL_FIX = {
  "claude-cli": "Install it: npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in.",
  "codex-cli": "Install it: npm i -g @openai/codex, then run `codex` once to sign in.",
} as const;

export const PROVIDER_LABEL = { "claude-cli": "Claude Code", "codex-cli": "Codex" } as const;

/** Whether the provider's binary is on PATH; the cheap guard before any consent dialog. */
export async function providerOnPath(provider: "claude-cli" | "codex-cli"): Promise<boolean> {
  return onPath(provider === "claude-cli" ? "claude" : "codex");
}

export interface ProviderProbe {
  provider: "claude-cli" | "codex-cli";
  label: string;
  available: boolean;
  identity: ProviderIdentity | null;
  /** One-line fix shown when the option is unavailable. */
  fix: string | null;
}

export async function probeProviders(): Promise<ProviderProbe[]> {
  const [claudeFound, codexFound] = await Promise.all([onPath("claude"), onPath("codex")]);
  const probes: ProviderProbe[] = [];
  probes.push(
    claudeFound
      ? {
          provider: "claude-cli",
          label: "Claude Code",
          available: true,
          identity: await whoAmIClaude(),
          fix: null,
        }
      : {
          provider: "claude-cli",
          label: "Claude Code",
          available: false,
          identity: null,
          fix: INSTALL_FIX["claude-cli"],
        },
  );
  probes.push(
    codexFound
      ? {
          provider: "codex-cli",
          label: "Codex",
          available: true,
          identity: await whoAmICodex(),
          fix: null,
        }
      : {
          provider: "codex-cli",
          label: "Codex",
          available: false,
          identity: null,
          fix: INSTALL_FIX["codex-cli"],
        },
  );
  return probes;
}
