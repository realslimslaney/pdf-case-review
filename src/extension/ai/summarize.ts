// `summarizeWithAi` and `chooseProvider`: the CLI-provider path. Desktop-only code loads lazily
// behind trust and desktop guards; the eligibility gate runs before anything is spawned, and the
// result is cached in the sidecar so re-rendering a report never re-calls the model.

import {
  commands,
  type Disposable,
  type ExtensionContext,
  type LogOutputChannel,
  ProgressLocation,
  window,
  workspace,
} from "vscode";

import { buildSummaryPrompt } from "../../core/ai/prompt";
import type { AiSummary } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { type AiSettings, aiSettings, setAiProvider } from "../settings";
import { ensureAttestation } from "./consentGate";
import { markdownBody } from "./manualCommands";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  output: LogOutputChannel;
  extensionContext: ExtensionContext;
}

/** CLI providers need a Node extension host; the web host has no processes to spawn. */
function isDesktopHost(): boolean {
  return typeof process !== "undefined" && typeof process.versions?.node === "string";
}

function activeDocument(context: CommandContext): PdfDocument | undefined {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
  }
  return document;
}

async function resolveIdentity(settings: AiSettings, accountId: string | undefined) {
  const desktop = await import("../desktop/identity");
  if (accountId !== undefined) {
    const account = settings.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      return null;
    }
    return desktop.whoAmIForAccount(account);
  }
  return settings.provider === "claude-cli" ? desktop.whoAmIClaude() : desktop.whoAmICodex();
}

export async function summarizeWithAi(context: CommandContext): Promise<boolean> {
  const document = activeDocument(context);
  if (!document) {
    return false;
  }
  if (!workspace.isTrusted) {
    void window.showWarningMessage("PDF Case Review: AI features are disabled in untrusted workspaces.");
    return false;
  }
  const settings = aiSettings(document.uri, context.output);
  if (settings.provider === "off") {
    void window
      .showInformationMessage("PDF Case Review: no AI provider is enabled.", "Choose AI Provider...")
      .then((pick) => (pick ? commands.executeCommand("pdfCaseReview.ai.chooseProvider") : undefined));
    return false;
  }
  if (!isDesktopHost()) {
    void window.showWarningMessage(
      "PDF Case Review: CLI providers need desktop VS Code. Use Copy Summary Prompt instead.",
    );
    return false;
  }
  const cached = document.model.aiSummary;
  if (cached && cached.provider === settings.provider) {
    const choice = await window.showInformationMessage(
      `PDF Case Review: an AI summary from ${cached.generatedAt} is already cached.`,
      "Use cached",
      "Regenerate",
    );
    if (choice !== "Regenerate") {
      return choice === "Use cached";
    }
  }

  const gate = await ensureAttestation(document, {
    whoAmI: (accountId) => resolveIdentity(settings, accountId),
    provider: settings.provider,
    settings,
    globalState: context.extensionContext.globalState,
    editorProvider: context.provider,
  });
  if (!gate.ok) {
    context.output.info(`summarizeWithAi refused: ${gate.reason}`);
    return false;
  }
  const prompt = buildSummaryPrompt(
    await markdownBody(document),
    { maxWords: settings.maxWords },
    gate.attestation,
  );
  const configDir = gate.accountId
    ? settings.accounts.find((entry) => entry.id === gate.accountId)?.configDir
    : undefined;

  const { ProviderRunCancelled, runProvider } = await import("../desktop/aiProviders");
  try {
    const text = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `PDF Case Review: asking ${settings.provider === "claude-cli" ? "Claude Code" : "Codex"} for the summary`,
        cancellable: true,
      },
      (_progress, token) => {
        const options: Parameters<typeof runProvider>[2] = { token };
        if (settings.model !== "") {
          options.model = settings.model;
        }
        if (configDir !== undefined) {
          options.configDir = configDir;
        }
        return runProvider(settings.provider as "claude-cli" | "codex-cli", prompt, options);
      },
    );
    const trimmed = text.trim();
    if (trimmed === "") {
      void window.showWarningMessage("PDF Case Review: the provider returned an empty summary.");
      return false;
    }
    const summary: AiSummary = {
      provider: settings.provider,
      generatedAt: new Date().toISOString(),
      text: trimmed,
      account: gate.attestation.record.email,
    };
    if (settings.model !== "") {
      summary.model = settings.model;
    }
    context.provider.setAiSummary(document, summary);
    void window.showInformationMessage(
      "PDF Case Review: AI summary saved with your notes; it will appear in the next report.",
    );
    return true;
  } catch (error) {
    if (error instanceof ProviderRunCancelled) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`PDF Case Review: the AI summary failed (${message}).`);
    return false;
  }
}

export async function chooseProvider(context: CommandContext): Promise<void> {
  interface ProviderItem {
    label: string;
    description: string;
    detail?: string;
    id: "off" | "claude-cli" | "codex-cli";
    fix?: string;
  }
  const items: ProviderItem[] = [
    { label: "Off", description: "No AI. The manual copy and paste commands still work.", id: "off" },
  ];
  if (isDesktopHost() && workspace.isTrusted) {
    const desktop = await import("../desktop/identity");
    for (const probe of await desktop.probeProviders()) {
      if (probe.available) {
        const identity = probe.identity;
        const account = identity?.email
          ? `${identity.email}${identity.organization ? ` · ${identity.organization}` : ""}`
          : "installed, not signed in";
        items.push({ label: probe.label, description: `✓ ${account}`, id: probe.provider });
      } else {
        const item: ProviderItem = {
          label: probe.label,
          description: "✗ not found on PATH",
          id: probe.provider,
        };
        if (probe.fix) {
          item.detail = probe.fix;
          item.fix = probe.fix;
        }
        items.push(item);
      }
    }
  } else {
    const reason = workspace.isTrusted
      ? "CLI providers need desktop VS Code."
      : "CLI providers are disabled in untrusted workspaces.";
    items.push(
      { label: "Claude Code", description: `✗ ${reason}`, id: "claude-cli", fix: reason },
      { label: "Codex", description: `✗ ${reason}`, id: "codex-cli", fix: reason },
    );
  }
  const picked = await window.showQuickPick(items, { placeHolder: "AI provider for executive summaries" });
  if (!picked) {
    return;
  }
  if (picked.fix) {
    void window.showInformationMessage(`PDF Case Review: ${picked.label} is unavailable. ${picked.fix}`);
    return;
  }
  await setAiProvider(picked.id);
  void window.showInformationMessage(`PDF Case Review: AI provider set to ${picked.label.toLowerCase()}.`);
  context.output.info(`ai.provider set to ${picked.id}`);
}

export function registerAiProviderCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.summarizeWithAi", () => summarizeWithAi(context)),
    commands.registerCommand("pdfCaseReview.ai.chooseProvider", () => chooseProvider(context)),
  ];
}
