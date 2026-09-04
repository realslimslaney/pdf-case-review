# Manual pass: high contrast themes

Run before each stable cut and whenever viewer colors, tree icons, or the go-to flash change.
Automated tests cannot judge whether the palette actually reads; this pass can.

## Setup

1. F5 to launch the Extension Development Host on `test/fixtures`.
2. Open `generated/case.pdf` (run `pnpm fixtures` first if `generated/` is empty).
3. You will switch themes with Preferences: Color Theme. Do the whole pass twice: once in
   High Contrast (dark) and once in High Contrast Light.

## Pass

1. Switch to the high contrast theme. The viewer should adopt the PDF.js high contrast
   variant without a reload; page background, text, and toolbar must all remain legible.
2. Create one highlight per category (Fact, Financial, Strategic implication, Concern,
   Question). Every highlight must be distinguishable from the page and from each other;
   category identity may rely on the ring or border, never on the fill alone.
3. Open the Highlights view. Each tree item's category icon must be visible against the
   sidebar background, including the selected and hovered states.
4. Click a tree item to go to its highlight. The go-to flash must be visible in high
   contrast, and the highlight must remain visible after the flash ends.
5. Open the Note view (Ctrl+Alt+N) and type. Caret, text, borders, and the autosave
   indicator must all be visible.
6. Generate a Markdown report (Ctrl+Alt+R) and confirm the editor renders it legibly in
   the same theme.
7. Repeat steps 1 to 6 in the other high contrast theme.

## Record

Append a row per run:

| Date | Machine | HC dark ok | HC light ok | Worst finding | Notes |
|---|---|---|---|---|---|
