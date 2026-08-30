# Security policy

The extension runs entirely on your machine. It reads the PDF you open, writes a sidecar file beside it (and, when permitted, annotations into the PDF), and makes **no network requests** unless you enable an AI provider, in which case only highlighted excerpts and notes are sent, after confirmation.

If you find a vulnerability (for example a way for a crafted PDF to escape the webview sandbox, or data leaving the machine without consent), please report it privately via GitHub's "Report a vulnerability" button on this repository rather than a public issue. You'll get an acknowledgement within a week.

Supported versions: the latest published release and the latest pre-release.
