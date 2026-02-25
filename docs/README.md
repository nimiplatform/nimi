# Nimi Documentation

## For Humans

### User Guides

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started/README.md) | Install Nimi and make your first AI call |
| [Code Examples](./examples/README.md) | Runnable SDK and CLI examples |
| [Architecture](./architecture/README.md) | Platform architecture overview |
| [Runtime](./runtime/README.md) | Runtime installation, CLI reference, configuration |
| [SDK](./sdk/README.md) | `@nimiplatform/sdk` usage guide and API reference |
| [Mod Development](./mods/README.md) | Build mods in `nimi-mods` and joint-debug with desktop |
| [Protocol](./protocol/README.md) | Platform Protocol specification |
| [Error Codes](./error-codes.md) | Structured error code dictionary |
| [FAQ](./faq.md) | Frequently asked questions |

### Contributor Guides

| Document | Description |
|----------|-------------|
| [Development Setup](./dev/setup.md) | Set up local dev environment (Go + Node + Rust + Buf) |
| [Architecture Internals](./dev/architecture-internals.md) | Internal design decisions for contributors |
| [Testing](./dev/testing.md) | Test strategy and how to write tests |
| [Mod Runtime Layout Contract](./dev/mod-runtime-layout-contract.md) | No-legacy desktop × nimi-mods local joint-debug runtime contract |
| [Release Process](./dev/release.md) | Versioning, release pipeline, hotfix process |

## For AI Agents

### Convention Files

| File | Scope |
|------|-------|
| [`/AGENTS.md`](../AGENTS.md) | Root-level project conventions |
| [`/CLAUDE.md`](../CLAUDE.md) | Claude Code specific instructions |
| [`/.cursorrules`](../.cursorrules) | Cursor AI rules |
| [`/.github/copilot-instructions.md`](../.github/copilot-instructions.md) | GitHub Copilot instructions |

### Per-Component

| File | Scope |
|------|-------|
| [`/runtime/AGENTS.md`](../runtime/AGENTS.md) | Go runtime conventions |
| [`/runtime/context.md`](../runtime/context.md) | Runtime quick context |
| [`/sdk/AGENTS.md`](../sdk/AGENTS.md) | TypeScript SDK conventions |
| [`/sdk/context.md`](../sdk/context.md) | SDK quick context |
| [`/apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md) | Tauri + React conventions |
| [`/apps/desktop/context.md`](../apps/desktop/context.md) | Desktop quick context |
| [`/apps/web/AGENTS.md`](../apps/web/AGENTS.md) | Vite web-shell adapter conventions |
| [`/nimi-mods/AGENTS.md`](../nimi-mods/AGENTS.md) | Mod development conventions |

## License

All documentation is licensed under [CC BY 4.0](../licenses/CC-BY-4.0.txt).
