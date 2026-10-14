# Delegation Client

> Status: Standardized core contract; public capabilities are gated by official SDK package exports.

The runtime delegation client contract standardizes how SDK consumers interact securely with the Runtime delegation gateway and output firewall. The client surface is usable strictly when exposed through official SDK package exports.

## Purpose and Scope

The Delegation Client provides a structured SDK surface for applications or external AI hosts integrating delegated capabilities. It allows clients to submit typed observations, queries, proposed intents, tool requests, presentation layout updates, artifact creation requests, and sandboxed test executions to the Runtime delegation gateway.

**All proposals must traverse the Runtime output firewall** (see [Runtime → Delegated Capability](/runtime/delegated-capability)). The SDK strictly prevents uninspected proposals from reaching downstream application code.

## Method Surface

| Method | Role & Description |
| --- | --- |
| `OBSERVE` | Submit typed environmental or behavioral observations |
| `QUERY` | Submit structured query requests |
| `SUGGEST_INTENT` | Propose a high-level operational intent |
| `SUGGEST_TOOL_REQUEST` | Propose executing a specific tool invocation |
| `SUGGEST_PRESENTATION` | Propose layout or presentation state updates |
| `CREATE_ARTIFACT` | Propose generating and persisting an artifact file |
| `CONTROLLED_TEST` | Execute a strictly sandboxed, non-destructive test |

All methods represent **proposals or observations**, never unilateral mutations.

## No Silent Fallback Knobs

The SDK deliberately avoids exposing routing or provider fallback switches. Runtime enforces target locking and typed error semantics: a delegated proposal that fails firewall screening is reported as an explicit typed failure, rather than silently falling back to unverified alternate providers.

## Typical Scenario: An Application Proposes a Tool Call

A feature module powered by an external AI suggests executing a tool:

1. **Submit proposal**: The module invokes `delegationClient.suggestToolRequest(...)`.
2. **Gateway intake**: The Runtime delegation gateway validates the request against the trust tier of the provider profile.
3. **Output firewall inspection**: The firewall validates payload schema, origin provenance, descriptor hash, data sensitivity, and prompt injection risks.
4. **Enforce verdict**: A typed verdict is returned (e.g., `ACCEPTED_SUGGESTION`, `APPROVAL_REQUIRED`, `QUARANTINED`).
5. **Execution**: If approved, Runtime executes the action within its audit lineage and returns typed results back through the SDK.

## Architectural Boundaries

- Proposals may never bypass the output firewall.
- No manual provider rescue switches or silent retry mechanisms are exposed.
- Downstream consumer code cannot execute proposed actions without gateway approval.
- Contract failures trigger immediate rejections rather than unverified cross-provider retries.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
