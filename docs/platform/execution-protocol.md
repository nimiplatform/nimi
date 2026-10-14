# Controlled Action Execution Protocol

This page describes the governed delegated-action contract. The current External Agent gateway has an empty action registry and does not admit external execution; the scenario below explains the contract, not an available end-to-end workflow. Nimi Integration uses its own admitted operations and standing resource permissions. This protocol is separate from core local AI inference, LocalAgent conversations, memory recall, and standard Runtime readiness.

## Execution Safety Lifecycle

When an action surface uses the full execution boundary, every operation moves through five ordered stages:

```
discover → dry-run → verify → commit → audit
```

| Phase | Responsibility & Safety Guarantee |
| --- | --- |
| `discover` | Expose only operations visible and permitted to the current scoped principal |
| `dry-run` | Build a structured proposal showing intended changes without side effects |
| `verify` | Check the proposal against user intent, access policies, and safety guardrails |
| `commit` | Execute the approved operation once under idempotency protection |
| `audit` | Record the final outcome and execution lineage |

If `verify` fails, execution stops immediately and never reaches `commit`. If a commit's audit status cannot be confirmed, the system fails closed. High-risk operations cannot bypass the checks required by their owning authority.

## Authority Boundaries

Each action owner defines its allowed operations, input/output schemas, risk levels, and approval rules. Runtime provides the delegated gateway, user confirmation flow, and output filtering without taking over Realm or application state. Nimi Home or another host surface may render confirmation dialogs, but the host UI is not the final policy decision-maker.

This protocol does not require a general workflow engine, external MCP bridge, or public action catalog. Future adapters that adopt this pipeline remain independent and non-blocking.

## Scenario: Verified Write Operation

When an external extension requests a persistent write:

1. **Discovery**: The caller queries available actions and sees only operations allowed for the active session.
2. **Dry-Run**: Runtime generates a typed preview of the write without modifying target state.
3. **Verification**: Runtime evaluates safety policies and prompts the user for confirmation if the risk level requires it.
4. **Commit**: Once verified, the action owner applies the write exactly once under an idempotency lock.
5. **Audit**: Runtime records the terminal result and lineage metadata.

If policy verification or user confirmation fails in step 3, Runtime aborts before `commit` and returns a structured rejection.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
