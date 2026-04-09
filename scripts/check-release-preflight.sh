#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/nimi-coding/.local/report/release"
LOG_STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE_DEFAULT="${LOG_DIR}/preflight-${LOG_STAMP}.log"
LOG_FILE="${NIMI_RELEASE_PREFLIGHT_LOG_FILE:-${LOG_FILE_DEFAULT}}"
CURRENT_SECTION="bootstrap"
CURRENT_COMMAND=""
TAIL_LINES_ON_FAILURE="${NIMI_RELEASE_PREFLIGHT_TAIL_LINES:-80}"

mkdir -p "${LOG_DIR}"
touch "${LOG_FILE}"

log_both() {
  printf '%s\n' "$*" | tee -a "${LOG_FILE}"
}

log_file_only() {
  printf '%s\n' "$*" >>"${LOG_FILE}"
}

print_log_tail() {
  log_both ""
  log_both "last ${TAIL_LINES_ON_FAILURE} log lines:"
  tail -n "${TAIL_LINES_ON_FAILURE}" "${LOG_FILE}" | sed 's/^/  | /'
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  log_both ""
  log_both "release preflight failed"
  log_both "section: ${CURRENT_SECTION}"
  if [ -n "${CURRENT_COMMAND}" ]; then
    log_both "command: ${CURRENT_COMMAND}"
  fi
  log_both "line: ${line_no}"
  log_both "log: ${LOG_FILE}"
  print_log_tail
  exit "${exit_code}"
}

on_exit() {
  local exit_code="$1"
  if [ "${exit_code}" -eq 0 ]; then
    log_both ""
    log_both "release preflight checks passed"
    log_both "log: ${LOG_FILE}"
  fi
}

trap 'on_error $? ${LINENO}' ERR
trap 'on_exit $?' EXIT

section() {
  CURRENT_SECTION="$1"
  log_both ""
  log_both "==> $1"
}

run_cmd() {
  local status=0
  CURRENT_COMMAND="$*"
  log_both "+ $*"
  "$@" >>"${LOG_FILE}" 2>&1 || status=$?
  if [ "${status}" -ne 0 ]; then
    log_both "✖ failed (exit ${status})"
    return "${status}"
  fi
  log_both "✓ ok"
  CURRENT_COMMAND=""
}

resolve_bin() {
  local name="$1"
  if command -v "${name}" >/dev/null 2>&1; then
    command -v "${name}"
    return 0
  fi

  case "${name}" in
    golangci-lint|actionlint)
      local go_bin
      go_bin="$(go env GOPATH 2>/dev/null)/bin/${name}"
      if [ -x "${go_bin}" ]; then
        printf '%s\n' "${go_bin}"
        return 0
      fi
      ;;
    zizmor)
      local cargo_bin
      cargo_bin="${HOME}/.cargo/bin/${name}"
      if [ -x "${cargo_bin}" ]; then
        printf '%s\n' "${cargo_bin}"
        return 0
      fi
      ;;
  esac

  return 1
}

require_bin() {
  local name="$1"
  local hint="$2"
  local resolved
  if ! resolved="$(resolve_bin "${name}")"; then
    printf 'missing required tool: %s\nhint: %s\n' "${name}" "${hint}" >&2
    exit 127
  fi
  printf '%s\n' "${resolved}"
}

cd "${PROJECT_ROOT}"

GOLANGCI_LINT_BIN="$(require_bin "golangci-lint" "go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.8")"
ACTIONLINT_BIN="$(require_bin "actionlint" "go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.11")"
DETECT_SECRETS_BIN="$(require_bin "detect-secrets-hook" "python3 -m pip install detect-secrets==1.5.0")"
ZIZMOR_BIN="$(require_bin "zizmor" "cargo install --locked zizmor")"

section "Workspace Tests"
run_cmd pnpm test

section "Runtime Chain"
(
  cd runtime
  run_cmd go build ./...
  run_cmd go vet ./...
  run_cmd go test ./...
  run_cmd go run ./cmd/runtime-compliance --gate
)

section "Proto"
run_cmd pnpm proto:generate
run_cmd pnpm proto:lint
run_cmd pnpm proto:breaking
run_cmd pnpm proto:drift-check

section "Repo Lint"
run_cmd pnpm lint

section "Security"
CURRENT_COMMAND="git ls-files -z | xargs -0 ${DETECT_SECRETS_BIN} --baseline .secrets.baseline"
log_both "+ ${CURRENT_COMMAND}"
git ls-files -z | xargs -0 "${DETECT_SECRETS_BIN}" --baseline .secrets.baseline >>"${LOG_FILE}" 2>&1
CURRENT_COMMAND=""
log_both "✓ ok"
run_cmd "${ZIZMOR_BIN}" --no-online-audits --min-severity high --collect workflows --collect dependabot -- .github/workflows .github/dependabot.yml
run_cmd cargo audit --file apps/desktop/src-tauri/Cargo.lock

section "Workflow Lint"
run_cmd "${ACTIONLINT_BIN}" -color

section "Runtime Release Dry Run"
run_cmd go run github.com/goreleaser/goreleaser/v2@latest check --config .goreleaser.yml
run_cmd go run github.com/goreleaser/goreleaser/v2@latest release --clean --snapshot --skip=publish --skip=announce --config .goreleaser.yml

section "Coverage And Release Smoke"
run_cmd pnpm check:sdk-coverage
run_cmd pnpm check:runtime-go-coverage
run_cmd pnpm check:sdk-version-matrix
run_cmd pnpm check:sdk-consumer-smoke
run_cmd pnpm check:npm-binary-smoke
run_cmd pnpm build:install-gateway
run_cmd pnpm check:desktop-mods-smoke

section "Runtime Go Lint"
(
  cd runtime
  run_cmd "${GOLANGCI_LINT_BIN}" run
)
