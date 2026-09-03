"""PostToolUse style guard: flags em-dashes and British spellings in freshly written prose.

The writing rule in .claude/CLAUDE.md (avoid em-dashes; the repo also standardized on US
spelling) is stated in four files and was enforced nowhere. This hook feeds a reminder back to
the model right after an Edit/Write that violates it, scanning only the text the tool just added:
whole content for Markdown; for code, em-dashes anywhere and spelling in comment text only.

Unlike gate_commit.py this guard fails OPEN: style advice must never break editing, so any
unexpected payload or internal error exits 0. Exit 2 returns the findings to the model as
feedback (the write itself has already happened and is not rolled back).

Registered in .claude/settings.json and .codex/hooks.json (PostToolUse).
"""

import json
import re
import sys
from pathlib import Path

PROSE_SUFFIXES = {".md"}
CODE_SUFFIXES = {".ts", ".mts", ".cts", ".tsx", ".mjs", ".cjs", ".js", ".py"}
SKIP_PARTS = {"vendor", "node_modules", ".vitepress", "fixtures", "patches"}
SKIP_NAMES = {"CODE_OF_CONDUCT.md", "THIRD_PARTY_NOTICES.md"}

EM_DASH = "—"
# Deliberately modest: only words with no US false-positive risk. The repo intentionally writes
# "grey" and "cancelled"; they stay off this list. "analyses" is a valid US plural, hence no "es".
BRITISH_RE = re.compile(
    r"\b(behaviours?|colours?|favourites?|whilst|artefacts?|licences?"
    r"|analys(?:e|ed|ing)"
    r"|(?:organ|initial|optim|priorit|custom|normal|capital)is(?:e|ed|es|ing|ations?))\b",
    re.IGNORECASE,
)


def new_text(payload: dict) -> tuple[Path, str] | None:
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path")
    if not isinstance(file_path, str) or file_path == "":
        return None
    text = tool_input.get("content")
    if not isinstance(text, str):
        text = tool_input.get("new_string")
    if not isinstance(text, str):
        return None
    return Path(file_path), text


def should_check(path: Path, cwd: str) -> bool:
    try:
        relative = path.resolve().relative_to(Path(cwd).resolve())
    except ValueError:
        return False
    if path.name in SKIP_NAMES or path.name.endswith(".local.md"):
        return False
    if SKIP_PARTS.intersection(relative.parts):
        return False
    return path.suffix in PROSE_SUFFIXES or path.suffix in CODE_SUFFIXES


def comment_text(line: str, marker: str) -> str | None:
    """The comment part of a code line: after the first marker that is outside a string literal
    and not part of a URL scheme. Quote counting is a heuristic, good enough for a reminder."""
    start = 0
    while True:
        index = line.find(marker, start)
        if index == -1:
            return None
        before = line[:index]
        in_string = any(before.count(quote) % 2 == 1 for quote in ("\"", "'", "`"))
        if not in_string and not before.endswith(":"):
            return line[index + len(marker) :]
        start = index + len(marker)


def prose_lines(path: Path, text: str) -> list[str]:
    lines = text.splitlines()
    if path.suffix in PROSE_SUFFIXES:
        return lines
    marker = "#" if path.suffix == ".py" else "//"
    comments = []
    for line in lines:
        stripped = line.lstrip()
        if marker == "//" and (stripped.startswith("*") or stripped.startswith("/*")):
            comments.append(line)
            continue
        found = comment_text(line, marker)
        if found is not None:
            comments.append(found)
    return comments


def main() -> int:
    payload = json.load(sys.stdin)
    located = new_text(payload)
    if located is None:
        return 0
    path, text = located
    if not should_check(path, payload.get("cwd") or "."):
        return 0
    problems = []
    if path.suffix in CODE_SUFFIXES:
        for line in text.splitlines():
            if EM_DASH in line:
                problems.append(f"em-dash: {line.strip()[:100]}")
    for line in prose_lines(path, text):
        if path.suffix in PROSE_SUFFIXES and EM_DASH in line:
            problems.append(f"em-dash: {line.strip()[:100]}")
        for match in BRITISH_RE.finditer(line):
            problems.append(f'British spelling "{match.group(0)}": {line.strip()[:100]}')
    if not problems:
        return 0
    listing = "\n".join(f"  - {problem}" for problem in problems[:10])
    print(
        f"Style guard ({path.name}): the repo's writing rule (see CLAUDE.md) avoids em-dashes "
        "(use sentences, commas, colons or parentheses) and uses US spelling. The edit went "
        f"through; please fix these in a follow-up edit:\n{listing}",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        sys.exit(main())
    except Exception:
        sys.exit(0)
