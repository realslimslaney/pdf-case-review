# Manual pass: screen reader spot check of the Note view

Run before each stable cut and whenever the Note view's markup or protocol changes. This is
a spot check of the note editing loop, not a full audit of the viewer (PDF.js ships its own
accessibility layer).

## Setup

1. Start a screen reader: NVDA on Windows, VoiceOver on macOS (Cmd+F5), Orca on Linux.
2. F5 to launch the Extension Development Host on `test/fixtures`.
3. Open `generated/case.pdf` and create one highlight.

## Pass

1. Focus the Note view with Ctrl+Alt+N. The screen reader must announce the view and which
   note target is being edited, not just "edit text".
2. Type a sentence. Characters and words must echo per the reader's settings.
3. Wait for autosave. The saved state must be perceivable without sight (an announcement or
   an accessible status, not only a color change).
4. Tab through the view. Every interactive element must be reachable in a sensible order
   and announce a meaningful label; no focus traps.
5. Switch to a page note (Ctrl+Alt+D) and back. Each switch must announce the new target
   so the user always knows where the note will land.
6. In the Highlights view, arrow through items. Each must announce its category and quote
   snippet, and Enter must move focus toward the highlight without stranding it.

## Record

Append a row per run:

| Date | Machine | Reader | Target announced | Autosave perceivable | Focus order sane | Notes |
|---|---|---|---|---|---|---|
