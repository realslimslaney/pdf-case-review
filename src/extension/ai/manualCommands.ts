// Manual AI hand-off: copy the summary prompt to the clipboard, paste a summary back, and review
// or revoke the recorded consent. These work with `ai.provider` off; the copy path still goes
// through the eligibility gate because its content leaves the machine as soon as it is pasted.

import { commands, type Disposable, type ExtensionContext, env, type LogOutputChannel, window } from "vscode";

import { summaryInputDigest } from "../../core/ai/digest";
import { buildSummaryPrompt, SUMMARY_PROMPT_VERSION } from "../../core/ai/prompt";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import type { PdfDocument } from "../editor/pdfDocument";
import { aiSettings } from "../settings";
import { ensureAttestation } from "./consentGate";

/**
 * Digest captured at copy time, keyed by document. The pasted answer covers what the copied prompt
 * contained, so edits between copy and paste must leave the stored summary marked as possibly stale.
 */
const copiedPromptDigests = new Map<string, string>();

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
export async function markdownBody(document: PdfDocument): Promise<string> {
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
  const rendered = await renderReport(reportInputFromSidecar(document.model, inputContext), "markdown");
  return new TextDecoder().decode(rendered.bytes);
}

export async function copySummaryPrompt(context: CommandContext): Promise<boolean> {
  const document = activeDocument(context);
  if (!document) {
    return false;
  }
  const settings = aiSettings(document.uri, context.output);
  const gate = await ensureAttestation(document, {
    whoAmI: async () => null,
    provider: "manual",
    settings,
    globalState: context.extensionContext.globalState,
    editorProvider: context.provider,
  });
  if (!gate.ok) {
    context.output.info(`copySummaryPrompt refused: ${gate.reason}`);
    return false;
  }
  const prompt = buildSummaryPrompt(
    await markdownBody(document),
    { maxWords: settings.maxWords },
    gate.attestation,
  );
  copiedPromptDigests.set(document.uri.toString(), summaryInputDigest(document.model, settings.maxWords));
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
  const inputDigest = copiedPromptDigests.get(document.uri.toString());
  if (inputDigest !== undefined) {
    summary.inputDigest = inputDigest;
  }
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
