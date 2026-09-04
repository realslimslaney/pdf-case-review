// The Configure hub behind the gear in the editor title bar: one place that fans out to the
// pieces which are otherwise JSON-only. Its guided account flow writes `pdfCaseReview.ai.accounts`
// and `requiredAccount`, then opens a sign-in terminal with the login directory on the environment.

import { commands, type Disposable, type Uri, window, workspace } from "vscode";
import {
  accountIdsIn,
  defaultConfigDir,
  mergeAccountSettings,
  type NewAccountInput,
  validAccountId,
} from "../../core/ai/accounts";
import { DEFAULT_MAX_WORDS } from "../../core/ai/prompt";
import type { ActiveDocumentTracker } from "../editor/activeDocument";
import { definedTarget, valueAt } from "../settings";
import { isDesktopHost } from "../util/host";

interface HubItem {
  label: string;
  description?: string;
  run: () => Thenable<unknown> | Promise<unknown>;
}

export async function configure(tracker: ActiveDocumentTracker): Promise<void> {
  // Resource-scoped settings need the active PDF, or a workspace-folder override stays invisible.
  const resource = tracker.active?.uri;
  const items: HubItem[] = [
    {
      label: "$(sparkle) Choose AI Provider...",
      description: "Claude Code, Codex, manual copy and paste, or off",
      run: () => commands.executeCommand("pdfCaseReview.ai.chooseProvider"),
    },
    {
      label: "$(person-add) Add an AI Account...",
      description: "A second CLI login (say, a school account) with its own directory",
      run: () => addAiAccount(resource),
    },
    {
      label: "$(shield) Review AI Consent",
      description: "What was attested for the active document",
      run: () => commands.executeCommand("pdfCaseReview.ai.reviewConsent"),
    },
    {
      label: "$(text-size) Summary Length...",
      description: `Word budget for the AI summary, currently ${currentMaxWords(resource)} words`,
      run: () => setSummaryLength(resource),
    },
    {
      label: "$(symbol-color) Apply Category Preset...",
      description: "Business case, academic paper, contract, or your own",
      run: () => commands.executeCommand("pdfCaseReview.applyCategoryPreset"),
    },
    {
      label: "$(edit) Edit Categories in Settings",
      run: () => commands.executeCommand("workbench.action.openSettings", "pdfCaseReview.categories"),
    },
    {
      label: "$(settings-gear) All PDF Case Review Settings",
      run: () =>
        commands.executeCommand("workbench.action.openSettings", "@ext:realslimslaney.pdf-case-review"),
    },
  ];
  const picked = await window.showQuickPick(items, { placeHolder: "Configure PDF Case Review" });
  await picked?.run();
}

function currentMaxWords(resource: Uri | undefined): number {
  const value = workspace
    .getConfiguration("pdfCaseReview.ai", resource)
    .get<number>("maxWords", DEFAULT_MAX_WORDS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_WORDS;
}

async function setSummaryLength(resource: Uri | undefined): Promise<void> {
  const entered = await window.showInputBox({
    prompt: "Word budget for the AI executive summary",
    value: String(currentMaxWords(resource)),
    validateInput: (value) =>
      /^\d+$/.test(value.trim()) && Number(value) > 0 ? undefined : "Enter a whole number greater than zero.",
  });
  if (entered === undefined) {
    return;
  }
  const configuration = workspace.getConfiguration("pdfCaseReview.ai", resource);
  await configuration.update("maxWords", Number(entered.trim()), definedTarget(configuration, "maxWords"));
}

const PROVIDERS = [
  { label: "Claude Code", id: "claude-cli" as const, cli: "claude", envVar: "CLAUDE_CONFIG_DIR" },
  { label: "Codex", id: "codex-cli" as const, cli: "codex login", envVar: "CODEX_HOME" },
];

async function addAiAccount(resource: Uri | undefined): Promise<void> {
  const provider = await window.showQuickPick(PROVIDERS, {
    placeHolder: "Which CLI is the account for?",
  });
  if (!provider) {
    return;
  }
  const configuration = workspace.getConfiguration("pdfCaseReview.ai", resource);
  const target = definedTarget(configuration, "accounts");
  const rawAccounts = valueAt<unknown[]>(configuration, "accounts", target) ?? [];
  const usedIds = accountIdsIn(asList(configuration.get<unknown>("accounts", [])));
  const id = await window.showInputBox({
    prompt: "A short name for the account; rules select it by this id",
    value: "school",
    validateInput: (value) =>
      !validAccountId(value)
        ? "Use lowercase letters, digits and dashes, starting with a letter or digit."
        : usedIds.has(value)
          ? "This id is already in pdfCaseReview.ai.accounts."
          : undefined,
  });
  if (!id) {
    return;
  }
  const configDir = await window.showInputBox({
    prompt: "Login directory for this account (created when you first sign in)",
    value: defaultConfigDir(provider.id, id),
    validateInput: (value) => (value.trim() === "" ? "A directory is required." : undefined),
  });
  if (!configDir) {
    return;
  }
  const scope = await pickScope();
  if (!scope) {
    return;
  }
  const rulesTarget = definedTarget(configuration, "requiredAccount");
  const merged = mergeAccountSettings(
    asList(rawAccounts),
    asList(valueAt<unknown[]>(configuration, "requiredAccount", rulesTarget)),
    { id, provider: provider.id, configDir, scope },
  );
  await configuration.update("accounts", merged.accounts, target);
  if (scope.kind !== "none") {
    await configuration.update("requiredAccount", merged.rules, rulesTarget);
  }
  if (!isDesktopHost()) {
    void window.showInformationMessage(
      `PDF Case Review: account "${id}" saved. Sign in from a desktop machine: set ${provider.envVar} to ${configDir} and run ${provider.cli}.`,
    );
    return;
  }
  const choice = await window.showInformationMessage(
    `PDF Case Review: account "${id}" saved to your settings. Sign in once so ${configDir} holds the login.`,
    "Sign in now",
  );
  if (choice !== "Sign in now") {
    return;
  }
  const { expandHome } = await import("../desktop/identity");
  const terminal = window.createTerminal({
    name: `${provider.label} sign-in (${id})`,
    env: { [provider.envVar]: expandHome(configDir) },
  });
  terminal.show();
  terminal.sendText(provider.cli, true);
}

async function pickScope(): Promise<NewAccountInput["scope"] | undefined> {
  const picked = await window.showQuickPick(
    [
      {
        label: "Only for PDFs under a folder...",
        description: "A path glob decides; wins over existing catch-all rules",
        scope: "folder" as const,
      },
      {
        label: "Only for protected PDFs",
        description: "Publisher-encrypted documents use this account",
        scope: "protected" as const,
      },
      {
        label: "Always",
        description: "The fallback whenever no earlier rule matches",
        scope: "always" as const,
      },
      {
        label: "No rule",
        description: "Just save the account; write pdfCaseReview.ai.requiredAccount yourself",
        scope: "none" as const,
      },
    ],
    { placeHolder: "When should this account be used?" },
  );
  if (!picked) {
    return undefined;
  }
  if (picked.scope !== "folder") {
    return { kind: picked.scope };
  }
  const pathGlob = await window.showInputBox({
    prompt: "Path glob for the PDFs that must use this account",
    value: "**/cases/**",
    validateInput: (value) => (value.trim() === "" ? "A glob is required." : undefined),
  });
  return pathGlob ? { kind: "folder", pathGlob } : undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function registerConfigureCommand(context: { tracker: ActiveDocumentTracker }): Disposable[] {
  return [commands.registerCommand("pdfCaseReview.configure", () => configure(context.tracker))];
}
