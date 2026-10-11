# Controlled Action Execution Protocol

Nimi establishes a fail-closed security boundary around external and delegated actions. This boundary operates independently from core Local AI, LocalAgent conversations, memory retrieval, or standard Runtime readiness.

## Execution Safety Lifecycle

When an action surface enables the full execution security boundary, operations strictly follow this phased progression:

```
discover → dry-run → verify → commit → audit
```

| Phase | Phase Responsibility & Safety Invariant |
| --- | --- |
| `discover` | Return only operations visible and permitted to the current scoped principal |
| `dry-run` | Produce a structured proposal payload without committing side effects |
| `verify` | Validate the proposal against active user intent, access policies, and guardrails |
| `commit` | Apply the authorized action under strict idempotency guarantees |
| `audit` | Permanently log the terminal outcome and execution lineage |

If `verify` fails, execution halts immediately; the pipeline never advances to `commit`. If the audit outcome of a commit is indeterminate, the system fails closed. High-risk operations can never bypass the safeguards mandated by their governing authority.

## Authority Boundaries

The action owner defines permitted operations, schema inputs, outputs, risk classifications, and authorization criteria. Runtime provides the delegated gateway, user confirmation workflow, and output filtering, without usurping ownership over Realm or application state. Nimi Home or other desktop hosts render approval dialogs, but do not act as the authoritative decision arbiter.

This boundary does not imply complex workflow engines, external MCP bridges, or public action catalogs. Future adapters that utilize this boundary remain independently owned and non-blocking.

## Scenario: Verified Write Operation

When an external extension initiates a persistent write:

1. **Discovery**: Returns only permitted operations scoped to the active session.
2. **Dry-Run**: Generates a typed preview proposal with zero side effects.
3. **Verification**: Validates intent and safety policies, requesting user confirmation if required.
4. **Commit**: Executes the mutation exactly once under idempotency locks.
5. **Audit**: Logs the terminal result and lineage metadata.

If verification fails at step three, execution terminates before commit, returning a structured refusal to the caller.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
