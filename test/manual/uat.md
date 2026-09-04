# UAT: working real cases on the pre-release

This is the M4 bake. The owner uses the extension for actual case prep, on the pre-release
build (0.5.x), for as long as it takes to trust it. The exit bar closes issue #14's bake
step: two courses' worth of cases worked, zero open P1 issues, owner sign-off.

Install the current pre-release VSIX from the GitHub release into the daily profile (or
from the Marketplace pre-release channel once the listing is live). Update when a new
0.5.x lands; note the build in the log.

## Severity

- **P1**: data loss (a highlight or note gone after save or reopen), a crash or hang, or
  a blocked core loop (cannot open, highlight, note, save, or generate a report). A P1
  blocks the stable cut until fixed.
- **P2**: wrong but recoverable (bad rendering, wrong report content, a command that
  errors but has a workaround). Fix during the bake when cheap, else file for later.
- **P3**: friction (extra clicks, confusing wording, slow moments). Log it; batches of P3s
  become follow-up issues.

File each P1/P2 as a GitHub issue while it is fresh; P3s can stay as log notes.

## Per-case loop

1. Open the case PDF from your course folder. Note open time if it feels slow.
2. Read and highlight as you naturally would, across at least three categories.
3. Attach notes to the highlights that deserve them; add a page note and a document note
   (Ctrl+Alt+D) somewhere real.
4. Generate the report (Ctrl+Alt+R) when done reading; skim it as if prepping for class.
   Try Word or PDF output at least once per course.
5. If AI is set up, run Summarize with AI (or the copy/paste path) on at least some cases
   and judge whether the consent flow and the marked output feel right.
6. Next day: reopen the PDF before class. Everything must be exactly as left.
7. Log the session below.

## Exit bar

- Cases from two different courses worked end to end.
- Zero open P1 issues.
- Owner declares UAT done; the stable candidate (0.6.0) may then be cut.

## Session log

| Date | Case (course only, no publisher) | Build | P1 | P2 | P3 | Issues filed | Notes |
|---|---|---|---|---|---|---|---|
