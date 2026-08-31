# Keybindings

`Ctrl` is `Cmd` on macOS throughout. Rebind any of these in VS Code's Keyboard Shortcuts editor
(search for "PDF Case Review").

## While the PDF editor has focus

| Keys | Command |
|---|---|
| `Ctrl+Alt+1` … `Ctrl+Alt+9` | Highlight the current text selection with the Nth category; with no selection, recolor the highlight selected in the tree (or the last created one). |
| `Ctrl+Alt+N` | Edit the note of the selected highlight (or the current page's note) in the Note view. |
| `Ctrl+Alt+D` | Add a document note. |
| `Ctrl+S` | Save through VS Code (sidecar first, then the PDF when allowed). PDF.js's own save is disabled. |
| `Ctrl+Z` / `Ctrl+Y` | Undo and redo highlight edits through PDF.js. |

## While any PDF Case Review document is active

| Keys | Command |
|---|---|
| `Ctrl+Alt+R` | Generate the report. |
| `Ctrl+Alt+G` | Go to a highlight: jumps straight to the tree's selected highlight, otherwise shows a picker of every highlight. |
| `Ctrl+Alt+H` | Focus the Highlights view. |

## Keyboard paths without a binding

Every command is reachable from the Command Palette under the **PDF Case Review** category, and
each one invoked without a selection falls back to the Highlights view's selection or shows a
picker. The views themselves are keyboard-navigable: arrow keys move through the Highlights
tree (Enter opens a row's target), and the Note view is an ordinary form (the textarea autosaves
on input and blur, and saves are announced to screen readers).
