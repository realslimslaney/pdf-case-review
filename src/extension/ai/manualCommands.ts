// Manual AI hand-off: copy the summary prompt to the clipboard, paste a summary back, and review
// or revoke the recorded consent. These work with `ai.provider` off; the copy path still goes
// through the eligibility gate because its content leaves the machine as soon as it is pasted.

import { commands, type Disposable, type ExtensionContext, env, type LogOutputChannel, window } from "vscode";

import { AI_CONTEXT_SCOPES, type AiContextScope } from "../../core/ai/contextScope";
import { summaryInputDigest } from "../../core/ai/digest";
import { buildDocumentText, type DocumentTextResult } from "../../core/ai/documentText";
import { buildSummaryPrompt, hasSummaryContent, SUMMARY_PROMPT_VERSION } from "../../core/ai/prompt";
import type { Sidecar } from "../../core/sidecar/types";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { aiSettings } from "../settings";
import { ensureAttestation } from "./consentGate";

/**
 * Digest captured at copy time, kept in workspace state so it survives a window reload between copy
 * and paste. The pasted answer covers what the copied prompt contained, so edits in between must
 * leave the stored summary marked as possibly stale.
 */
interface CopiedPrompt {
  digest: string;
  scope: AiContextScope;
}

function copiedPromptKey(document: PdfDocument): string {
  return `pdfCaseReview.copiedPrompt:${document.uri.toString()}`;
}

function isCopiedPrompt(value: unknown): value is CopiedPrompt {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["digest"] === "string" &&
    typeof candidate["scope"] === "string" &&
    (AI_CONTEXT_SCOPES as readonly string[]).includes(candidate["scope"])
  );
}

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

/** The Markdown report body used as prompt context; never the PDF itself. */
/** `model` is the caller's snapshot: the digest stored beside a prompt must describe the same state. */
export async function markdownBody(document: PdfDocument, model: Sidecar = document.model): Promise<string> {
  const [{ renderReport }, { reportInputFromSidecar }] = await Promise.all([
    import("../../core/report/render"),
    import("../../core/report/fromSidecar"),
  ]);
  const inputContext: Parameters<typeof reportInputFromSidecar>[1] = {
    generatedAt: new Date().toISOString(),
    pageCount: document.info.pageCount,
    includeAiSummary: false,
  };
  if (document.pageLabels) {
    inputContext.pageLabels = document.pageLabels;
  }
  const rendered = await renderReport(reportInputFromSidecar(model, inputContext), "markdown");
  return new TextDecoder().decode(rendered.bytes);
}

export async function copySummaryPrompt(context: CommandContext): Promise<boolean> {
  const document = activeDocument(context);
  if (!document) {
    return false;
  }
  const settings = aiSettings(document.uri, context.output);
  let documentText: DocumentTextResult | undefined;
  if (settings.contextScope === "document-text") {
    const pages = await context.provider.collectDocumentText(document);
    if (pages.every((page) => page.text === null)) {
      void window.showErrorMessage(
        "PDF Case Review: the document text could not be read; keep the PDF open in the viewer and try again.",
      );
      return false;
    }
    documentText = buildDocumentText(pages);
  }
  if (!hasSummaryContent(document.model, settings.contextScope, documentText)) {
    void window.showInformationMessage(
      "PDF Case Review: nothing to summarize yet. Highlight passages or add notes first.",
    );
    return false;
  }
  const gate = await ensureAttestation(document, {
    whoAmI: async () => null,
    provider: "manual",
    settings,
    globalState: context.extensionContext.globalState,
    editorProvider: context.provider,
    contextScope: settings.contextScope,
    ...(documentText ? { documentTextCoverage: documentText } : {}),
  });
  if (!gate.ok) {
    context.output.info(`copySummaryPrompt refused: ${gate.reason}`);
    return false;
  }
  const model = document.model;
  const prompt = buildSummaryPrompt(
    await markdownBody(document, model),
    { maxWords: settings.maxWords },
    gate.attestation,
    documentText,
  );
  const copied: CopiedPrompt = {
    digest: summaryInputDigest(model, settings.maxWords, settings.contextScope),
    scope: settings.contextScope,
  };
  await context.extensionContext.workspaceState.update(copiedPromptKey(document), copied);
  await env.clipboard.writeText(`${prompt.system}\n\n${prompt.user}`);
  void window.showInformationMessage(
    "PDF Case Review: summary prompt copied. Paste it into your AI chat, copy the answer, then run " +
      "'Paste AI Summary'.",
  );
  return true;
}

export async function pasteSummary(context: CommandContext): Promise<boolean> {
  const document = activeDocument(context);
  if (!document) {
    return false;
  }
  const text = (await env.clipboard.readText()).trim();
  if (text === "") {
    void window.showWarningMessage("PDF Case Review: the clipboard is empty; copy the AI's answer first.");
    return false;
  }
  const summary: Parameters<PdfCaseReviewEditorProvider["setAiSummary"]>[1] = {
    provider: "manual",
    generatedAt: new Date().toISOString(),
    text,
    promptVersion: SUMMARY_PROMPT_VERSION,
  };
  const workspaceState = context.extensionContext.workspaceState;
  const copied = workspaceState.get<unknown>(copiedPromptKey(document));
  if (isCopiedPrompt(copied)) {
    summary.inputDigest = copied.digest;
    if (copied.scope === "document-text") {
      summary.contextScope = copied.scope;
    }
  }
  await workspaceState.update(copiedPromptKey(document), undefined);
  const account = document.model.aiConsent?.email;
  if (account !== undefined) {
    summary.account = account;
  }
  context.provider.setAiSummary(document, summary);
  void window.showInformationMessage(
    "PDF Case Review: AI summary saved with your notes; it will appear in the next report.",
  );
  return true;
}

export async function reviewConsent(context: CommandContext): Promise<void> {
  const document = activeDocument(context);
  if (!document) {
    return;
  }
  const consent = document.model.aiConsent;
  if (!consent) {
    void window.showInformationMessage("PDF Case Review: no AI consent is recorded for this document.");
    return;
  }
  const detail =
    `Account: ${consent.email}${consent.organization ? ` · ${consent.organization}` : ""} (${
      consent.verified ? "verified" : "unverified"
    })\n` +
    `Provider: ${consent.provider}\n` +
    `Context: ${consent.contextScope === "document-text" ? "notes and document text" : "notes only"}\n` +
    `Attested: ${consent.attestedAt}\n` +
    (consent.authorizationLine ? `Authorization line: "${consent.authorizationLine}"\n` : "") +
    `Document SHA-256: ${consent.documentSha256.slice(0, 12)}…`;
  const choice = await window.showInformationMessage(
    "AI consent recorded for this document",
    { modal: true, detail },
    "Revoke",
  );
  if (choice === "Revoke") {
    context.provider.clearAiConsent(document);
  }
}

export function registerAiManualCommands(context: CommandContext): Disposable[] {
  return [
    commands.registerCommand("pdfCaseReview.ai.copySummaryPrompt", () => copySummaryPrompt(context)),
    commands.registerCommand("pdfCaseReview.ai.pasteSummary", () => pasteSummary(context)),
    commands.registerCommand("pdfCaseReview.ai.reviewConsent", () => reviewConsent(context)),
  ];
}
