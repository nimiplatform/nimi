# MCP × Agent Interaction Architecture

> Status: Architecture whitepaper
> Full version: [Chinese whitepaper](/zh/architecture/mcp-agent-interaction)

This document summarizes Nimi's approach to bidirectional Agent interaction under the Model Context Protocol (MCP).

## Core Conclusions

1. MCP serves as the **interoperability protocol layer** in Nimi, unifying how Agents connect to tools and capabilities.
2. Nimi's differentiation is **platform-level governance**: authorization, scope convergence, fail-close semantics, and audit evidence chains are enforced as strong constraints.
3. For App/Mod developers using the Nimi SDK or `nimi-hook`, governance sinks into the platform by default — low integration cost, high observability.

## Interaction Model

### Inbound (External → Nimi)

External Agents invoke Runtime-exposed capabilities via MCP following a fixed execution protocol:

`discover → dry-run → verify → commit → audit`

Each stage enforces authorization, scope validation, and audit trace. High-risk write operations require the full chain; skipping `verify` before `commit` triggers fail-close rejection.

### Outbound (Nimi → External)

The Runtime acts as an MCP Client calling external MCP Servers (search, prompt sources, enterprise tools). Connection lifecycle includes config-driven hot reload, exponential backoff on failure, and circuit-breaking after 3 consecutive failures.

## Governance Stack

- **Auth/Grant**: Principal model (Human / NimiAgent / ExternalAgent / Device / Service), session TTL bounds, scope prefix validation, delegation with depth limits.
- **Audit**: Minimum 6 fields on every audit path (`trace_id`, `app_id`, `domain`, `operation`, `reason_code`, `timestamp`). Sensitive fields are redacted at the audit write layer.
- **Fail-close**: Insufficient authorization, missing verification, or uncertain persistence all result in rejection.

## Developer Experience

App/Mod developers declare Action schemas, capabilities, and handlers. Authorization, audit, and error projection are managed by the platform (Runtime / SDK / `nimi-hook`). The primary new cost is action modeling quality — schema, risk classification, and compensation semantics.

## Spec Rule Anchors

- Platform: `P-ALMI-*`, `P-ARCH-*`, `P-PROTO-*`
- Runtime: `K-AUTHSVC-*`, `K-GRANT-*`, `K-AUDIT-*`, `K-CONN-*`, `K-ERR-*`
- Desktop: `D-SEC-*`, `D-HOOK-*`, `D-MOD-*`, `D-IPC-*`

## Related

- [AI Agent Security Interface](ai-agent-security-interface.md)
- [Realm Interconnect Paradigm](realm-interconnect-paradigm.md)
- [Architecture Overview](./)
