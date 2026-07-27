# Optional Action Execution

Nimi can place an optional fail-closed boundary around external or
delegated actions. This boundary is not a prerequisite for Local AI,
LocalAgent, Conversation, Memory, Knowledge, or ordinary Runtime
readiness.

## Safety Order

When an action surface enables the full execution boundary, it uses
this order:

```
discover → dry-run → verify → commit → audit
```

| Stage | Safety outcome |
| --- | --- |
| `discover` | Return only actions visible to the current scoped principal |
| `dry-run` | Produce a typed proposal without committing side effects |
| `verify` | Check the proposal against current intent and policy |
| `commit` | Apply the authorized action with idempotency protection |
| `audit` | Record the outcome and lineage |

A failed verification never becomes a commit. A commit whose audit
outcome is uncertain fails closed. High-risk actions cannot use a path
that omits the safeguards required by their owner.

## Owner Boundary

The action owner defines the allowed operation, input, output, risk
class, and authorization result. Runtime may provide a delegated
gateway, approval step, and output firewall without becoming the owner
of Realm or App truth. Nimi Home or another host may present approval
UI without becoming the action authority.

General Workflow, MCP, A2A, or a public Action Registry are not implied
by this boundary. If a future adapter uses it, that adapter remains
separately owned and non-blocking.

## Reader Scenario: A Verified Write

An optional external-action surface proposes a write.

1. Discovery returns the scoped operation.
2. Dry-run produces a typed proposal with no side effects.
3. Verification confirms current intent and policy.
4. Commit applies the action once.
5. Audit records the terminal result.

If verification fails at step three, the flow stops before commit and
returns a typed refusal.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
