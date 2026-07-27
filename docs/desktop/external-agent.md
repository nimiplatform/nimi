# External Agent Access

> Status: Contract-only. Desktop contains the Runtime Config placement for
> External Agent Access, but token issuance and the action registry stay
> fail-closed until the Runtime-owned gateway/action plane is exposed.

External Agent Access is a reserved Desktop surface for future
`ExternalPrincipal` management. The current product build may display
Runtime status and an empty ledger projection, but it must not pretend
that external AI hosts can receive usable scoped tokens today.

For the platform model, see
[Platform → Agents → External Agents](/platform/agents/external-agents).

## Current Behavior

| State | Behavior |
| --- | --- |
| Runtime projection available | Desktop can read Runtime's External Agent status projection |
| Action registry empty | Token issuance remains disabled with reason `EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY` |
| Token ledger | Empty until Runtime admits the action registry and gateway server |
| Issue / revoke | Not a shipped user workflow in this build |

The panel is intentionally fail-closed. Starting the runtime daemon is
not enough to make External Agent Access usable; Runtime must first own
the action descriptor registry, gateway server, token ledger, and audit
lineage for this capability.

## Why It Is Still Visible

Desktop keeps the placement so the product has a stable home for the
future capability and so Runtime can project an explicit disabled
reason. That is different from shipping token issuance.

The panel should communicate the disabled reason clearly:

- no silent success,
- no synthesized token,
- no Desktop-local token ledger,
- no fallback action registry in renderer or Tauri.

## Future Capability Boundary

When admitted, External Agent Access will be Runtime-owned:

| Concern | Owner |
| --- | --- |
| Action descriptors | Runtime |
| Gateway/server | Runtime |
| Token ledger | Runtime |
| Audit lineage | Runtime |
| UI placement and controls | Desktop |
| Typed projection | SDK |

Desktop remains the user-facing placement. It does not own action
authority or token truth.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
