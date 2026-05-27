# External Agents

> Status: Admitted model, deferred product capability. The
> `ExternalPrincipal` identity model exists, but usable token issuance
> and action execution wait for a Runtime-owned gateway/action registry.

Nimi models external AI hosts — a separate AI provider, an MCP-tooled
agent, or a future A2A peer — as `ExternalPrincipal` participants. That
identity is part of the authorization model. It does not mean the
current product build ships a usable external-agent action plane.

For the Desktop placement, see
[Desktop → External Agent Access](/desktop/external-agent).

## What `ExternalPrincipal` Means

`ExternalPrincipal` is the typed identity reserved for an external AI
host. It is distinct from a user, first-party app, and internal agent.

| Property | Current boundary |
| --- | --- |
| Identity | Platform-admitted `ExternalPrincipal` |
| Token issuance | Deferred until Runtime owns the gateway/server |
| Action descriptors | Runtime-owned, not renderer-local or Desktop-local |
| Token ledger | Runtime-owned |
| Action surface | Runtime-owned action plane |
| Desktop role | UI placement and user controls only |
| SDK role | Typed projection |

The current product must fail closed when the Runtime action registry is
empty. A Desktop panel or SDK method may expose the disabled state; it
must not synthesize a usable token or local action descriptor.

## Future Capability Domains

When Runtime admits the action registry, token scope will be defined by
typed capability domains:

| Domain | What it covers |
| --- | --- |
| `action.discover.*` | Read-only discovery |
| `action.dry-run.*` | Simulation without mutation |
| `action.verify.*` | Non-mutating verification |
| `action.commit.*` | Mutations admitted by policy |

A token may carry only explicit domains. The platform rejects ambient
"do anything" access.

## Delegated Session Boundary

External principals do not directly mutate product truth. Runtime opens
a delegated session, evaluates output through the firewall, and emits
Runtime-owned actions only after policy admits them.

| Runtime concern | Boundary |
| --- | --- |
| Descriptor registry | Runtime truth |
| Output firewall | Runtime truth |
| Approval and quarantine | Runtime truth |
| Audit replay | Runtime truth |
| User-facing placement | Projected to Desktop through SDK |

This keeps future external AI integration from becoming a Desktop
shortcut or a private SDK side channel.

## Reader Scenario: Current Build

1. **User opens External Agent Access.** Desktop asks Runtime for
   status.
2. **Runtime reports disabled.** The reason is
   `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`.
3. **Desktop shows the reason.** Token issuance remains disabled.
4. **No action occurs.** There is no pseudo token, local action
   descriptor, or renderer fallback.

That is the correct behavior until the Runtime capability lands.

## Source Basis

- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
