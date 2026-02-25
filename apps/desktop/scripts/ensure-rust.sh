#!/usr/bin/env bash
# Ensure Rust toolchain is available for Tauri builds.
# Called from postinstall — installs rustup + stable toolchain if missing.

set -euo pipefail

# Check if cargo is already available
if command -v cargo &>/dev/null; then
  echo "[ensure-rust] cargo found: $(cargo --version)"
  exit 0
fi

# Also check common install location not yet in PATH
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
  if command -v cargo &>/dev/null; then
    echo "[ensure-rust] cargo found (after sourcing ~/.cargo/env): $(cargo --version)"
    exit 0
  fi
fi

echo "[ensure-rust] cargo not found — installing Rust via rustup..."

# Detect platform
case "$(uname -s)" in
  Linux|Darwin)
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "[ensure-rust] Windows detected."
    echo "[ensure-rust] Please install Rust manually: https://rustup.rs"
    echo "[ensure-rust] After installing, restart your terminal and run 'pnpm install' again."
    exit 1
    ;;
  *)
    echo "[ensure-rust] Unsupported platform: $(uname -s)"
    echo "[ensure-rust] Please install Rust manually: https://rustup.rs"
    exit 1
    ;;
esac

echo "[ensure-rust] Rust installed: $(cargo --version)"
