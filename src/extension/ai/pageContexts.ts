// `addPageContext` (issue #29): AI-written context above dense, lightly-annotated highlight
// clusters. One gate pass covers the whole batch; each page's staleness digest is captured when
// its prompt is built, so edits made while the provider runs mark that page's context stale.

import {
  commands,
  type Disposable,
  type ExtensionContext,
  type LogOutputChannel,
  ProgressLocation,
  window,
  workspace,
} from "vscode";

import {
  buildPageContextPrompt,
  PAGE_CONTEXT_PROMPT_VERSION,
  pageContextInputDigest,
  pagesNeedingContext,
} from "../../core/ai/pageContext";
import { formatCitation } from "../../core/report/model";
import type { AiPageContext } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import { aiSettings } from "../settings";
import { isDesktopHost } from "../util/host";
import { ensureAttestation } from "./consentGate";
import { resolveIdentity } from "./summarize";

interface CommandContext {
  provider: PdfCaseReviewEditorProvider;
  tracker: ActiveDocumentTracker;
  output: LogOutputChannel;
  extensionContext: ExtensionContext;
}

export async function addPageContext(context: CommandContext): Promise<boolean> {
  const document = context.tracker.active;
  if (!document) {
    void window.showInformationMessage("PDF Case Review: open a PDF first.");
    return false;
  }
  if (!workspace.isTrusted) {
    void window.showWarningMessage("PDF Case Review: AI features are disabled in untrusted workspaces.");
    return false;
  }
  const settings = aiSettings(document.uri, context.output);
  if (settings.provider === "off") {
    void window
      .showInformationMessage(
        "PDF Case Review: AI page context needs a CLI provider. Choose one first.",
        "Choose AI Provider...",
      )
      .then((pick) => (pick ? commands.executeCommand("pdfCaseReview.ai.chooseProvider") : undefined));
    return false;
  }
  const candidates = pagesNeedingContext(document.model, settings.pageContextMinHighlights);
  if (candidates.length === 0) {
    void window.showInformationMessage(
      `PDF Case Review: no page has ${settings.pageContextMinHighlights} or more highlights with most of them unannotated (pdfCaseReview.ai.pageContext.minHighlights).`,
    );
    return false;
  }
  if (!isDesktopHost()) {
    void window.showWarningMessage("PDF Case Review: CLI providers need desktop VS Code.");
    return false;
  }
  const provider = settings.provider;
  const desktop = await import("../desktop/identity");
  if (!(await desktop.providerOnPath(provider))) {
    void window.showErrorMessage(
      `PDF Case Review: ${desktop.PROVIDER_LABEL[provider]} is the configured AI provider, but its CLI is not on PATH. ${desktop.INSTALL_FIX[provider]}`,
    );
    return false;
  }

  const labelFor = (page: number) => document.pageLabels?.[page - 1];
  const citationLabel = (page: number) => formatCitation(page, labelFor(page), true).slice(3);
  const picked = await window.showQuickPick(
    candidates.map((page) => {
      const highlights = document.model.highlights.filter((highlight) => highlight.page === page);
      const noted = highlights.filter((highlight) => highlight.note.trim() !== "").length;
      return {
        label: `Page ${citationLabel(page)}`,
        description: `${highlights.length} highlights, ${noted} with notes`,
        page,
        picked: true,
      };
    }),
    { canPickMany: true, placeHolder: "Pages to generate AI context for" },
  );
  if (!picked || picked.length === 0) {
    return false;
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
    void window.showErrorMessage(
      `PDF Case Review: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  if (!gate.ok) {
    context.output.info(`addPageContext refused: ${gate.reason}`);
    return false;
  }
  const attestation = gate.attestation;
  const account = gate.accountId ? settings.accounts.find((entry) => entry.id === gate.accountId) : undefined;
  const configDir = account?.provider === provider ? account.configDir : undefined;

  const { ProviderRunCancelled, runProvider } = await import("../desktop/aiProviders");
  const generated: AiPageContext[] = [];
  let cancelled = false;
  let failed: { page: number; message: string } | undefined;
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `PDF Case Review: asking ${desktop.PROVIDER_LABEL[provider]} for page context`,
        cancellable: true,
      },
      async (progress, token) => {
        const options: Parameters<typeof runProvider>[2] = { token };
        if (settings.model !== "") {
          options.model = settings.model;
        }
        if (configDir !== undefined) {
          options.configDir = configDir;
        }
        for (const item of picked) {
          progress.report({ message: item.label, increment: 100 / picked.length });
          const inputDigest = pageContextInputDigest(document.model, item.page);
          const prompt = buildPageContextPrompt(document.model, item.page, labelFor(item.page), attestation);
          let text: string;
          try {
            text = (await runProvider(provider, prompt, options)).trim();
          } catch (error) {
            if (error instanceof ProviderRunCancelled) {
              throw error;
            }
            failed = { page: item.page, message: error instanceof Error ? error.message : String(error) };
            break;
          }
          if (text === "") {
            context.output.warn(`addPageContext: empty answer for page ${item.page}, skipped`);
            continue;
          }
          const entry: AiPageContext = {
            page: item.page,
            provider,
            generatedAt: new Date().toISOString(),
            text,
            inputDigest,
            promptVersion: PAGE_CONTEXT_PROMPT_VERSION,
            account: attestation.record.email,
          };
          if (settings.model !== "") {
            entry.model = settings.model;
          }
          generated.push(entry);
        }
      },
    );
  } catch (error) {
    if (error instanceof ProviderRunCancelled) {
      cancelled = true;
    } else {
      failed = { page: 0, message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (generated.length > 0) {
    context.provider.setAiPageContexts(document, generated);
  }
  const done = `${generated.length} page${generated.length === 1 ? "" : "s"} saved`;
  if (failed !== undefined) {
    const where = failed.page > 0 ? ` on page ${citationLabel(failed.page)}` : "";
    void window.showErrorMessage(
      `PDF Case Review: page context failed${where} (${failed.message}); later pages were not attempted. ${done}.`,
    );
    return generated.length > 0;
  }
  if (generated.length === 0) {
    return false;
  }
  void window.showInformationMessage(
    `PDF Case Review: AI context saved for ${generated.length} page${generated.length === 1 ? "" : "s"}` +
      `${cancelled ? " (cancelled before the rest)" : ""}; it renders above those pages in the next report.`,
  );
  return true;
}

export function registerAiPageContextCommand(context: CommandContext): Disposable[] {
  return [commands.registerCommand("pdfCaseReview.ai.addPageContext", () => addPageContext(context))];
}
