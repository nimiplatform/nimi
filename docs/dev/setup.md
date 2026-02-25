# Development Setup

This guide covers setting up a local development environment for all Nimi components.

## Prerequisites

| Tool | Version | Used By |
|------|---------|---------|
| Node.js | 24+ | SDK, Desktop, Web, Mods |
| pnpm | 10+ | Monorepo package manager |
| Go | 1.24+ | Runtime |
| Rust | latest stable | Desktop (Tauri backend) |
| Buf CLI | latest | Proto schema management |
| Protoc | 3.21+ | Protobuf compiler (used by Buf) |

### macOS

```bash
# Node.js + pnpm
brew install node
npm install -g pnpm

# Go
brew install go

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Buf CLI
brew install bufbuild/buf/buf

# Tauri system dependencies
xcode-select --install
```

### Linux (Ubuntu/Debian)

```bash
# Node.js (via fnm)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24

# pnpm
npm install -g pnpm

# Go
sudo snap install go --classic

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Buf
npm install -g @bufbuild/buf

# Tauri system dependencies
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

## Clone and Install

```bash
git clone https://github.com/nimiplatform/nimi.git
cd nimi

# Install Node.js dependencies
pnpm install

# Build SDK (required before apps/desktop + apps/web)
pnpm build:sdk
```

## Component Development

### Runtime (Go)

```bash
cd runtime

# Build
go build -o nimi ./cmd/nimi

# Run
./nimi serve

# Test
go test ./...

# Lint
go vet ./...
golangci-lint run
```

### SDK (TypeScript)

```bash
cd sdk

# Build all packages
pnpm build

# Test
pnpm test

# Type check
pnpm exec tsc --noEmit
```

### Desktop (Tauri + React)

```bash
# Terminal A: watch single mod (nimi-mods repo)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
pnpm -C "$NIMI_MODS_ROOT" install
pnpm -C "$NIMI_MODS_ROOT" run watch -- --mod local-chat

# Terminal B: desktop shell / renderer (must set both env vars)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"

# Renderer only (fast iteration)
pnpm --filter @nimiplatform/desktop dev:renderer

# Full Tauri shell (requires Rust)
pnpm --filter @nimiplatform/desktop dev:shell

# Build
pnpm build
```

### Web

```bash
pnpm dev:web
```

### Proto

```bash
# Lint proto files
buf lint proto/

# Check for breaking changes
buf breaking proto/ --against .git#branch=main

# Regenerate stubs
buf generate

# Verify no drift (CI does this)
git diff --exit-code runtime/gen/ sdk/packages/runtime/generated/
```

## IDE Setup

### VS Code

Recommended extensions:

- Go (`golang.go`)
- ESLint (`dbaeumer.vscode-eslint`)
- Tailwind CSS IntelliSense (`bradlc.vscode-tailwindcss`)
- Rust Analyzer (`rust-lang.rust-analyzer`)
- Proto3 (`zxh404.vscode-proto3`)

### Cursor / Claude Code

Read the AGENTS.md files for project conventions:

```
AGENTS.md              # Root conventions
runtime/AGENTS.md      # Go runtime
sdk/AGENTS.md          # TypeScript SDK
apps/desktop/AGENTS.md # Tauri + React
```

## Common Tasks

| Task | Command |
|------|---------|
| Build everything | `pnpm build` |
| Build SDK only | `pnpm build:sdk` |
| Start runtime | `cd runtime && ./nimi serve` |
| Start desktop shell | `pnpm --filter @nimiplatform/desktop dev:shell` |
| Start desktop renderer | `pnpm --filter @nimiplatform/desktop dev:renderer` |
| Start web | `pnpm dev:web` |
| Run all tests | `pnpm test` |
| Lint proto | `buf lint proto/` |
| Regenerate proto stubs | `buf generate` |

## Troubleshooting

### `pnpm build` fails with missing dependencies

Run `pnpm install` first. If using a workspace package that depends on SDK, build SDK first: `pnpm build:sdk`.

### Tauri build fails

Ensure Rust toolchain is up to date: `rustup update`. Check Tauri system dependencies for your OS.

### Proto generation produces unexpected diff

Run `buf generate` and check `git diff`. Generated code must always be committed. CI fails on any drift.
