// The one place that reads `pdfCaseReview.*` settings, validating at the boundary.

import { ConfigurationTarget, type LogOutputChannel, type Uri, window, workspace } from "vscode";
import type { RequiredAccountRule } from "../core/ai/consent";
import type { AiContextScope } from "../core/ai/documentText";
import { DEFAULT_PAGE_CONTEXT_MIN_HIGHLIGHTS } from "../core/ai/pageContext";
import { DEFAULT_MAX_WORDS } from "../core/ai/prompt";
import {
  CATEGORY_PRESETS,
  type Category,
  DEFAULT_CATEGORIES,
  isCategoryList,
  normalizeCategories,
  validateCategories,
  validatePresets,
} from "../core/categories";
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "../core/report/model";
import type { GroupBy } from "../core/tree";

export type SidecarLocation = "beside" | "folder";

export type ReportFormatSetting = "ask" | "markdown" | "docx" | "pdf";

export interface ReportSettings {
  defaultFormat: ReportFormatSetting;
  options: ReportOptions;
  /** Empty = beside the PDF; otherwise absolute or workspace-relative. */
  outputFolder: string;
  author: string;
  overwrite: boolean;
}

export function reportSettings(uri: Uri): ReportSettings {
  const configuration = workspace.getConfiguration("pdfCaseReview.report", uri);
  const defaultFormat = configuration.get<string>("defaultFormat", "ask");
  const organization = configuration.get<string>("organization", DEFAULT_REPORT_OPTIONS.organization);
  const quoteMaxChars = configuration.get<number>("quoteMaxChars", DEFAULT_REPORT_OPTIONS.quoteMaxChars);
  return {
    defaultFormat:
      defaultFormat === "markdown" || defaultFormat === "docx" || defaultFormat === "pdf"
        ? defaultFormat
        : "ask",
    options: {
      organization:
        organization === "category" || organization === "page" || organization === "both"
          ? organization
          : "none",
      quoteMaxChars:
        Number.isInteger(quoteMaxChars) && quoteMaxChars >= 0
          ? quoteMaxChars
          : DEFAULT_REPORT_OPTIONS.quoteMaxChars,
      includeEmptyCategories: configuration.get<boolean>("includeEmptyCategories", false) === true,
      usePageLabels: configuration.get<boolean>("usePageLabels", true) !== false,
    },
    outputFolder:
      typeof configuration.get("outputFolder") === "string"
        ? configuration.get<string>("outputFolder", "").trim()
        : "",
    author: typeof configuration.get("author") === "string" ? configuration.get<string>("author", "") : "",
    overwrite: configuration.get<boolean>("overwrite", false) === true,
  };
}

export type AiProviderSetting = "off" | "claude-cli" | "codex-cli";

export interface AiAccount {
  id: string;
  provider: "claude-cli" | "codex-cli";
  configDir: string;
}

export interface AiSettings {
  provider: AiProviderSetting;
  /** Empty = the provider's default model. */
  model: string;
  includeInReport: boolean;
  maxWords: number;
  requiredAccount: RequiredAccountRule[];
  accounts: AiAccount[];
  requireVerifiedAccountForProtected: boolean;
  pageContextMinHighlights: number;
  contextScope: AiContextScope;
}

function readRules(raw: unknown, warnings: string[]): RequiredAccountRule[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push("requiredAccount must be a list of rules");
    return [];
  }
  const rules: RequiredAccountRule[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      warnings.push("requiredAccount entries must be objects");
      continue;
    }
    const source = entry as Record<string, unknown>;
    const rule: RequiredAccountRule = {};
    if (typeof source["email"] === "string" && source["email"] !== "") {
      rule.email = source["email"];
    }
    if (typeof source["use"] === "string" && source["use"] !== "") {
      rule.use = source["use"];
    }
    const when = source["when"];
    if (typeof when === "object" && when !== null) {
      const conditions = when as Record<string, unknown>;
      const parsed: NonNullable<RequiredAccountRule["when"]> = {};
      if (typeof conditions["protected"] === "boolean") {
        parsed.protected = conditions["protected"];
      }
      if (typeof conditions["authorizationLineMatches"] === "string") {
        parsed.authorizationLineMatches = conditions["authorizationLineMatches"];
      }
      if (typeof conditions["pathGlob"] === "string") {
        parsed.pathGlob = conditions["pathGlob"];
      }
      if (Object.keys(parsed).length > 0) {
        rule.when = parsed;
      }
    }
    if (rule.email === undefined && rule.use === undefined) {
      warnings.push("a requiredAccount rule needs an email or a use");
      continue;
    }
    rules.push(rule);
  }
  return rules;
}

function readAccounts(raw: unknown, warnings: string[]): AiAccount[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push("accounts must be a list");
    return [];
  }
  const accounts: AiAccount[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      warnings.push("account entries must be objects");
      continue;
    }
    const source = entry as Record<string, unknown>;
    const id = source["id"];
    const provider = source["provider"];
    const configDir = source["configDir"];
    if (
      typeof id !== "string" ||
      id === "" ||
      (provider !== "claude-cli" && provider !== "codex-cli") ||
      typeof configDir !== "string" ||
      configDir === ""
    ) {
      warnings.push(`account "${typeof id === "string" ? id : "?"}" needs id, provider and configDir`);
      continue;
    }
    accounts.push({ id, provider, configDir });
  }
  return accounts;
}

export function aiSettings(uri: Uri, output: LogOutputChannel): AiSettings {
  const configuration = workspace.getConfiguration("pdfCaseReview.ai", uri);
  const provider = configuration.get<string>("provider", "off");
  const maxWords = configuration.get<number>("maxWords", DEFAULT_MAX_WORDS);
  const minHighlights = configuration.get<number>(
    "pageContext.minHighlights",
    DEFAULT_PAGE_CONTEXT_MIN_HIGHLIGHTS,
  );
  const warnings: string[] = [];
  const settings: AiSettings = {
    provider: provider === "claude-cli" || provider === "codex-cli" ? provider : "off",
    model: typeof configuration.get("model") === "string" ? configuration.get<string>("model", "") : "",
    includeInReport: configuration.get<boolean>("includeInReport", true) !== false,
    maxWords: Number.isInteger(maxWords) && maxWords > 0 ? maxWords : DEFAULT_MAX_WORDS,
    requiredAccount: readRules(configuration.get<unknown>("requiredAccount"), warnings),
    accounts: readAccounts(configuration.get<unknown>("accounts"), warnings),
    requireVerifiedAccountForProtected:
      configuration.get<boolean>("requireVerifiedAccountForProtected", true) !== false,
    pageContextMinHighlights:
      Number.isInteger(minHighlights) && minHighlights >= 2
        ? minHighlights
        : DEFAULT_PAGE_CONTEXT_MIN_HIGHLIGHTS,
    contextScope: configuration.get<string>("contextScope") === "document-text" ? "document-text" : "notes",
  };
  if (warnings.length > 0) {
    const detail = warnings.join("; ");
    output.warn(`pdfCaseReview.ai settings have invalid entries, ignoring them: ${detail}`);
    void window.showWarningMessage(`PDF Case Review: some AI settings are invalid (${detail}).`);
  }
  return settings;
}

/** Writes where the setting is defined (a workspace override would otherwise win over a user write). */
export async function setAiProvider(provider: AiProviderSetting, resource?: Uri): Promise<void> {
  const configuration = workspace.getConfiguration("pdfCaseReview.ai", resource);
  const inspected = configuration.inspect<string>("provider");
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? ConfigurationTarget.Workspace
        : ConfigurationTarget.Global;
  await configuration.update("provider", provider, target);
}

export function highlightsGroupBy(): GroupBy {
  const value = workspace.getConfiguration("pdfCaseReview.highlights").get<string>("groupBy", "category");
  return value === "page" ? "page" : "category";
}

/** Writes where the setting is defined (a workspace override would otherwise win over a user write). */
export async function setHighlightsGroupBy(groupBy: GroupBy): Promise<void> {
  const configuration = workspace.getConfiguration("pdfCaseReview.highlights");
  const inspected = configuration.inspect<string>("groupBy");
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? ConfigurationTarget.Workspace
        : ConfigurationTarget.Global;
  await configuration.update("groupBy", groupBy, target);
}

export function sidecarLocation(uri: Uri): SidecarLocation {
  const value = workspace.getConfiguration("pdfCaseReview.sidecar", uri).get<string>("location", "beside");
  return value === "folder" ? "folder" : "beside";
}

/** `pdfCaseReview.pdf.embedOnSave`: rewrite unencrypted PDFs with real annotations on save. */
export function embedOnSave(uri: Uri): boolean {
  return workspace.getConfiguration("pdfCaseReview.pdf", uri).get<boolean>("embedOnSave", true);
}

/** Built-in presets plus `pdfCaseReview.categoryPresets`; invalid presets are dropped with a warning. */
export function categoryPresets(output: LogOutputChannel): Record<string, Category[]> {
  const configured = workspace.getConfiguration("pdfCaseReview").get<unknown>("categoryPresets", {});
  const { presets, errors } = validatePresets(configured);
  if (errors.length > 0) {
    const detail = errors.map((error) => `${error.preset || "(setting)"}: ${error.message}`).join("; ");
    output.warn(`pdfCaseReview.categoryPresets has invalid entries, ignoring them: ${detail}`);
    void window.showWarningMessage(`PDF Case Review: some category presets are invalid (${detail}).`);
  }
  const merged: Record<string, Category[]> = {};
  for (const [name, categories] of Object.entries(CATEGORY_PRESETS)) {
    merged[name] = [...categories];
  }
  return { ...merged, ...presets };
}

/** `pdfCaseReview.categories`, or the defaults (with a warning) when the setting is invalid. */
export function configuredCategories(uri: Uri, output: LogOutputChannel): Category[] {
  const configured = workspace
    .getConfiguration("pdfCaseReview", uri)
    .get<unknown>("categories", [...DEFAULT_CATEGORIES]);
  if (!isCategoryList(configured)) {
    output.warn("pdfCaseReview.categories is not a list of {id, name, color} objects, using defaults");
    void window.showWarningMessage(
      "PDF Case Review: category settings must be a list of {id, name, color} objects. Using defaults.",
    );
    return [...DEFAULT_CATEGORIES];
  }
  const errors = validateCategories(configured);
  if (errors.length > 0) {
    const detail = errors.map((error) => `#${error.index + 1}: ${error.message}`).join("; ");
    output.warn(`pdfCaseReview.categories is invalid, using defaults: ${detail}`);
    void window.showWarningMessage(
      `PDF Case Review: category settings are invalid (${detail}). Using defaults.`,
    );
    return [...DEFAULT_CATEGORIES];
  }
  return normalizeCategories(configured);
}
