// `$(sparkle) Claude Code · school` while a PDF is active in a trusted workspace: the AI provider
// and the account the document would run under, one click from the provider picker. The text
// comes from settings and rules alone; the signed-in identity is probed afterwards, cached, and
// only lands in the tooltip.

import { MarkdownString, StatusBarAlignment, ThemeColor, window, workspace } from "vscode";

import { type AccountResolution, type AiProvider, PROVIDER_LABEL } from "../../core/ai/accounts";
import type { ProviderIdentity } from "../../core/ai/identity";
import { aiStatusText, describeRule } from "../../core/ai/status";
import { resolveDocumentAccount } from "../ai/documentFacts";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import type { PdfCaseReviewEditorProvider } from "../editor/pdfCaseReviewEditorProvider";
import { readAiSettings } from "../settings";
import { Disposable } from "../util/disposable";
import { isDesktopHost } from "../util/host";

export interface AiStatusSnapshot {
  visible: boolean;
  text: string;
  tooltip: string;
}

function identityLine(identity: ProviderIdentity): string {
  if (!identity.loggedIn || identity.email === null) {
    return identity.detail ? `Not signed in (${identity.detail}).` : "Not signed in.";
  }
  const organization = identity.organization ? ` · ${identity.organization}` : "";
  return `Signed in as \`${identity.email}\`${organization}.`;
}

export class AiProviderStatusBar extends Disposable {
  private readonly item = this._register(
    window.createStatusBarItem("pdfCaseReview.aiProvider", StatusBarAlignment.Left, 49),
  );
  private generation = 0;
  private visible = false;
  private readonly identities = new Map<string, Promise<ProviderIdentity>>();

  constructor(
    private readonly tracker: ActiveDocumentTracker,
    private readonly editorProvider: PdfCaseReviewEditorProvider,
  ) {
    super();
    this.item.name = "PDF Case Review AI";
    this.item.command = "pdfCaseReview.ai.chooseProvider";
    this._register(this.tracker.onDidChange(() => this.refresh()));
    this._register(
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("pdfCaseReview.ai", this.tracker.active?.uri)) {
          this.identities.clear();
          this.refresh();
        }
      }),
    );
    this._register(workspace.onDidGrantWorkspaceTrust(() => this.refresh()));
    this.refresh();
  }

  snapshot(): AiStatusSnapshot {
    const tooltip = this.item.tooltip;
    return {
      visible: this.visible,
      text: this.item.text,
      tooltip: tooltip instanceof MarkdownString ? tooltip.value : (tooltip ?? ""),
    };
  }

  refresh(): void {
    this.generation += 1;
    void this.update(this.generation);
  }

  private async update(generation: number): Promise<void> {
    const document = this.tracker.active;
    if (!document || !workspace.isTrusted) {
      this.visible = false;
      this.item.hide();
      return;
    }
    const { settings } = readAiSettings(document.uri);
    const desktop = isDesktopHost();
    const provider = settings.provider;
    let resolution: AccountResolution | undefined;
    if (provider !== "off") {
      resolution = await resolveDocumentAccount(document, this.editorProvider, settings, provider);
      if (generation !== this.generation || this.isDisposed) {
        return;
      }
    }
    const status = aiStatusText({ provider, resolution, desktop });
    this.item.text = status.text;
    this.item.backgroundColor = status.warning
      ? new ThemeColor("statusBarItem.warningBackground")
      : undefined;
    const lines = this.describe(provider, resolution, desktop);
    this.item.tooltip = tooltip(lines);
    this.visible = true;
    this.item.show();

    if (!desktop || provider === "off" || !resolution) {
      return;
    }
    if (resolution.kind !== "resolved" && resolution.kind !== "none") {
      return;
    }
    const configDir = resolution.kind === "resolved" ? resolution.account.configDir : undefined;
    const identity = await this.identity(provider, configDir);
    if (generation !== this.generation || this.isDisposed) {
      return;
    }
    this.item.tooltip = tooltip([lines[0] ?? "", identityLine(identity), ...lines.slice(1)]);
  }

  private describe(
    provider: "off" | AiProvider,
    resolution: AccountResolution | undefined,
    desktop: boolean,
  ) {
    const lines: string[] = [];
    if (provider === "off") {
      lines.push("AI is off: the manual Copy Summary Prompt and Paste AI Summary commands still work.");
    } else {
      const label = PROVIDER_LABEL[provider];
      switch (resolution?.kind) {
        case "resolved":
          lines.push(`${label} · account "${resolution.accountId}" (\`${resolution.account.configDir}\`).`);
          lines.push(`Selected by rule: ${describeRule(resolution.rule)}.`);
          break;
        case "missingForProvider":
          lines.push(
            `${label} · the rule for this document selects "${resolution.accountId}", which is only ` +
              `registered for ${resolution.providers.map((entry) => PROVIDER_LABEL[entry]).join(", ")}.`,
          );
          lines.push(
            "Runs are refused until that id gets an entry for this provider (Configure > Add an AI Account...).",
          );
          break;
        case "unknownId":
          lines.push(
            `${label} · the rule for this document selects "${resolution.accountId}", which is not in pdfCaseReview.ai.accounts.`,
          );
          break;
        case "needsAuthorizationLine":
          lines.push(
            `${label} · a rule needs the document's authorization line; it is read once the viewer has loaded.`,
          );
          break;
        default:
          lines.push(`${label} · default login.`);
      }
      if (!desktop) {
        lines.push("CLI providers need desktop VS Code.");
      }
    }
    lines.push("Click to switch the AI provider.");
    return lines;
  }

  private identity(provider: AiProvider, configDir: string | undefined): Promise<ProviderIdentity> {
    const key = `${provider}|${configDir ?? ""}`;
    let pending = this.identities.get(key);
    if (!pending) {
      pending = import("../desktop/identity").then((desktop) =>
        configDir === undefined
          ? provider === "claude-cli"
            ? desktop.whoAmIClaude()
            : desktop.whoAmICodex()
          : desktop.whoAmIForAccount({ provider, configDir }),
      );
      this.identities.set(key, pending);
    }
    return pending;
  }
}

function tooltip(lines: string[]): MarkdownString {
  return new MarkdownString(lines.join("  \n"));
}
