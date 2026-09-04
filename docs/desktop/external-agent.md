# External Agent Access

> Status: Not available yet. Desktop has a dedicated place for External
> Agent Access in Runtime Config, but token issuance stays off until
> Runtime ships its gateway and action plane.

External Agent Access is a reserved settings area for a future
capability: managing `ExternalPrincipal`s — external AI tools
connecting to Nimi with scoped tokens. The current build can show
Runtime status and an empty token ledger, but you can't issue usable
scoped tokens today.

For the platform model, see
[Platform → Agents → External Agents](/platform/agents/external-agents).

## Current Behavior

| State | Behavior |
| --- | --- |
| Runtime projection available | Desktop can read Runtime's External Agent status projection |
| Action registry empty | Token issuance remains disabled with reason `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY` |
| Token ledger | Empty until Runtime admits the action registry and gateway server |
| Issue / revoke | Not a shipped user workflow in this build |

The panel is intentionally locked. Starting the runtime daemon isn't
enough to make External Agent Access usable; Runtime first has to
provide the action descriptor registry, gateway server, token ledger,
and audit trail for this capability.

## Why It Is Still Visible

Desktop keeps this area so the capability has a stable home when it
arrives — and so you can see the exact reason it's disabled. Showing
the reason is not the same as shipping token issuance.

You will never see from this panel:

- a silent success,
- a made-up token,
- a Desktop-local token ledger,
- a fallback action registry in the renderer or Tauri.

## Future Capability Boundary

When this capability ships, its moving parts live in Runtime:

| Concern | Owner |
| --- | --- |
| Action descriptors | Runtime |
| Gateway/server | Runtime |
| Token ledger | Runtime |
| Audit lineage | Runtime |
| UI placement and controls | Desktop |
| Typed projection | SDK |

Desktop stays the place where you manage it. The actions and tokens
themselves belong to Runtime.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
