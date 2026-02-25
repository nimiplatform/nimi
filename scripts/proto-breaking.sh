#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASELINE_PATH="${PROJECT_ROOT}/runtime/proto/runtime-v1.baseline.binpb"

if [ ! -s "${BASELINE_PATH}" ]; then
  echo "[proto:breaking] failed: baseline is missing or empty: ${BASELINE_PATH}" >&2
  echo "[proto:breaking] run: (cd runtime && make proto-baseline)" >&2
  exit 1
fi

cd "${PROJECT_ROOT}/proto"
"${SCRIPT_DIR}/run-buf.sh" breaking --against "${BASELINE_PATH}"
