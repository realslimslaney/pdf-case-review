# Work with scanned PDFs

A scanned PDF contains page images and no text layer, so there is nothing to select and no quote
to capture. PDF Case Review still works on these documents; this page explains what changes and
how to get real text back.

## What works without a text layer

- The document opens and renders normally.
- You can still mark passages: switch the highlight tool on (the marker icon in the viewer
  toolbar) and draw over the region you care about. This creates a free highlight, a marked
  region rather than a quoted passage.
- Free highlights carry notes like any other highlight, appear in the Highlights view as
  `[image region]`, and render in reports the same way, with their page citation and note.
- Free highlights live in the sidecar only. They are not embedded into the PDF on save, so they
  do not appear in other PDF readers.

## What does not work

- The selection-based flows need text: the floating highlight button, `Ctrl+Alt+1..9` on a
  selection, and quote capture all require a text layer.
- A highlight whose text could not be captured shows `(no text captured)` in the view and the
  report. On a scanned page that is expected; add a note to say what the passage is.

## Get a text layer with OCR

The reliable fix is to run OCR once and read the OCRed copy. [ocrmypdf](https://ocrmypdf.readthedocs.io/)
adds an invisible text layer under the scanned image without changing how the page looks:

```sh
ocrmypdf scanned-case.pdf case-with-text.pdf
```

Open `case-with-text.pdf` in PDF Case Review and every text feature works: selection highlighting,
quote capture, category shortcuts and quoted reports. OCR quality varies with scan quality; spot
check a few captured quotes against the page image.

PDF Case Review never runs OCR itself and never modifies your original file.
