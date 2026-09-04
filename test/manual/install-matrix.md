# Manual pass: fresh-machine install matrix

Run once against the 0.6.0 stable candidate and once against 1.0.0 (pre-release cells can
be filled earlier when the Marketplace listing is live). "Fresh" means a machine, VM, or
clean OS user profile that has never had the extension; a fresh `--profile` is the minimum
acceptable substitute.

## The grid

Each cell: install by that route, then run the full loop below.

| Route | Windows | macOS | Linux |
|---|---|---|---|
| VS Marketplace (VS Code) | | | |
| Open VSX (VSCodium) | | | |
| VSIX sideload from GitHub release | | | |

## Full loop per cell

1. Install (Marketplace/Open VSX search "PDF Case Review", or
   `code --install-extension realslimslaney.pdf-case-review`, or
   `code --install-extension pdf-case-review.vsix` from the GitHub release asset).
2. Open a folder containing any PDF you have rights to; open the PDF. It must open in the
   PDF Case Review viewer without any extra setup.
3. Create two highlights in different categories, attach a note to one, add a document
   note (Ctrl+Alt+D).
4. Close and reopen the PDF: everything persists; the sidecar file sits next to the PDF.
5. Generate a report (Ctrl+Alt+R) in Markdown, then in Word and PDF via Generate Report
   As. Open each output in its native app.
6. Record the installed version (Extensions view) and note anything that felt broken or
   confusing, however small.

## Record

Fill the grid cells with `version / date / ok` or a short failure note, and append detail
rows here:

| Date | Route | OS | Version | Result | Notes |
|---|---|---|---|---|---|
