#!/usr/bin/env bash
set -euo pipefail

if command -v buf >/dev/null 2>&1; then
  exec buf "$@"
fi

if command -v go >/dev/null 2>&1; then
  GOPATH_BIN="$(go env GOPATH)/bin/buf"
  if [ -x "${GOPATH_BIN}" ]; then
    exec "${GOPATH_BIN}" "$@"
  fi
fi

echo "buf is not installed. Install it via 'go install github.com/bufbuild/buf/cmd/buf@latest' or add it to PATH." >&2
exit 127
