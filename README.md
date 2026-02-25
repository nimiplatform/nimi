# Nimi

[![CI](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml/badge.svg)](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MIT-blue)](LICENSE)
[![Go](https://img.shields.io/badge/go-1.24-00ADD8)](runtime/go.mod)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)

An AI-native open world platform with local runtime, open SDK, desktop shell, and mod ecosystem.

```
┌─────────────────────────────────────────────────────┐
│                    Applications                      │
│  desktop (1st party)    3rd-party apps          │
├─────────────────────────────────────────────────────┤
│                      @nimiplatform/sdk                        │
├──────────────────────┬──────────────────────────────┤
│  nimi-realm (cloud)  │  nimi-runtime (local)          │
│  Identity / Social   │  AI Inference / Models         │
│  Economy / Worlds    │  Workflow DAG / Knowledge      │
│  Agents / Memory     │  App Auth / Audit              │
└──────────────────────┴──────────────────────────────┘
```

## Components

| Component | Description | Language | License |
|-----------|-------------|----------|---------|
| [runtime](runtime/) | Local AI daemon — inference, models, workflows, auth | Go | Apache-2.0 |
| [sdk](sdk/) | Developer SDK (`@nimiplatform/sdk`) — realm + runtime access surfaces | TypeScript | Apache-2.0 |
| [desktop](apps/desktop/) | Flagship desktop app with mod ecosystem | Tauri + React | MIT |
| [web](apps/web/) | Web adapter reusing desktop renderer | React | MIT |
| [nimi-mods](nimi-mods/) | Desktop mini-programs (extensions) | TypeScript | MIT |
| [proto](proto/) | gRPC service definitions | Protobuf | Apache-2.0 |
| [docs](docs/) | Documentation & protocol spec | Markdown | CC-BY-4.0 |

## Quick Start

### Runtime

```bash
cd runtime
go run ./cmd/nimi serve
```

In another terminal:

```bash
cd runtime
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi ai generate --prompt "hello runtime"
go run ./cmd/nimi model list --json
go run ./cmd/nimi mod list --json
```

### Mod CLI

```bash
cd runtime
export NIMI_RUNTIME_MODS_DIR=/ABS/PATH/TO/nimi-mods
go run ./cmd/nimi mod install mod-circle:world.nimi.community-tarot --mods-dir "$NIMI_RUNTIME_MODS_DIR" --json
go run ./cmd/nimi mod install mod-circle:world.nimi.community-tarot --mods-dir "$NIMI_RUNTIME_MODS_DIR" --strict-id --json
go run ./cmd/nimi mod install github:someuser/nimi-mod-tarot --mods-dir "$NIMI_RUNTIME_MODS_DIR" --json
go run ./cmd/nimi mod create --dir /tmp/my-mod --name "My Mod" --mod-id world.nimi.my-mod
go run ./cmd/nimi mod build --dir /tmp/my-mod --json
GITHUB_TOKEN=... go run ./cmd/nimi mod publish --dir /tmp/my-mod --source-repo yourname/my-mod --json
```

### SDK

```bash
pnpm add @nimiplatform/sdk
```

```ts
import { createNimiClient } from '@nimiplatform/sdk';

const client = createNimiClient({
  appId: 'my_app',
  realm: { baseUrl: 'https://api.nimi.xyz' },
});

const profile = await client.realm.auth.getProfile();
console.log(profile.userId);
```

### Desktop

```bash
pnpm install
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run dev:shell
```

Desktop × `nimi-mods` local joint-debug (no legacy fallback):

```bash
# Terminal A (mods)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
pnpm -C "$NIMI_MODS_ROOT" install
pnpm -C "$NIMI_MODS_ROOT" run watch -- --mod local-chat

# Terminal B (desktop)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm run check:desktop-mods-smoke:local-chat
pnpm -C apps/desktop run dev:shell
```

## Documentation

- [Getting Started](docs/getting-started/README.md)
- [Architecture](docs/architecture/README.md)
- [Runtime Guide](docs/runtime/README.md)
- [SDK Reference](docs/sdk/README.md)
- [Public SSOT](ssot/README.md)
- [Mod Development](docs/mods/README.md)
- [Platform Protocol](docs/protocol/README.md)
- [Error Codes](docs/error-codes.md)

## For AI Agents

This project is built AI-first. See [AGENTS.md](AGENTS.md) for conventions, plus per-component files:

- [runtime/AGENTS.md](runtime/AGENTS.md) — Go conventions
- [sdk/AGENTS.md](sdk/AGENTS.md) — TypeScript conventions
- [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md) — Tauri + React conventions
- [nimi-mods/AGENTS.md](nimi-mods/AGENTS.md) — External mod repo workflow conventions

## Links

- [Documentation](docs/)
- [Vision](VISION.md)
- [Governance](GOVERNANCE.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflow and [AGENTS.md](AGENTS.md) for engineering conventions.

## License

Multi-licensed by component:

- `runtime/`, `sdk/`, `proto/` — [Apache-2.0](licenses/Apache-2.0.txt)
- `apps/desktop/`, `apps/web/`, `apps/_libs/`, `nimi-mods/` — [MIT](licenses/MIT.txt)
- `docs/` — [CC-BY-4.0](licenses/CC-BY-4.0.txt)
