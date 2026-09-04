# Manual pass: untrusted workspace walk

Run before each stable cut and whenever trust gating, AI commands, or report output paths
change. Integration tests cover the runtime guards; this pass covers the lived sequence of
granting trust mid-session.

## Setup

1. Ensure workspace trust is on: `security.workspace.trust.enabled` must be true in the
   Extension Development Host.
2. F5, then open the `test/fixtures` folder in Restricted Mode (choose "No, I don't trust
   the authors" when prompted; use Workspace: Manage Workspace Trust to revoke if it was
   already trusted).

## Pass

1. In Restricted Mode, open `generated/case.pdf`. Viewing, highlighting, notes, and saving
   the sidecar must all work; reading and annotating never require trust.
2. Open the command palette and search "pdf case review". Every AI command (Summarize with
   AI, Copy Summary Prompt, Paste AI Summary, Choose AI Provider, Review AI Consent) must
   be absent or refuse with a clear trust explanation; nothing may spawn a CLI.
3. Generate a report. It must land only in a location inside the workspace or one you are
   explicitly asked to pick; the `report.outputFolder` setting must not be honored from
   workspace settings while untrusted.
4. Grant trust (Workspace: Manage Workspace Trust). Without reloading the window, the AI
   commands must appear and work, and workspace settings must take effect.
5. Revoke trust again. The AI surface must retract (a reload prompt from VS Code itself is
   acceptable here; note which happens).

## Record

Append a row per run:

| Date | Machine | Core loop works untrusted | AI fully hidden | Trust grant needs no reload | Notes |
|---|---|---|---|---|---|
