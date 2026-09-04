# Set up categories

Categories are how highlights carry meaning: each one has a name and a color, and the color is
what you pick in the viewer. The defaults suit a business case: Fact, Financial, Strategic
implication, Concern, Question.

## Change the palette for new documents

Set `pdfCaseReview.categories` in your settings (user for everywhere, workspace for one course
or project):

```json
"pdfCaseReview.categories": [
  { "id": "claim", "name": "Claim", "color": "#FFFF98" },
  { "id": "evidence", "name": "Evidence", "color": "#53FFBC" },
  { "id": "doubt", "name": "Doubt", "color": "#FF4F5F" }
]
```

Rules: each `id` is lowercase letters, digits or dashes; each `color` is `#RRGGBB` and must be
unique, because the color is how the viewer tells categories apart. An invalid setting falls
back to the defaults with a warning.

## Use a preset

**PDF Case Review: Apply Category Preset...** replaces the setting with a built-in palette
(`Business case`, `Academic paper`, `Contract`) or one of your own from
`pdfCaseReview.categoryPresets`. Presets you define use the same item shape as `categories`.

## Documents keep their own palette

Every sidecar records the categories it was created with, so a settings change never silently
recolors existing documents. To bring an open document up to date, run **PDF Case Review: Sync
Categories from Settings**; it offers to save and reload the viewer so the new colors apply.
Highlights whose category no longer exists appear under **Uncategorized** until you re-assign
them.

## Pick categories while reading

- The **category dropdown in the viewer toolbar** (next to the highlight button) sets the
  category for new highlights: pick one, then select text and highlight as usual. It starts on
  the palette's first category and follows the color picker.
- `Ctrl+Alt+1` to `Ctrl+Alt+9` (`Cmd+Alt` on macOS) highlight the current selection with the
  Nth category of the document's palette.
- The viewer's highlight color picker shows the same palette; picking a color there is picking
  a category.
- **Set Category** on a row of the Highlights view, or the category dropdown in the Note view,
  re-categorize an existing highlight.
