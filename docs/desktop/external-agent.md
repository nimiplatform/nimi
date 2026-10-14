# External Agent Access and Integration Control

> **Status**: Reserved / In development. Desktop currently provides a status projection under **Advanced & Diagnostics → Permissions & Access**. Token issuance and external execution remain disabled until the Runtime action registry and external gateway infrastructure are enabled.

External Agent Access is designed to let third-party tools—such as IDE extensions, external AI assistants, and automation workflows—interact with Nimi through scoped, time-bounded access tokens.

For the platform-level specification and security model, see [Platform → External Agents](/platform/agents/external-agents).

## Current Desktop Behavior

| Control Dimension | Current Behavior | Purpose |
| --- | --- | --- |
| **Service Status** | Displays Runtime's external gateway readiness | Shows whether the local gateway service is reachable |
| **Action Registry** | Keeps token issuance disabled while the action registry is empty (`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`) | Fails closed so tokens cannot be issued before permitted actions are registered |
| **Token Ledger** | Shows current token projection state and why issuance is unavailable | Explains why external access cannot yet be granted |
| **Revocation Contract** | Defines the revocation interface in the specification as a fail-closed control | Reserves immediate revocation support before token issuance opens |

## Planned Security Boundaries

When external token issuance and gateway execution are enabled, the protocol requires three core safeguards:

- **Least Privilege**: Each token is restricted to explicit actions and data scopes.
- **Bounded Local Audit**: External calls, parameters, and authorization decisions are recorded in sanitized, size-bounded local audit events.
- **Fail-Closed Gateway**: Operations not present in the admitted action registry are rejected at the gateway.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
