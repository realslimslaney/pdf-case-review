# Install a command-line AI assistant

PDF Case Review's AI features (the executive summary, page context, and letting an assistant read your
notes) run through a CLI assistant installed on your computer: Claude Code (from Anthropic) or Codex
(from OpenAI). This guide installs one and confirms the extension can find it. The extension works
fully without either; skip this page if you do not want AI features.

## Before you start

- A terminal. Inside VS Code, **View > Terminal** (or `` Ctrl+` ``, the key under Escape) opens one in
  your case folder.
- An account for the assistant you pick: Claude Code needs a paid Claude plan (Pro, Max, Team or
  Enterprise); Codex signs in with a ChatGPT account (a paid plan, or an API key).

## Install Claude Code

1. Run the installer for your system:

   ```powershell
   # Windows, in PowerShell
   irm https://claude.ai/install.ps1 | iex
   ```

   ```bash
   # macOS and Linux
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   Alternatives: `winget install Anthropic.ClaudeCode` on Windows, `brew install --cask claude-code` on
   a Mac.
2. On Windows, also install [Git for Windows](https://git-scm.com/downloads/win). It gives Claude Code
   a Bash shell to work in, which its tools prefer.
3. Open a new terminal, run `claude`, and sign in through the browser window that opens.
4. Type `/status` to confirm the signed-in account, then `/exit`.

Anthropic's [quickstart](https://code.claude.com/docs/en/quickstart) and
[terminal guide](https://code.claude.com/docs/en/terminal-guide) cover the first session. The
[Claude Code extension for VS Code](https://code.claude.com/docs/en/vs-code) adds a chat panel and
signs in with the same account.

## Install Codex

1. Run the installer for your system:

   ```powershell
   # Windows, in PowerShell
   irm https://chatgpt.com/codex/install.ps1 | iex
   ```

   ```bash
   # macOS and Linux
   curl -fsSL https://chatgpt.com/codex/install.sh | sh
   ```

   Alternatives: `brew install --cask codex` on a Mac, or `npm install -g @openai/codex` anywhere (the
   `npm` command comes with [Node.js](https://nodejs.org/en/download)).
2. Open a new terminal, run `codex`, and choose **Sign in with ChatGPT**.

The [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) lists the other sign-in
options; Codex also ships a [VS Code extension](https://learn.chatgpt.com/docs/codex/ide).

## Verify the extension can use it

1. Open your case folder in VS Code (a trusted folder; AI features only run in trusted folders) and
   open a PDF.
2. Run **PDF Case Review: Choose AI Provider...** from the Command Palette. It probes both CLIs and
   shows, next to each, the signed-in account or a one-line fix if the CLI was not found.
3. Pick the one you installed. `pdfCaseReview.ai.provider` is now set, and
   **PDF Case Review: Summarize with AI** will use it.

If the picker cannot find a CLI you just installed, open a new terminal (or restart VS Code) so the
updated `PATH` is picked up, then run the picker again.

## What next

- What the extension sends, and how the consent dialog works:
  [Use Claude Code or Codex as your reviewer](ai-reviewer.md).
- A personal login and a school login side by side:
  [Use personal and school Claude accounts](two-claude-accounts.md).
