# Adapters

This directory holds optional runtime-adapter guidance for external execution
hosts.

Adapters in this package do not become methodology owners. They exist to map
project-local `.nimi/**` truth into a host-specific execution surface while
preserving these boundaries:

- `.nimi/**` remains the semantic owner.
- External hosts may own operational state, transport, routing, and execution
  continuity.
- Native host review features may provide evidence or risk signals only.
- External hosts must not redefine acceptance, disposition, or canonical
  project truth.

Admitted adapter sketches:

- [`codex`](./codex/README.md) — native Codex SDK host via `@openai/codex-sdk`
- [`oh-my-codex`](./oh-my-codex/README.md) — external execution host via JSON handoff
- [`claude`](./claude/README.md) — inline coding host via CLAUDE.md + PreToolUse hooks

The package-owned host-agnostic baseline for any external host lives in
`.nimi/contracts/external-host-compatibility.yaml`. Named adapter overlays may
specialize that baseline, but they do not replace it.
