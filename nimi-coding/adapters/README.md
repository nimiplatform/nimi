# Adapters

This directory holds optional runtime-adapter guidance for external execution
hosts.

Adapters in this package do not become methodology owners. They exist to map
project-local `.nimi/**` truth into a host-specific execution surface while
preserving these boundaries:

- `.nimi/**` remains the semantic owner.
- External hosts may own operational state, transport, routing, and execution
  continuity.
- External hosts must not redefine acceptance, disposition, or canonical
  project truth.

The first admitted adapter sketch is [`oh-my-codex`](./oh-my-codex/README.md).

The package-owned host-agnostic baseline for any external host lives in
`.nimi/contracts/external-host-compatibility.yaml`. Named adapter overlays may
specialize that baseline, but they do not replace it.
