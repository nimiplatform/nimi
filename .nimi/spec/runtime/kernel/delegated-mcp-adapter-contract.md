# Runtime Delegated MCP Adapter Contract

> Owner Domain: `K-DELEG-*`

This contract defines the Runtime-owned MCP adapter posture for delegated
capability providers. MCP is a protocol adapter source. It is not Runtime
semantic authority.

## K-DELEG-100 MCP Adapter Authority

Runtime owns MCP adapter admission, provider profile binding, server lifecycle,
tool discovery, tool filtering, tool call admission, timeout, drift handling,
and quarantined evidence creation.

MCP wire objects do not become public Runtime ontology. Runtime must normalize
MCP data into `K-DELEG-001` through `K-DELEG-099` contracts before a later
firewall authority can admit it to model context, projection, or action paths.

## K-DELEG-101 Official SDK Adapter Dependency

Runtime MCP implementation must use the official
`github.com/modelcontextprotocol/go-sdk` package as the protocol adapter
dependency unless a later high-risk admission explicitly replaces it.

The dependency is an implementation adapter only. It must not define Nimi
provider identity, request/result vocabulary, approval state, firewall verdict,
audit retention, or Runtime agent projection semantics.

## K-DELEG-102 Provider Profile Binding

Each MCP provider must bind to a Runtime delegated provider profile from
`K-DELEG-002`.

The binding must include:

| Field | Required | Semantics |
| --- | --- | --- |
| `provider_id` | yes | Runtime delegated provider identity |
| `provider_kind` | yes | must be `MCP_TOOL_PROVIDER` |
| `transport_kind` | yes | admitted MCP transport class |
| `allowed_tools` | yes | Runtime-owned tool allowlist |
| `trust_tier` | yes | inherited from `K-DELEG-004` |
| `credential_ref` | conditional | reference to connector/key-source/grant authority |

## K-DELEG-103 Transport Classes

This contract admits `stdio_command` as the production MCP transport class for
Runtime-owned local gateway execution.

Remote HTTP transports require separate admission unless that admission proves
target-resource authorization, credential custody, timeout, and response
quarantine against this contract.

## K-DELEG-104 Server Lifecycle

Runtime owns starting, connecting, monitoring, timing out, and closing MCP
server sessions.

No Desktop, Avatar, Web, or app layer may instantiate an MCP
client or server session directly.

## K-DELEG-105 Tool Discovery

Runtime MCP discovery must call MCP tool listing through the adapter dependency
and normalize each listed tool into Runtime gateway evidence.

Discovery output is not model context and is not `runtime.agent.*` projection.

## K-DELEG-106 Tool Allowlist

Runtime must reject provider profiles without an explicit allowed tool list.

Only allowed tools may be returned from discovery or called. Unknown tools from
an MCP server may be ignored during listing, but they must not become callable
or visible as available Runtime delegated capabilities.

## K-DELEG-107 Tool Schema Drift

If an allowed tool includes an expected input schema digest, Runtime must compare
the current MCP tool input schema digest before a tool call.

Digest mismatch is provider drift and must fail closed with a delegation reason
code.

## K-DELEG-108 Tool Call Admission

Runtime may call an MCP tool only after:

- provider profile exists and is active
- provider kind is `MCP_TOOL_PROVIDER`
- transport kind is admitted
- tool name is allowlisted
- expected schema digest check passes when configured
- request timeout is bounded

## K-DELEG-109 Quarantined Gateway Evidence

MCP call output must be recorded as quarantined gateway evidence.

The evidence may include MCP content, structured content, tool error state,
provider/session IDs, schema digests, and timing metadata, but it must carry:

- `firewall_state=not_evaluated`
- `model_context_admitted=false`
- `projection_admitted=false`
- `action_admitted=false`

## K-DELEG-110 No Pre-Firewall Consumption

Before `K-DELEG-050` through `K-DELEG-084` are implemented in Runtime code, MCP
gateway evidence must not be consumed by:

- Runtime model prompt/context construction
- Runtime agent final decision logic
- `runtime.agent.*` projection
- Desktop UI state
- Avatar presentation state
- action execution

## K-DELEG-111 Token Passthrough Prohibition

Runtime must not pass raw user, provider, connector, OAuth, API key, or bearer
tokens through MCP request arguments, SDK metadata, environment injection, app
payloads, Avatar payloads, or Desktop payloads.

Credential material must remain under connector/key-source/grant/authn/authz
authority. MCP adapter code may receive only the minimum credential material
needed inside Runtime-owned execution.

## K-DELEG-112 Command Environment Hygiene

For `stdio_command`, Runtime must construct a bounded process environment and
must not inherit arbitrary secret-bearing environment variables into MCP server
processes.

Allowlisted operational variables such as `PATH`, temporary-directory
variables, and OS process bootstrap variables may be preserved only when needed
for process startup.

## K-DELEG-113 Timeout And Cancellation

MCP discovery and tool calls must use bounded contexts. Cancellation or timeout
must close the MCP session and return a fail-closed gateway failure.

## K-DELEG-114 Gateway Failure Mapping

MCP connection failure, discovery failure, unlisted tool, schema drift, tool
call protocol error, timeout, and server lifecycle failure must map to
`K-DELEG-080` failure semantics and table reason codes.

## K-DELEG-115 Audit Link

MCP gateway evidence must carry enough trace material for `K-DELEG-085`
through `K-DELEG-089` to correlate provider, request, tool, session, failure,
and quarantine state in admitted audit/replay surfaces.

This contract does not create a second audit store.

## K-DELEG-116 Direct Import Guard

Only Runtime-owned MCP adapter implementation paths may import
`github.com/modelcontextprotocol/go-sdk`.

SDK, Desktop, Avatar, Web, and apps direct MCP imports are
forbidden.

## K-DELEG-117 A2A Non-Interference

A2A provider support must not be implemented, imported, registered, exposed, or
faked by this MCP adapter admission.

A2A remains the future seam owned by the A2A future-seam contract.

## K-DELEG-118 Controlled MCP Test Requirement

MCP adapter tests must use a real MCP client/server interaction through the
official SDK transport. Stubbed success without MCP protocol execution is not
valid closure evidence.

## K-DELEG-119 Firewall Admission Requirement

This MCP adapter admission does not admit MCP output into Runtime cognition,
presentation, or action surfaces.

Only an admitted closed firewall surface may transform quarantined gateway
evidence into accepted observation, suggestion, artifact, failure, approval, or
action input semantics.
