#!/bin/bash
# PreToolUse hook: auto-inject nearest module AGENTS.md into Claude's context
# when Read, Edit, or Write is called on files within this repo.
set -euo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Repo root = two levels up from this script (.claude/hooks/ -> repo root)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Only handle files inside this repo
if [[ "$FILE_PATH" != "$REPO_ROOT/"* ]]; then
  exit 0
fi

# Skip _external directory
if [[ "$FILE_PATH" == *"/_external/"* ]]; then
  exit 0
fi

# Walk up from file directory to find nearest module-level AGENTS.md
# Stop before repo root (root AGENTS.md is already synced into CLAUDE.md)
DIR="$(dirname "$FILE_PATH")"
AGENTS_FILE=""
while [[ "$DIR" != "$REPO_ROOT" && "$DIR" != "/" ]]; do
  if [[ -f "$DIR/AGENTS.md" ]]; then
    AGENTS_FILE="$DIR/AGENTS.md"
    break
  fi
  DIR="$(dirname "$DIR")"
done

if [[ -z "$AGENTS_FILE" ]]; then
  exit 0
fi

# Make path relative for readability
REL_PATH="${AGENTS_FILE#$REPO_ROOT/}"

CONTENT=$(cat "$AGENTS_FILE")

# Inject AGENTS.md content as additionalContext
jq -n \
  --arg ctx "[Auto-injected module rules from $REL_PATH]"$'\n\n'"$CONTENT" \
  '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": $ctx
    }
  }'
