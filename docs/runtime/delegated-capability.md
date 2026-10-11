# Delegated Capabilities and Action Gateway

Delegated Capabilities constitute an optional extension within Runtime designed to safely govern external agent operations—such as third-party tool invocations, IDE integrations, or cross-system workflows. Operating as an isolated subsystem, it does not impede core local inference, conversation continuity, voice sessions, or everyday app development.

## Security Sandbox and Protection Boundaries

When delegated capabilities are activated, Runtime enforces comprehensive governance through dedicated gateways and execution sandboxes:

- **Ingress Gateway**: Authenticates caller signatures and token validity, verifying that requests originate from registered principals.
- **Output Firewall**: Analyzes proposed action parameters against sensitivity heuristics to intercept unauthorized operations.
- **Explicit Approval**: Actions that mutate system state or access sensitive resources trigger interactive user approvals on the Desktop control plane.
- **Audit Lineage**: Significant external invocations, parameter digests, and user decisions are recorded as sanitized, bounded local audit events subject to retention quotas.

External services can propose structured actions, but they cannot bypass session tokens or directly manipulate underlying state without explicit grants.

## Fault Isolation and Resilience

To ensure core system stability:
- If an external tool or provider goes offline, Runtime isolates the error to that specific call, returning a structured unavailable status without degrading the agent's baseline conversation capabilities.
- **Open Standards (MCP)**: Integrates with open specifications such as the Model Context Protocol (MCP) to map heterogeneous external tools into standardized, auditable platform actions.

## Source Basis

- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
