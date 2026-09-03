---
name: pdfjs-upgrader
description: Perform a PDF.js (or upstream vscode-pdf) upgrade end to end, from the pin bump in pdfjs.lock.json through patch reconciliation and the full test ladder. Not for committing, releasing, or unrelated viewer work.
---

# PDF.js Upgrader

## Workflow

Upgrade the vendored PDF.js viewer. The pin lives in `pdfjs.lock.json` (`version`, `url`,
`sha256`, plus `upstreamReference` naming the `mathematic-inc/vscode-pdf` commit and the files
derived from it). `vendor/pdfjs/` is gitignored and produced by `pnpm prepare-pdfjs`. The weekly
`upstream-watch` workflow maintains a tracking issue with compare links; read it
(`gh issue view <n>`) when given one.

1. Update `pdfjs.lock.json`: new `version`, the matching `pdfjs-<version>-dist.zip` release URL,
   and the zip's real SHA-256 (download it and hash it yourself; never copy a hash from an issue
   or changelog).
2. `pnpm prepare-pdfjs --force`. If a patch in `patches/pdfjs/` fails to apply, rebase it against
   the new files; prefer deleting a patch whose change landed upstream. A new patch needs a header
   comment explaining why a runtime hook was impossible (ADR-0001; the goal is zero patches).
3. Skim the PDF.js release notes between the two versions for viewer API changes that touch our
   seam: `src/webview/pdfjsAdapter.ts` is the only file allowed to touch PDF.js internals, and the
   event/option names it relies on are listed in ADR-0003 and the spike log. Fix the adapter when
   an internal moved.
4. If the upstream `vscode-pdf` commit also moved, diff the files listed in
   `upstreamReference.derivedFiles` against upstream and port what matters. Those files keep their
   Apache-2.0 Mathematic Inc header plus the "Modified by" line; never strip either.
5. Prove it: `pnpm check`, `pnpm build`, `pnpm test:integration`, and `pnpm test:e2e` (needs
   `pnpm fixtures` first). The integration suite is the real gate; the spikes it encodes are
   exactly the things PDF.js upgrades break.
6. If tests fail, fix the adapter or the patches, not the tests. If the breakage is deeper than
   the adapter seam, stop and report what upstream changed instead of forcing it.

Boundaries:

- Never commit or push; report for the committer workflow.
- Never edit files under `vendor/` directly: they are regenerated. Changes go in `patches/pdfjs/`
  or the adapter.
- Never change `upstreamReference.derivedFiles` entries without porting the header rules.

Finish: report the old and new versions, the hash, patches applied/rebased/dropped, adapter
changes, derived-file ports, test results, and anything from the release notes worth a manual
look in the viewer (F5 against `test/fixtures`).
