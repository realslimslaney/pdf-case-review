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

import { summaryInputDigest } from "../../core/ai/digest";
import { buildSummaryPrompt, SUMMARY_PROMPT_VERSION } from "../../core/ai/prompt";
import type { AiSummary } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { type AiSettings, aiSettings, setAiProvider } from "../settings";
import { isDesktopHost } from "../util/host";
import { ensureAttestation } from "./consentGate";
import { markdownBody } from "./manualCommands";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  output: LogOutputChannel;
  extensionContext: ExtensionContext;
}

function activeDocument(context: CommandContext): PdfDocument | undefined {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
  }
  return document;
}

/**
 * The account a rule names must belong to the active provider: the gate records the identity it
 * verified, so the run may never execute under a different CLI or login directory than that.
 */
async function resolveIdentity(settings: AiSettings, accountId: string | undefined) {
  const desktop = await import("../desktop/identity");
  if (accountId !== undefined) {
    const account = settings.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      throw new Error(
        `a requiredAccount rule names the account "${accountId}", but pdfCaseReview.ai.accounts has ` +
          "no such entry.",
      );
    }
    if (account.provider !== settings.provider) {
      throw new Error(
        `the matched requiredAccount rule selects account "${accountId}" (${account.provider}), but ` +
          `pdfCaseReview.ai.provider is ${settings.provider}. Align the rule and the provider.`,
      );
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
  let settings = aiSettings(document.uri, context.output);
  if (settings.provider === "off") {
    // The front door: no configured provider is a setup step inside the flow, not a dead end.
    const picked = await pickProvider(context);
    if (picked === "manual") {
      return (await commands.executeCommand<boolean>("pdfCaseReview.ai.copySummaryPrompt")) === true;
    }
    if (picked !== "claude-cli" && picked !== "codex-cli") {
      return false;
    }
    settings = aiSettings(document.uri, context.output);
    if (settings.provider !== picked) {
      void window.showErrorMessage(
        `PDF Case Review: pdfCaseReview.ai.provider still resolves to "${settings.provider}" for this ` +
          "document; a narrower settings scope overrides the choice. Change it where it is defined.",
      );
      return false;
    }
  }
  if (!isDesktopHost()) {
    void window.showWarningMessage(
      "PDF Case Review: CLI providers need desktop VS Code. Use Copy Summary Prompt instead.",
    );
    return false;
  }
  // Fail before the consent dialog when the binary is gone (a new machine, synced settings):
  // without this the gate falls back to "account not reported" and the run dies on ENOENT.
  const provider = settings.provider as "claude-cli" | "codex-cli";
  const desktop = await import("../desktop/identity");
  if (!(await desktop.providerOnPath(provider))) {
    context.output.info(`summarizeWithAi refused: ${provider} binary not found on PATH`);
    void window
      .showErrorMessage(
        `PDF Case Review: ${desktop.PROVIDER_LABEL[provider]} is the configured AI provider, but its CLI is not on PATH. ${desktop.INSTALL_FIX[provider]}`,
        "Choose AI Provider...",
      )
      .then((pick) => (pick ? commands.executeCommand("pdfCaseReview.ai.chooseProvider") : undefined));
    return false;
  }
  const cached = document.model.aiSummary;
  if (cached && cached.provider === settings.provider) {
    const fresh =
      cached.promptVersion === SUMMARY_PROMPT_VERSION &&
      cached.inputDigest === summaryInputDigest(document.model, settings.maxWords);
    const choice = await window.showInformationMessage(
      fresh
        ? `PDF Case Review: an AI summary from ${cached.generatedAt} is already cached.`
        : `PDF Case Review: the cached AI summary from ${cached.generatedAt} predates changes to your highlights or notes.`,
      "Use cached",
      "Regenerate",
    );
    if (choice !== "Regenerate") {
      return choice === "Use cached";
    }
  }

  let gate: Awaited<ReturnType<typeof ensureAttestation>>;
  try {
    gate = await ensureAttestation(document, {
      whoAmI: (accountId) => resolveIdentity(settings, accountId),
      provider: settings.provider,
      settings,
      globalState: context.extensionContext.globalState,
      editorProvider: context.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`PDF Case Review: ${message}`);
    return false;
  }
  if (!gate.ok) {
    context.output.info(`summarizeWithAi refused: ${gate.reason}`);
    return false;
  }
  // Captured with the prompt: edits made while the provider runs must mark the summary stale.
  const inputDigest = summaryInputDigest(document.model, settings.maxWords);
  const prompt = buildSummaryPrompt(
    await markdownBody(document),
    { maxWords: settings.maxWords },
    gate.attestation,
  );
  const account = gate.accountId ? settings.accounts.find((entry) => entry.id === gate.accountId) : undefined;
  const configDir = account?.provider === settings.provider ? account.configDir : undefined;

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
        return runProvider(provider, prompt, options);
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
      inputDigest,
      promptVersion: SUMMARY_PROMPT_VERSION,
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

type ProviderPick = "off" | "claude-cli" | "codex-cli" | "manual";

/**
 * The provider QuickPick. Applies the setting for real providers and returns what was picked, so
 * `summarizeWithAi` can continue straight into the flow; "manual" changes no setting (the copy
 * and paste commands work with the provider off).
 */
async function pickProvider(context: CommandContext): Promise<ProviderPick | undefined> {
  interface ProviderItem {
    label: string;
    description: string;
    detail?: string;
    id: ProviderPick;
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
  if (workspace.isTrusted) {
    items.push({
      label: "Manual",
      description: "Copy the summary prompt, paste the answer back. Works without any CLI.",
      id: "manual",
    });
  } else {
    const reason = "AI features are disabled in untrusted workspaces.";
    items.push({ label: "Manual", description: `✗ ${reason}`, id: "manual", fix: reason });
  }
  const picked = await window.showQuickPick(items, { placeHolder: "AI provider for executive summaries" });
  if (!picked) {
    return undefined;
  }
  if (picked.fix) {
    void window.showInformationMessage(`PDF Case Review: ${picked.label} is unavailable. ${picked.fix}`);
    return undefined;
  }
  if (picked.id === "manual") {
    return "manual";
  }
  await setAiProvider(picked.id, context.tracker.active?.uri);
  void window.showInformationMessage(`PDF Case Review: AI provider set to ${picked.label.toLowerCase()}.`);
  context.output.info(`ai.provider set to ${picked.id}`);
  return picked.id;
}

export async function chooseProvider(context: CommandContext): Promise<void> {
  const picked = await pickProvider(context);
  if (picked === "manual") {
    await commands.executeCommand("pdfCaseReview.ai.copySummaryPrompt");
  }
}

export function registerAiProviderCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.summarizeWithAi", () => summarizeWithAi(context)),
    commands.registerCommand("pdfCaseReview.ai.chooseProvider", () => chooseProvider(context)),
  ];
}
