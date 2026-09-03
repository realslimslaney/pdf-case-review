# How Claude Code and Codex know who you are

This page explains the mechanism behind
[Use personal and school Claude accounts](../how-to/two-claude-accounts.md), and why the extension's
consent dialog can name an email at all.

## One directory per login

Claude Code keeps its login, settings and history in one directory: `~/.claude` (on Windows,
`%USERPROFILE%\.claude`). The `CLAUDE_CONFIG_DIR` environment variable points it at a different
directory instead. Two directories, two independent logins: whichever one the variable names is the
account that runs. Codex works the same way with `CODEX_HOME`, which relocates its `~/.codex`
directory (Codex does not create the directory for you; Claude Code does).

This is why switching accounts never has to mean logging out. A login is a directory, and choosing an
account is choosing a directory: for one command, for one terminal, or for the whole computer.

## Who reads the variable

The variable is read by whatever process starts the CLI, so where it is set decides who is affected:

- Set for one command (`CLAUDE_CONFIG_DIR=... claude`), it affects that run only.
- Exported in a terminal, it affects every CLI started from that terminal, including a VS Code
  launched from it with `code .`.
- Stored at the user level (Windows) or in a shell profile (macOS and Linux), it becomes the default
  for the Claude Code VS Code extension and the desktop app, which read the environment they were
  launched with. On macOS, apps launched from the Dock or a launcher do not see shell variables,
  which is why the how-to launches VS Code from a terminal there.
- PDF Case Review does not rely on any of these. When an `ai.requiredAccount` rule selects an
  `ai.accounts` entry, the extension sets `CLAUDE_CONFIG_DIR` or `CODEX_HOME` on the CLI it spawns,
  for that run only, so your terminal and the Claude Code chat panel are untouched.

## Why the consent dialog can name an email

The CLI stores the signed-in identity in that same directory. Before any excerpt is sent, the
extension reads the email from the CLI's saved login (never by asking a model) and shows it in the
consent dialog; a `requiredAccount` rule compares against it and refuses a mismatch with no override.
The design record is ADR-0006 in [Architecture decisions](decisions.md).
