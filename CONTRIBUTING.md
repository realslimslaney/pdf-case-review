# Contributing

Thanks for your interest. Until 1.0 the project is moving fast and the maintainer is a single person, so **please open an issue or discussion before a pull request** for anything larger than a typo fix.

## Setup

- Node 22+ and pnpm (`npm i -g pnpm`).
- `pnpm install && pnpm prepare-pdfjs && pnpm fixtures && pnpm build`
- `pnpm check` runs typecheck, Biome and the unit tests; `pnpm test:integration` runs the headless VS Code suite.
- F5 launches the extension against `test/fixtures`.
- A `.devcontainer` is provided if you prefer a container or Codespaces.

## Rules of the road

- Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `test:`, `chore:`); release-please builds the changelog from them.
- Feature branches + pull requests only; `main` is protected.
- `src/core/` stays pure (no `vscode`, DOM or Node); `src/extension/` avoids Node built-ins outside `desktop/` so the web host keeps working.
- All PDF.js internals stay behind `src/webview/pdfjsAdapter.ts`; avoid patches to `vendor/pdfjs` unless a runtime hook is impossible, and document why in the patch header.
- Never write to a user's PDF outside the dual-write sync, and never strip encryption or permissions from a PDF.
- New bundled dependencies must be pure JS and recorded in `THIRD_PARTY_NOTICES.md`.
- Versioning: pre-releases use odd minor versions (`0.1.x`, `0.3.x`) and stable releases even ones.

## Reporting security issues

See `SECURITY.md`.
