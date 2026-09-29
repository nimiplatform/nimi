#!/bin/sh
# Install nimi CLI + runtime binary into ~/.nimi/bin.

set -eu

REPO_OWNER="nimiplatform"
REPO_NAME="nimi"
INSTALL_ROOT="${HOME}/.nimi"
BIN_DIR="${INSTALL_ROOT}/bin"
INSTALL_MANIFEST_URL_DEFAULT=""
DRY_RUN=0
REQUESTED_VERSION=""
REQUESTED_TARGET=""

usage() {
  cat <<'EOF'
Install nimi CLI + runtime from an admitted release manifest.

Usage:
  NIMI_INSTALL_MANIFEST_URL=https://.../runtime/latest.json sh install.sh [--dry-run] [--version 0.2.0|runtime/v0.2.0]
  sh install.sh --dry-run --target <darwin-amd64|darwin-arm64|linux-amd64|linux-arm64>
EOF
}

log() {
  printf '%s\n' "$*"
}

# Errors go to stderr: several steps run inside command substitution.
fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

detect_platform_key() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *)
      fail "Unsupported platform: $(uname -s)"
      ;;
  esac
}

detect_archive_platform() {
  case "$(uname -s)" in
    Darwin) printf 'macos' ;;
    Linux) printf 'linux' ;;
    *)
      fail "Unsupported platform: $(uname -s)"
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *)
      fail "Unsupported architecture: $(uname -m)"
      ;;
  esac
}

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi
  fail "Missing required command: $1"
}

resolve_install_manifest_url() {
  manifest_url="$(printf '%s' "${NIMI_INSTALL_MANIFEST_URL:-}" | tr -d '\n' | sed 's/[[:space:]]//g')"
  if [ -n "$manifest_url" ]; then
    printf '%s' "$manifest_url"
    return 0
  fi
  if [ -n "$INSTALL_MANIFEST_URL_DEFAULT" ]; then
    printf '%s' "$INSTALL_MANIFEST_URL_DEFAULT"
    return 0
  fi
  fail "NIMI_INSTALL_MANIFEST_URL is required until the public runtime install channel is admitted."
}

fetch_install_manifest() {
  manifest_url="$1"
  need_cmd curl
  if ! response="$(curl -fsSL "$manifest_url")"; then
    fail "Failed to resolve latest runtime manifest from ${manifest_url}"
  fi
  printf '%s' "$response" | tr -d '\n'
}

extract_manifest_value() {
  manifest_json="$1"
  key="$2"
  printf '%s' "$manifest_json" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

extract_manifest_archive_field() {
  manifest_json="$1"
  platform_key="$2"
  field_name="$3"
  printf '%s' "$manifest_json" | sed -n "s/.*\"${platform_key}\"[[:space:]]*:[[:space:]]*{[^}]*\"${field_name}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

resolve_runtime_release_from_manifest() {
  manifest_url="$1"
  platform_key="$2"

  manifest_json="$(fetch_install_manifest "$manifest_url")"
  tag="$(extract_manifest_value "$manifest_json" tag)"
  version="$(extract_manifest_value "$manifest_json" version)"
  checksums_url="$(extract_manifest_value "$manifest_json" checksumsUrl)"
  archive="$(extract_manifest_archive_field "$manifest_json" "$platform_key" name)"
  archive_url="$(extract_manifest_archive_field "$manifest_json" "$platform_key" url)"

  if [ -z "$tag" ] || [ -z "$version" ] || [ -z "$checksums_url" ] || [ -z "$archive" ] || [ -z "$archive_url" ]; then
    fail "Latest runtime manifest is missing required fields for ${platform_key}"
  fi
  if ! runtime_tag="$(normalize_runtime_tag "$tag")" || [ "$runtime_tag" != "$tag" ] || [ "$(runtime_tag_version "$tag")" != "$version" ]; then
    fail "Manifest ${manifest_url} does not describe a Runtime release (tag ${tag}, version ${version})"
  fi

  printf '%s\n' "$tag"
  printf '%s\n' "$version"
  printf '%s\n' "$archive"
  printf '%s\n' "$archive_url"
  printf '%s\n' "$checksums_url"
}

# Runtime-only releases are tagged runtime/v<SemVer>; a bare version names that
# Runtime release, and another release owner's tag is refused.
normalize_runtime_tag() {
  case "$1" in
    runtime/v*) candidate="$1" ;;
    */*) return 1 ;;
    v*) candidate="runtime/$1" ;;
    *) candidate="runtime/v$1" ;;
  esac
  printf '%s' "$candidate" | grep -Eq '^runtime/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$' || return 1
  printf '%s' "$candidate"
}

# Archives carry the final Runtime version, also under a release-candidate tag.
runtime_tag_version() {
  version_value="${1#runtime/v}"
  printf '%s' "${version_value%-rc.*}"
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
  fail "Missing checksum tool: install shasum or sha256sum"
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
    --target)
      shift
      [ "$#" -gt 0 ] || {
        usage
        exit 1
      }
      REQUESTED_TARGET="$1"
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

if [ -n "$REQUESTED_TARGET" ]; then
  if [ "$DRY_RUN" -ne 1 ]; then
    fail "--target is admitted only for --dry-run inspection."
  fi
  case "$REQUESTED_TARGET" in
    darwin-amd64)
      platform_key="darwin"
      archive_platform="macos"
      arch="amd64"
      ;;
    darwin-arm64)
      platform_key="darwin"
      archive_platform="macos"
      arch="arm64"
      ;;
    linux-amd64)
      platform_key="linux"
      archive_platform="linux"
      arch="amd64"
      ;;
    linux-arm64)
      platform_key="linux"
      archive_platform="linux"
      arch="arm64"
      ;;
    *)
      fail "Unsupported dry-run target: ${REQUESTED_TARGET}"
      ;;
  esac
else
  platform_key="$(detect_platform_key)"
  archive_platform="$(detect_archive_platform)"
  arch="$(detect_arch)"
fi
if [ -n "$REQUESTED_VERSION" ]; then
  if ! tag="$(normalize_runtime_tag "$REQUESTED_VERSION")"; then
    fail "--version must name a Runtime release such as 0.2.0 or runtime/v0.2.0; ${REQUESTED_VERSION} is not one."
  fi
  version="$(runtime_tag_version "$tag")"
  archive="nimi-runtime_${version}_${archive_platform}_${arch}.tar.gz"
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}"
  archive_url="${base_url}/${archive}"
  checksums_url="${base_url}/checksums.txt"
elif [ "$DRY_RUN" -eq 1 ] && [ -z "${NIMI_INSTALL_MANIFEST_URL:-}" ]; then
  tag="runtime/v0.0.0"
  version="$(runtime_tag_version "$tag")"
  archive="nimi-runtime_${version}_${archive_platform}_${arch}.tar.gz"
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}"
  archive_url="${base_url}/${archive}"
  checksums_url="${base_url}/checksums.txt"
else
  manifest_url="$(resolve_install_manifest_url)"
  release_data="$(resolve_runtime_release_from_manifest "$manifest_url" "${platform_key}-${arch}")"
  tag="$(printf '%s\n' "$release_data" | sed -n '1p')"
  version="$(printf '%s\n' "$release_data" | sed -n '2p')"
  archive="$(printf '%s\n' "$release_data" | sed -n '3p')"
  archive_url="$(printf '%s\n' "$release_data" | sed -n '4p')"
  checksums_url="$(printf '%s\n' "$release_data" | sed -n '5p')"
fi
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

log "Installing Nimi ${tag} for ${platform_key}/${arch}"
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
  fail "Failed to find checksum for ${archive}"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  actual_checksum="$(calc_sha256 "${tmp_dir}/${archive}")"
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    fail "Checksum mismatch for ${archive}"
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
log "  4. Run: nimi status"
