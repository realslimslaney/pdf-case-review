// The provider QuickPick behind Summarize with AI's front door, Choose AI Provider... and the AI
// status bar. Each CLI option is probed under the login the active document would actually run
// with (the account its rules select, else the default login), so the email shown is the one the
// gate will verify. Applies the setting for real providers and returns what was picked.

import { commands, type LogOutputChannel, window, workspace } from "vscode";

import { type AccountResolution, type AiProvider, PROVIDER_LABEL } from "../../core/ai/accounts";
import { addAiAccount } from "../commands/configure";
import type { ProviderProbe } from "../desktop/identity";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { readAiSettings, setAiProvider } from "../settings";
import { isDesktopHost } from "../util/host";
import { resolveDocumentAccount } from "./documentFacts";

export type ProviderPick = "off" | AiProvider | "manual";

interface PickContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  output: LogOutputChannel;
}

interface ProviderItem {
  label: string;
  description: string;
  detail?: string;
  id: ProviderPick;
  /** Set when the option cannot be picked; shown instead of applying it. */
  fix?: string;
}

const PROVIDERS: readonly AiProvider[] = ["claude-cli", "codex-cli"];

function signedIn(probe: ProviderProbe): string | null {
  const identity = probe.identity;
  if (!identity?.loggedIn || !identity.email) {
    return null;
  }
  return `${identity.email}${identity.organization ? ` · ${identity.organization}` : ""}`;
}

function providerItem(
  probe: ProviderProbe,
  resolution: AccountResolution,
  hasDocument: boolean,
): ProviderItem {
  const item: ProviderItem = { label: probe.label, description: "", id: probe.provider };
  if (!probe.available) {
    item.description = "✗ not found on PATH";
    if (probe.fix) {
      item.detail = probe.fix;
      item.fix = probe.fix;
    }
    return item;
  }
  const account = signedIn(probe);
  switch (resolution.kind) {
    case "resolved":
      item.description = account
        ? `✓ ${account} · account "${resolution.accountId}"`
        : `✓ installed, not signed in under ${resolution.account.configDir} (account "${resolution.accountId}")`;
      break;
    case "missingForProvider":
      item.description = `✓ installed · no ${probe.label} login registered as "${resolution.accountId}"`;
      item.detail = `Configure > Add an AI Account... registers one under that id; until then runs on this document are refused.`;
      break;
    case "unknownId":
      item.description = `✓ installed · the rule selects "${resolution.accountId}", which is not in pdfCaseReview.ai.accounts`;
      break;
    case "needsAuthorizationLine":
      item.description = "✓ installed · the account is decided by the document's authorization line";
      break;
    default:
      item.description = account
        ? `✓ ${account} (default login${hasDocument ? "" : "; no PDF open"})`
        : "✓ installed, not signed in";
  }
  return item;
}

/**
 * `document` is the PDF the choice is for; callers mid-run pass the one they captured, because the
 * prompt review tab or a dialog may have taken the active tab away from it by now.
 */
export async function pickProvider(
  context: PickContext,
  document: PdfDocument | undefined = context.tracker.active,
): Promise<ProviderPick | undefined> {
  const resource = document?.uri;
  const items: ProviderItem[] = [
    { label: "Off", description: "No AI. The manual copy and paste commands still work.", id: "off" },
  ];
  const resolutions = new Map<AiProvider, AccountResolution>();
  if (isDesktopHost() && workspace.isTrusted) {
    const desktop = await import("../desktop/identity");
    const configDirs: Partial<Record<AiProvider, string>> = {};
    if (document) {
      const { settings } = readAiSettings(document.uri);
      for (const provider of PROVIDERS) {
        const resolution = await resolveDocumentAccount(document, context.provider, settings, provider);
        resolutions.set(provider, resolution);
        if (resolution.kind === "resolved") {
          configDirs[provider] = resolution.account.configDir;
        }
      }
    }
    for (const probe of await desktop.probeProviders(configDirs)) {
      items.push(
        providerItem(probe, resolutions.get(probe.provider) ?? { kind: "none" }, document !== undefined),
      );
    }
  } else {
    const reason = workspace.isTrusted
      ? "CLI providers need desktop VS Code."
      : "CLI providers are disabled in untrusted workspaces.";
    for (const provider of PROVIDERS) {
      items.push({ label: PROVIDER_LABEL[provider], description: `✗ ${reason}`, id: provider, fix: reason });
    }
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
    await setAiProvider("off", resource);
    void window.showInformationMessage("PDF Case Review: AI provider set to manual (copy and paste).");
    context.output.info("ai.provider set to off (manual)");
    return "manual";
  }
  await setAiProvider(picked.id, resource);
  context.output.info(`ai.provider set to ${picked.id}`);
  const set = `PDF Case Review: AI provider set to ${picked.label.toLowerCase()}.`;
  const resolution = picked.id === "off" ? undefined : resolutions.get(picked.id);
  if (picked.id !== "off" && resolution?.kind === "missingForProvider") {
    const add = "Add an AI Account...";
    const choice = await window.showInformationMessage(
      `${set} This document's rule selects "${resolution.accountId}", which has no ${picked.label} login yet.`,
      add,
    );
    if (choice === add) {
      await addAiAccount(resource, { provider: picked.id, id: resolution.accountId });
    }
  } else {
    void window.showInformationMessage(set);
  }
  return picked.id;
}

/** The Choose AI Provider... command; picking Manual continues into the clipboard flow. */
export async function chooseProvider(context: PickContext): Promise<void> {
  const picked = await pickProvider(context);
  if (picked === "manual") {
    await commands.executeCommand("pdfCaseReview.ai.copySummaryPrompt");
  }
}
