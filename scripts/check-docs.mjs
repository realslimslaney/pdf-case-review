// Deterministic docs drift check (`pnpm docs:check`): the reference docs promise to mirror what
// package.json contributes and what the sidecar schema defines, and the sidebar promises to list
// every page. This script fails when those promises break, so drift is caught in CI instead of by
// a reader. Prose accuracy stays with the docs-maintainer agent; only mechanical joins live here.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Intentional exceptions, each with the reason it is not drift.
const UNDOCUMENTED_COMMANDS = new Set([
  // Registered directly in extension.ts as a debug helper; deliberately not in contributes.commands
  // and deliberately not in the reference tables.
  "pdfCaseReview.debug.renderSampleReport",
]);

const findings = [];

function finding(area, message) {
  findings.push(`${area}: ${message}`);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
const nls = JSON.parse(read("package.nls.json"));
const schema = JSON.parse(read("schemas/review.schema.json"));
const settingsDoc = read("docs/reference/settings.md");
const commandsDoc = read("docs/reference/commands.md");
const keybindingsDoc = read("docs/reference/keybindings.md");
const sidecarDoc = read("docs/reference/sidecar.md");
const sidebarConfig = read("docs/.vitepress/config.mts");

function checkSettings() {
  const properties = packageJson.contributes.configuration.properties;
  for (const [key, definition] of Object.entries(properties)) {
    const row = settingsDoc.split("\n").find((line) => line.includes(`\`${key}\``));
    if (!row) {
      finding("settings", `\`${key}\` has no row in docs/reference/settings.md`);
      continue;
    }
    const defaultValue = definition.default;
    if (["string", "number", "boolean"].includes(typeof defaultValue)) {
      const rendered = typeof defaultValue === "string" ? defaultValue : String(defaultValue);
      if (rendered !== "" && !row.includes(rendered)) {
        finding("settings", `\`${key}\` row does not show its default (${JSON.stringify(defaultValue)})`);
      }
    }
    if (definition.scope !== "resource" && !row.includes(definition.scope)) {
      finding(
        "settings",
        `\`${key}\` has \`${definition.scope}\` scope but its row does not say so ` +
          "(the doc promises resource scope unless noted)",
      );
    }
  }
  const documented = settingsDoc.match(/`pdfCaseReview\.[A-Za-z.]+`/g) ?? [];
  for (const match of new Set(documented)) {
    const key = match.slice(1, -1);
    if (!(key in properties)) {
      finding("settings", `${match} is documented but not contributed in package.json`);
    }
  }
}

function checkCommands() {
  for (const command of packageJson.contributes.commands) {
    if (UNDOCUMENTED_COMMANDS.has(command.command)) {
      continue;
    }
    const nlsKey = command.title.replaceAll("%", "");
    const title = (nls[nlsKey] ?? command.title).replace(/\.\.\.$/, "");
    if (!commandsDoc.includes(title)) {
      finding("commands", `"${title}" (${command.command}) is not mentioned in docs/reference/commands.md`);
    }
  }
}

function checkKeybindings() {
  const documentedKeys = new Set(
    [...keybindingsDoc.matchAll(/ctrl\+alt\+([0-9a-z])/gi)].map((match) => match[1].toLowerCase()),
  );
  if (documentedKeys.has("1") && documentedKeys.has("9")) {
    for (const digit of "2345678") {
      documentedKeys.add(digit);
    }
  }
  for (const binding of packageJson.contributes.keybindings) {
    const match = binding.key.match(/^ctrl\+alt\+([0-9a-z])$/i);
    if (!match) {
      finding("keybindings", `unrecognized key shape "${binding.key}"; teach check-docs.mjs about it`);
      continue;
    }
    if (!documentedKeys.has(match[1].toLowerCase())) {
      finding("keybindings", `${binding.key} (${binding.command}) is not in docs/reference/keybindings.md`);
    }
  }
}

function propertyNames(definition) {
  if (definition.type === "array") {
    return Object.keys(definition.items?.properties ?? {});
  }
  return Object.keys(definition.properties ?? {});
}

function checkSidecarSchema() {
  for (const [name, definition] of Object.entries(schema.properties)) {
    if (name === "$schema") {
      continue;
    }
    if (!sidecarDoc.includes(`\`${name}\``)) {
      finding("sidecar", `top-level \`${name}\` is not documented in docs/reference/sidecar.md`);
      continue;
    }
    for (const field of propertyNames(definition)) {
      if (!sidecarDoc.includes(`\`${field}\``)) {
        finding("sidecar", `\`${name}\` field \`${field}\` is not documented in docs/reference/sidecar.md`);
      }
    }
  }
}

function markdownPages() {
  const pages = [];
  for (const quadrant of ["tutorials", "how-to", "reference", "explanation"]) {
    const directory = join(root, "docs", quadrant);
    for (const entry of readdirSync(directory)) {
      if (entry.endsWith(".md")) {
        pages.push(`/${quadrant}/${entry.slice(0, -3)}`);
      }
    }
  }
  return pages;
}

function checkSidebar() {
  for (const page of markdownPages()) {
    if (!sidebarConfig.includes(`"${page}"`)) {
      finding("sidebar", `${page}.md has no sidebar entry in docs/.vitepress/config.mts`);
    }
  }
  for (const [, link] of sidebarConfig.matchAll(/link:\s*"(\/[^"]+)"/g)) {
    try {
      statSync(join(root, "docs", `${link}.md`));
    } catch {
      finding("sidebar", `config.mts links ${link} but docs${link}.md does not exist`);
    }
  }
  if (read("docs/index.md").trim().length < 100) {
    finding("index", "docs/index.md is (nearly) empty; the site would deploy without a homepage");
  }
}

function skillDirectories(base) {
  try {
    return readdirSync(join(root, base)).filter((entry) => statSync(join(root, base, entry)).isDirectory());
  } catch {
    return [];
  }
}

function checkMirrors() {
  for (const skill of skillDirectories(".claude/skills")) {
    if (!skillDirectories(".agents/skills").includes(skill)) {
      finding("mirrors", `.claude/skills/${skill} has no Codex mirror in .agents/skills/${skill}`);
      continue;
    }
    const claudeSkill = read(`.claude/skills/${skill}/SKILL.md`);
    const codexSkill = read(`.agents/skills/${skill}/SKILL.md`);
    if (claudeSkill !== codexSkill) {
      finding("mirrors", `SKILL.md differs between .claude/skills/${skill} and .agents/skills/${skill}`);
    }
  }
  const agentFiles = readdirSync(join(root, ".claude/agents")).filter((entry) => entry.endsWith(".md"));
  for (const file of agentFiles) {
    const name = file.slice(0, -3);
    if (!skillDirectories(".agents/skills").includes(name)) {
      finding("mirrors", `.claude/agents/${file} has no Codex skill mirror in .agents/skills/${name}`);
    }
    try {
      statSync(join(root, ".codex/agents", `${name}.toml`));
    } catch {
      finding("mirrors", `.claude/agents/${file} has no Codex custom agent in .codex/agents/${name}.toml`);
    }
  }
}

checkSettings();
checkCommands();
checkKeybindings();
checkSidecarSchema();
checkSidebar();
checkMirrors();

if (findings.length > 0) {
  console.error(`docs:check found ${findings.length} problem(s):\n`);
  for (const entry of findings) {
    console.error(`  - ${entry}`);
  }
  console.error("\nFix the doc (or the allowlist in scripts/check-docs.mjs when intentional).");
  process.exit(1);
}
console.log("docs:check passed: reference docs, sidebar and agent mirrors are in sync.");
