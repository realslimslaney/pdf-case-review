// Vendors the pinned PDF.js prebuilt viewer into vendor/pdfjs.
//
//   pnpm prepare-pdfjs           download (if needed), verify sha256, unzip, apply patches, verify assets
//   pnpm prepare-pdfjs --force   redo even when vendor/pdfjs/.version already matches the lockfile
//   pnpm prepare-pdfjs --maps    keep the *.map files (default: dropped, they are ~2/3 of the archive)
//
// The lockfile is pdfjs.lock.json. Patches live in patches/pdfjs/*.patch (ideally none; see
// docs/explanation/decisions.md) and are applied with `git apply --directory=vendor/pdfjs`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const root = dirname(import.meta.dirname);
const lock = JSON.parse(readFileSync(join(root, "pdfjs.lock.json"), "utf8"));
const target = join(root, "vendor", "pdfjs");
const stampFile = join(target, ".version");
const patchesDir = join(root, "patches", "pdfjs");
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const keepMaps = args.has("--maps");

const requiredAssets = [
  "LICENSE",
  "build/pdf.mjs",
  "build/pdf.worker.mjs",
  "build/pdf.sandbox.mjs",
  "web/viewer.html",
  "web/viewer.mjs",
  "web/viewer.css",
  "web/locale/locale.json",
  "web/cmaps/LICENSE",
  "web/iccs/CGATS001Compat-v2-micro.icc",
  "web/standard_fonts/LICENSE_FOXIT",
  "web/wasm/openjpeg.wasm",
  "web/images/annotation-note.svg",
];

// The editor provider rewrites viewer.html by exact string replacement; if PDF.js changes
// these tags the replacement silently stops matching, so fail loudly here instead.
const rewrittenTags = [
  '<link rel="resource" type="application/l10n" href="locale/locale.json" />',
  '<script src="../build/pdf.mjs" type="module"></script>',
  '<script src="viewer.mjs" type="module"></script>',
  '<link rel="stylesheet" href="viewer.css" />',
  "<title>PDF.js viewer</title>",
  'http-equiv="Content-Security-Policy"',
];

function stamp() {
  return `${lock.version}${keepMaps ? "+maps" : ""}`;
}

async function download() {
  process.stdout.write(`Downloading PDF.js ${lock.version} …\n`);
  const response = await fetch(lock.url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} for ${lock.url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== lock.sha256) {
    throw new Error(`sha256 mismatch for ${lock.url}\n  expected ${lock.sha256}\n  actual   ${digest}`);
  }
  return bytes;
}

function extract(zipBytes) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const entries = unzipSync(zipBytes);
  let written = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    if (!keepMaps && name.endsWith(".map")) continue;
    if (name.endsWith("compressed.tracemonkey-pldi-09.pdf")) continue;
    const dest = join(target, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    written += 1;
  }
  process.stdout.write(`Extracted ${written} files to vendor/pdfjs\n`);
}

function applyPatches() {
  if (!existsSync(patchesDir)) return;
  const patches = readdirSync(patchesDir)
    .filter((name) => name.endsWith(".patch"))
    .sort();
  for (const patch of patches) {
    process.stdout.write(`Applying ${patch} …\n`);
    execFileSync("git", ["apply", "--directory=vendor/pdfjs", join(patchesDir, patch)], {
      cwd: root,
      stdio: "inherit",
    });
  }
}

function verify() {
  for (const asset of requiredAssets) {
    if (!existsSync(join(target, asset))) {
      throw new Error(`Missing PDF.js asset after extraction: ${asset}`);
    }
  }
  const viewerHtml = readFileSync(join(target, "web", "viewer.html"), "utf8");
  for (const tag of rewrittenTags) {
    const count = viewerHtml.split(tag).length - 1;
    if (count !== 1) {
      throw new Error(`Expected exactly one occurrence in viewer.html, found ${count}: ${tag}`);
    }
  }
  const locales = Object.values(JSON.parse(readFileSync(join(target, "web/locale/locale.json"), "utf8")));
  for (const locale of locales) {
    if (!existsSync(join(target, "web", "locale", locale))) {
      throw new Error(`Missing locale file: ${locale}`);
    }
  }
  process.stdout.write(`PDF.js ${lock.version} verified (${locales.length} locales).\n`);
}

async function main() {
  if (!force && existsSync(stampFile) && readFileSync(stampFile, "utf8").trim() === stamp()) {
    process.stdout.write(`vendor/pdfjs already at ${stamp()} (use --force to redo)\n`);
    verify();
    return;
  }
  const zipBytes = await download();
  extract(zipBytes);
  applyPatches();
  verify();
  writeFileSync(stampFile, `${stamp()}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
