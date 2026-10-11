# External Agent Access and Integration Control

> **Status**: Reserved / In development. Nimi Desktop provides a projection surface under "Advanced & Diagnostics → Permissions & Access" for external agent integration. Token issuance and active execution remain disabled until the Runtime action registry and external gateway infrastructure land.

External Agent Access enables third-party AI assistants, IDE extensions, and automation workflows to interface safely with Nimi. By issuing scoped, time-bounded access tokens to external principals, users will be able to allow external tools to collaborate within well-defined boundaries.

For the security architecture and platform-level specifications, see [Platform → External Agents](/platform/agents/external-agents).

## Current Status and Safety Guardrails

| Control Dimension | Current Behavior | Design Rationale |
| --- | --- | --- |
| **Service Status** | Desktop reports Runtime's external gateway readiness | Provides visibility into service connectivity |
| **Action Registry** | Token issuance stays disabled while the action registry is unpopulated (`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY`) | Enforces fail-closed security to prevent unverified executions |
| **Token Ledger** | Displays token projection state and reasons why issuance is currently deferred | Offers transparent visibility into access controls without permitting premature token creation |
| **Revocation Contract** | Revocation interface is defined in the specification as a fail-closed control | Prepares immediate revocation capabilities once token issuance goes live |

## Security Architecture

To protect user data and local privacy, Nimi enforces three foundational invariants for external agents:

- **Least Privilege**: Every issued token is scoped strictly to specific actions and data boundaries.
- **Audit Lineage**: Every external invocation, parameter payload, and user decision is captured in bounded, sanitized local audit events.
- **Fail-Closed Gateways**: Any operation outside the explicitly permitted action registry is intercepted and blocked at the gateway level.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
