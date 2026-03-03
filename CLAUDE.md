# CLAUDE.md

> Compatibility shim for Claude Code in this repository.

This file intentionally defines no independent project rules.

## Rule Entry Points

1. Follow [`AGENTS.md`](AGENTS.md) for repo-wide rules.
2. Follow the nearest path-scoped `*/AGENTS.md` for component rules.
3. If the change touches `spec/**`, follow [`spec/AGENTS.md`](spec/AGENTS.md).

## Conflict Resolution

- `AGENTS.md` files are authoritative.
- Tool-specific files must not fork or override AGENTS rules.
