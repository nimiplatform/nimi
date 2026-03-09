#!/bin/sh
# Install nimi CLI + runtime binary into ~/.nimi/bin.

set -eu

REPO_OWNER="nimiplatform"
REPO_NAME="nimi"
INSTALL_ROOT="${HOME}/.nimi"
BIN_DIR="${INSTALL_ROOT}/bin"
DRY_RUN=0
REQUESTED_VERSION=""

usage() {
  cat <<'EOF'
Install nimi CLI + runtime.

Usage:
  sh install.sh [--dry-run] [--version v0.2.0]
EOF
}

log() {
  printf '%s\n' "$*"
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

detect_platform() {
  case "$(uname -s)" in
    Darwin) printf 'macos' ;;
    Linux) printf 'linux' ;;
    *)
      log "Unsupported platform: $(uname -s)"
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *)
      log "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac
}

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi
  log "Missing required command: $1"
  exit 1
}

fetch_latest_tag() {
  need_cmd curl
  if ! response="$(curl -fsSL "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest")"; then
    log "Failed to resolve latest Nimi release tag from GitHub"
    exit 1
  fi
  tag="$(printf '%s' "$response" | tr -d '\n' | sed -n 's/.*"tag_name":"\([^"]*\)".*/\1/p')"
  if [ -z "$tag" ]; then
    log "Failed to resolve latest release tag"
    exit 1
  fi
  printf '%s' "$tag"
}

normalize_tag() {
  case "$1" in
    v*) printf '%s' "$1" ;;
    *) printf 'v%s' "$1" ;;
  esac
}

calc_sha256() {
  file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  log "Missing checksum tool: install shasum or sha256sum"
  exit 1
}

append_path_once() {
  shell_rc="$1"
  line='export PATH="$HOME/.nimi/bin:$PATH"'

  [ -n "$shell_rc" ] || return 0

  if [ ! -f "$shell_rc" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '[dry-run] create %s\n' "$shell_rc"
    else
      : >"$shell_rc"
    fi
  fi

  if grep -F "$line" "$shell_rc" >/dev/null 2>&1; then
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] append PATH update to %s\n' "$shell_rc"
    return 0
  fi

  {
    printf '\n# nimi\n'
    printf '%s\n' "$line"
  } >>"$shell_rc"
}

setup_path() {
  append_path_once "${HOME}/.zshrc"
  append_path_once "${HOME}/.bashrc"
  append_path_once "${HOME}/.profile"
}

extract_binary() {
  archive_path="$1"
  tmp_dir="$2"

  need_cmd tar
  run_cmd tar -xzf "$archive_path" -C "$tmp_dir"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --version)
      shift
      [ "$#" -gt 0 ] || {
        usage
        exit 1
      }
      REQUESTED_VERSION="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

platform="$(detect_platform)"
arch="$(detect_arch)"
if [ "$DRY_RUN" -eq 1 ] && [ -z "$REQUESTED_VERSION" ]; then
  tag="v0.0.0"
else
  tag="$(normalize_tag "${REQUESTED_VERSION:-$(fetch_latest_tag)}")"
fi
version="${tag#v}"
archive="nimi-runtime_${version}_${platform}_${arch}.tar.gz"
base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}"
archive_url="${base_url}/${archive}"
checksums_url="${base_url}/checksums.txt"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

log "Installing Nimi ${tag} for ${platform}/${arch}"
log "Archive: ${archive}"

if [ "$DRY_RUN" -eq 1 ]; then
  log "[dry-run] would download ${archive_url}"
  log "[dry-run] would download ${checksums_url}"
else
  need_cmd curl
  curl -fsSL "$archive_url" -o "${tmp_dir}/${archive}"
  curl -fsSL "$checksums_url" -o "${tmp_dir}/checksums.txt"
fi

expected_checksum="$(awk -v name="$archive" '$2 == name { print $1 }' "${tmp_dir}/checksums.txt" 2>/dev/null || true)"
if [ "$DRY_RUN" -eq 0 ] && [ -z "$expected_checksum" ]; then
  log "Failed to find checksum for ${archive}"
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  actual_checksum="$(calc_sha256 "${tmp_dir}/${archive}")"
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    log "Checksum mismatch for ${archive}"
    exit 1
  fi
fi

run_cmd mkdir -p "$BIN_DIR"
if [ "$DRY_RUN" -eq 0 ]; then
  extract_binary "${tmp_dir}/${archive}" "$tmp_dir"
  run_cmd install -m 0755 "${tmp_dir}/nimi" "${BIN_DIR}/nimi"
fi

setup_path

log ""
log "Installed to ${BIN_DIR}/nimi"
log "Next steps:"
log "  1. Ensure ${BIN_DIR} is on your PATH"
log "  2. Run: nimi start"
log "  3. Run: nimi doctor"
log "  4. Run: nimi run \"What is Nimi?\""
