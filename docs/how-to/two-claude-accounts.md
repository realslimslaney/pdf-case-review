# Use personal and school Claude accounts

Many students have two Claude logins: a personal subscription and one their school provides for
course material. Licensed case PDFs should only be processed under the school account, but logging
out and back in for every switch is slow and easy to forget. This guide keeps both logins installed at
once and gives you one command to switch. Codex is covered at the end.

## How Claude Code knows who you are

Claude Code keeps its login, settings and history in one directory: `~/.claude` (on Windows,
`%USERPROFILE%\.claude`). The `CLAUDE_CONFIG_DIR` environment variable points it at a different
directory instead. Two directories, two independent logins: whichever one the variable names is the
account that runs. This guide uses `~/.claude` for personal (the default, nothing to change) and
`~/.claude-school` for school.

## 1. Create the school login once

Run Claude Code with the variable set and sign in with the school account when the browser opens:

```powershell
# Windows, PowerShell
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-school"; claude
```

```bash
# macOS and Linux
CLAUDE_CONFIG_DIR=~/.claude-school claude
```

Type `/status` inside the session to confirm which account is signed in, then `/exit`.

## 2. Add switcher commands to your shell

Paste one of the blocks below into your shell profile so four commands are always available:

- `claude-school` and `claude-personal` start one session under that account, without changing
  anything else.
- `claude-which` prints which account this terminal uses and which one is the computer-wide default.
- `claude-use school` or `claude-use personal` changes the computer-wide default, which is what the
  Claude Code VS Code extension and the desktop app use (see step 3).

### Windows (PowerShell)

Open your profile with `notepad $PROFILE` (create it if Notepad asks) and add:

```powershell
$script:ClaudeSchoolDir = Join-Path $HOME '.claude-school'

function claude-school {
    $env:CLAUDE_CONFIG_DIR = $script:ClaudeSchoolDir
    claude @args
}

function claude-personal {
    Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
    claude @args
}

function claude-which {
    $session = if ($env:CLAUDE_CONFIG_DIR -eq $script:ClaudeSchoolDir) { 'school' }
        elseif ($env:CLAUDE_CONFIG_DIR) { "custom ($env:CLAUDE_CONFIG_DIR)" } else { 'personal' }
    $persistent = [Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR', 'User')
    $default = if ($persistent -eq $script:ClaudeSchoolDir) { 'school' }
        elseif ($persistent) { "custom ($persistent)" } else { 'personal' }
    Write-Host "This terminal:   $session"
    Write-Host "PC-wide default: $default  (VS Code extension and desktop app use this)"
}

function claude-use {
    param([Parameter(Mandatory)][ValidateSet('personal', 'school')][string]$Account)
    $value = if ($Account -eq 'school') { $script:ClaudeSchoolDir } else { $null }
    [Environment]::SetEnvironmentVariable('CLAUDE_CONFIG_DIR', $value, 'User')
    if ($value) { $env:CLAUDE_CONFIG_DIR = $value }
    else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    Write-Host "PC-wide default is now '$Account'. Fully restart VS Code or the desktop app to use it."
}
```

Open a new terminal (or run `. $PROFILE`) and try `claude-which`. If PowerShell refuses to load the
profile, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### macOS and Linux (bash or zsh)

Add to `~/.zshrc` (macOS default) or `~/.bashrc`:

```bash
CLAUDE_SCHOOL_DIR="$HOME/.claude-school"
CLAUDE_DEFAULT_FILE="$HOME/.claude-default-account"
if [ "$(cat "$CLAUDE_DEFAULT_FILE" 2>/dev/null)" = school ]; then
    export CLAUDE_CONFIG_DIR="$CLAUDE_SCHOOL_DIR"
fi

claude-school()   { CLAUDE_CONFIG_DIR="$CLAUDE_SCHOOL_DIR" claude "$@"; }
claude-personal() { env -u CLAUDE_CONFIG_DIR claude "$@"; }

claude-which() {
    local session=personal default=personal
    [ "$CLAUDE_CONFIG_DIR" = "$CLAUDE_SCHOOL_DIR" ] && session=school
    [ -n "$CLAUDE_CONFIG_DIR" ] && [ "$session" = personal ] && session="custom ($CLAUDE_CONFIG_DIR)"
    [ "$(cat "$CLAUDE_DEFAULT_FILE" 2>/dev/null)" = school ] && default=school
    echo "This terminal:  $session"
    echo "Default:        $default  (new terminals, and VS Code when launched from one)"
}

claude-use() {
    case "$1" in
        school)   echo school > "$CLAUDE_DEFAULT_FILE"; export CLAUDE_CONFIG_DIR="$CLAUDE_SCHOOL_DIR" ;;
        personal) echo personal > "$CLAUDE_DEFAULT_FILE"; unset CLAUDE_CONFIG_DIR ;;
        *) echo "usage: claude-use school|personal" >&2; return 1 ;;
    esac
    echo "Default is now '$1'. Open a new terminal, and launch VS Code from it with: code ."
}
```

Run `source ~/.zshrc` (or `~/.bashrc`) and try `claude-which`.

## 3. Make VS Code and the desktop app follow

The Claude Code VS Code extension and the Claude desktop app read `CLAUDE_CONFIG_DIR` from the
environment they were launched with, so they follow the default, not the terminal you happen to have
open.

- **Windows**: `claude-use school` stores the variable at the user level. Quit VS Code completely
  (**File > Exit**, not just the window or a reload) and reopen it; the extension's chat panel now
  uses the school login.
- **macOS and Linux**: apps launched from the Dock or a launcher do not see shell variables. After
  `claude-use school`, open a new terminal in your case folder and start VS Code from it with `code .`
  so it inherits the variable. (If `code` is not found, run **Shell Command: Install 'code' command in
  PATH** from the Command Palette once.)

Run `/status` in the extension's chat to check which account it is using.

## 4. Let the extension choose the account for you

For the built-in executive summary you do not need to switch at all. Register the school directory
in PDF Case Review's settings and add a rule saying which documents must use it; the extension then
runs the CLI with `CLAUDE_CONFIG_DIR` set for that run only and verifies the signed-in email before
anything is sent:

```jsonc
// settings.json
"pdfCaseReview.ai.accounts": [
  { "id": "school", "provider": "claude-cli", "configDir": "~/.claude-school" }
],
"pdfCaseReview.ai.requiredAccount": [
  { "when": { "protected": true }, "email": "you@school.edu", "use": "school" }
]
```

The **Configure...** gear in the viewer's title bar has an **Add an AI Account...** flow that writes both
settings and opens a sign-in terminal. Details, including rules by folder or by the document's own
authorization line, are in
[Use Claude Code or Codex as your reviewer](ai-reviewer.md#two-accounts-without-logging-out).

## 5. Optional: make the personal account ask before reading school files

If your school cases live in one folder, tell the personal login to ask before reading anything in it.
Then a slip (running `claude` in the wrong terminal and asking about a case) prompts instead of
silently sending licensed text under the wrong account. In the personal profile's
`~/.claude/settings.json`:

```jsonc
{
  "permissions": {
    "ask": ["Read(/Users/you/School/**)"]
  }
}
```

On Windows write the path with forward slashes: `Read(C:/Users/you/School/**)`. The school profile has
its own `~/.claude-school/settings.json` and needs no rule.

## Codex

Codex works the same way with `CODEX_HOME`, which relocates its `~/.codex` directory. Unlike Claude
Code, Codex does not create the directory for you, so make it first, then sign in:

```bash
# macOS and Linux
mkdir -p ~/.codex-school && CODEX_HOME=~/.codex-school codex
```

```powershell
# Windows, PowerShell
New-Item -ItemType Directory -Force "$HOME\.codex-school" | Out-Null
$env:CODEX_HOME = "$HOME\.codex-school"; codex
```

Register it for the extension with `"provider": "codex-cli"` and `"configDir": "~/.codex-school"` in
`pdfCaseReview.ai.accounts`. The switcher functions above translate directly: replace
`CLAUDE_CONFIG_DIR` with `CODEX_HOME` and `claude` with `codex`.

## Troubleshooting

- **The consent dialog names the wrong email.** Nothing has been sent. Click **Wrong account? Show how
  to switch**, or add the rule from step 4 so the extension picks the account itself.
- **VS Code still shows the old account after `claude-use`.** A window reload is not enough; quit the
  application fully and reopen it. On a Mac, launch it from a terminal with `code .`.
- **Which account is this terminal?** `claude-which`, or `/status` inside a session.
- **Fallback**: run `claude`, type `/logout`, then `claude` again and sign in with the account you
  need. This changes the login inside whichever directory is active.
