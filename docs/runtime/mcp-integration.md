# MCP Integration

> Status: Partial. The first release promise covers SDK adapter
> migration shapes and Runtime contract evidence. Production MCP
> transport, MCP resources, raw MCP ontology promotion, and external
> execution are not promised.

MCP (Model Context Protocol) is admitted in Nimi as a **protocol
adapter source**. It is not Runtime semantic authority. Runtime owns
the adapter admission, server lifecycle, tool discovery, allowlisting,
schema-drift handling, and quarantine semantics — the MCP wire
objects do **not** become public Runtime ontology.

## Authority Posture

| Concern | Owner |
| --- | --- |
| MCP adapter admission + provider profile binding | Runtime contract evidence (`K-DELEG-100..K-DELEG-110`) |
| Server lifecycle (start, connect, monitor, timeout, close) | Runtime |
| Tool discovery + allowlisting | Runtime |
| Tool schema drift detection | Runtime |
| Tool call admission + quarantine | Runtime + delegated output firewall |
| MCP wire object semantics | Adapter only — does **not** become Runtime ontology |

No Desktop, Avatar, Web, or app layer may
instantiate an MCP client or server session directly. Runtime owns it.

## Stdio Transport Contract

`stdio_command` is contract evidence for a Runtime-owned MCP adapter
shape. It is not a production MCP transport promise in the first public
release. Runtime / SDK callers must treat unsupported MCP resources,
raw ontology promotion, and external execution as fail-closed.

| Property | Value |
| --- | --- |
| Transport kind | `stdio_command` |
| Execution location | Runtime-owned local gateway |
| Server lifecycle | Runtime starts / connects / monitors / closes |
| Tool listing | Runtime calls MCP discovery via the official adapter |

## Remote Transports

Remote HTTP transports are not a public Runtime API today. They require
later admission evidence that proves target-resource authorization,
credential custody, timeout behavior, and response quarantine against
the delegated MCP adapter contract before apps can use them.

## Official SDK Adapter Dependency

Runtime's MCP implementation uses the official
`github.com/modelcontextprotocol/go-sdk` package as the protocol
adapter dependency. The dependency is an **implementation adapter
only**; it does not define Nimi provider identity, request /result
vocabulary, approval state, firewall verdict, audit retention, or
agent projection semantics. Those remain Runtime concerns.

## Provider Profile Binding

Each MCP provider must bind to a Runtime delegated provider profile
(`K-DELEG-002`). The binding fields:

| Field | Required | Semantics |
| --- | --- | --- |
| `provider_id` | yes | Runtime delegated provider identity |
| `provider_kind` | yes | Must be `MCP_TOOL_PROVIDER` |
| `transport_kind` | yes | Admitted MCP transport class |
| `allowed_tools` | yes | Runtime-owned tool allowlist |
| `trust_tier` | yes | Inherited from `K-DELEG-004` |
| `credential_ref` | conditional | Reference to connector / key-source / grant authority |

A provider profile without `allowed_tools` is rejected. There is no
implicit "all tools" allow.

## Tool Allowlisting

Only allowlisted tools may be returned from discovery or called.
Unknown tools from an MCP server may be silently ignored at listing
time, but they must not become callable or visible as available
delegated capabilities.

## Schema Drift Detection

If an allowed tool includes an expected input schema digest, Runtime
must compare the current MCP tool input schema digest **before** a
tool call. A drifted schema:

| Outcome | Action |
| --- | --- |
| Match | Tool call proceeds through delegated firewall |
| Mismatch | Tool call rejected; provider session may be quarantined per delegated capability rules |

Drift does not silently continue. The platform refuses to act on a
tool whose interface changed since admission.

## Why MCP Wire Objects Stay Out Of Runtime Ontology

MCP wire objects represent provider-defined semantics that the
provider can change unilaterally. If those wire objects became
Runtime ontology, every provider change would require a Runtime
contract amendment — and worse, Runtime semantics would be hostage to
provider implementation choices.

Instead, Runtime normalizes MCP outputs into the admitted
`K-DELEG-001..K-DELEG-099` contract surfaces before Runtime admits them
to model context, projection, or action paths. The
adapter boundary is what protects Runtime ontology.

## Reader Scenario: Future App Author Wires Up An MCP Tool Provider

This is a future contract scenario, not a current production MCP
transport promise. An app author wants to expose an MCP-backed tool to
their agent after the required Runtime admission lands.

1. **Provider profile.** The app descriptor declares an MCP provider
   profile binding with `provider_kind: MCP_TOOL_PROVIDER`,
   `transport_kind: stdio_command`, an explicit `allowed_tools`
   list, and a trust tier.
2. **Runtime admits.** Runtime starts the MCP server session under
   its own lifecycle.
3. **Discovery.** Runtime calls MCP tool listing through the
   official adapter; normalizes each listed tool into Runtime
   gateway evidence; matches against `allowed_tools`.
4. **Tool exposed.** Allowed tools are reachable via Runtime's
   delegated capability gateway; the app's agent can request them
   through admitted SDK paths.
5. **Tool call.** Each call goes through the **delegated output
   firewall** before any result enters model context or action path.
6. **Audit.** Lineage records the call, firewall verdict, and any
   action that follows.

The app did not invent its own MCP integration. Runtime owns the
adapter; the app consumed admitted Runtime gateway evidence.

## Reader Scenario: Tool Schema Drift Quarantines A Provider

An MCP provider updates one of its tool schemas mid-session.

1. **Tool call requested.** Runtime checks the current MCP tool
   input schema digest against the admitted digest.
2. **Drift detected.** Digest mismatch.
3. **Tool call rejected.** Runtime returns a typed refusal.
4. **Provider quarantined.** Per delegated capability rules,
   provider state moves to `QUARANTINED`. The provider's
   `K-DELEG-*` lifecycle reflects this.
5. **No silent continuation.** The platform does not pretend the
   drift did not happen; the operator sees the typed reason.

## What MCP Integration Does Not Do

- It does not let MCP wire objects become Runtime ontology.
- It does not let Desktop / Avatar / apps open an MCP
  session directly.
- It does not allow tool calls to bypass the delegated output
  firewall.
- It does not allow production MCP transport to ship without matching
  authority admission.
- It does not let the official SDK adapter define Nimi semantic
  authority.

## Boundary Summary

| Concern | Owner | Surface |
| --- | --- | --- |
| Adapter dependency | Adapter package (implementation only) | `go-sdk` |
| Provider profile + allowlist | Runtime | `K-DELEG-100..110` |
| Server session lifecycle | Runtime | `K-DELEG-104` |
| Tool discovery + drift | Runtime | `K-DELEG-105`, `K-DELEG-107` |
| Tool call admission + firewall | Runtime + delegated output firewall | `K-DELEG-001..099` |
| Result entry into model context / projection / action path | Runtime + firewall | Separately admitted |

## Source Basis

- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
