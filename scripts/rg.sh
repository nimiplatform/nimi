#!/usr/bin/env bash
set -euo pipefail

if command -v rg >/dev/null 2>&1; then
  exec rg "$@"
fi

for candidate in \
  "/Applications/Codex.app/Contents/Resources/rg" \
  "${HOME}/.local/bin/rg" \
  "/opt/homebrew/bin/rg" \
  "/usr/local/bin/rg"
do
  if [ -x "${candidate}" ]; then
    exec "${candidate}" "$@"
  fi
done

printf 'missing required tool: rg\n' >&2
printf 'hint: install ripgrep, or ensure Codex bundled rg is available\n' >&2
exit 127
