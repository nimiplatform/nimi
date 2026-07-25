# Runtime Delegation - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/delegation.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md -->

# Delegated A2A Future Seam Contract

> Owner Domain: `K-DELEG-*`

A2A is admitted only as a future Runtime delegated provider adapter seam. This
contract does not admit production A2A execution, production A2A dependencies,
Desktop A2A configuration, app/Avatar direct A2A paths, or A2A protocol
wire schemas as Nimi semantic authority.

## K-DELEG-120 A2A Future Seam Authority

A2A may be modeled only as a future delegated provider adapter seam owned by
Runtime. Any production A2A implementation requires a new admitted packet before
code, dependency, runtime registration, UI claim, or integration fixture lands.

MCP remains the only production delegated protocol adapter admitted by this
contract.

## K-DELEG-121 A2A Adapter Non-Authority

A2A protocol wire schemas, task payloads, agent cards, and remote agent native
states are not Runtime semantic authority.

A future A2A adapter must normalize all protocol-native facts into
`K-DELEG-001` through `K-DELEG-099` before any firewall, approval, audit,
replay, model-context, projection, or action path may consume them.

## K-DELEG-122 A2A Gateway Boundary

A future A2A adapter must enter through the Runtime delegated capability gateway.

It must not be called directly by Desktop, Web, Avatar, apps, SDK public
convenience APIs, or product UI surfaces.

## K-DELEG-123 A2A Firewall Boundary

A2A output must remain untrusted delegated provider output until Runtime
delegated output firewall returns an admitted verdict.

No A2A task message, artifact, event, or remote-agent response may enter model
context, `runtime.agent.*` projection, UI state, audit replay view, or action
execution before the firewall verdict.

## K-DELEG-124 A2A Approval Boundary

A2A-suggested actions, tool calls, workflow mutations, or side effects require
Runtime-owned approval semantics whenever `K-DELEG-069` or delegated provider
policy requires human review.

Desktop may render only Runtime typed approval requests. Desktop must not infer
approval directly from A2A task state.

## K-DELEG-125 A2A Credential Custody

A2A credentials, authorization headers, bearer tokens, refresh tokens, API
keys, and OAuth artifacts must remain under Runtime connector/grant/authn/authz
custody.

Future A2A adapter code must not pass raw credentials through SDK, Desktop,
Avatar, or app surfaces.

## K-DELEG-126 A2A Audit And Replay Boundary

A2A delegated calls must extend Runtime delegation audit/replay with the same
trace chain required by `K-DELEG-085` through `K-DELEG-089`.

A2A native logs, task ids, or remote-agent receipts may be evidence refs, but
they must not become the canonical audit ledger.

## K-DELEG-127 A2A Product Claim Prohibition

Desktop, Web, Avatar, and apps must not claim production A2A availability,
configuration, health, or success. Production A2A support is not admitted.

Product surfaces may mention A2A only as an unsupported seam when they are
rendering spec/debug material, not as a configurable feature.

## K-DELEG-128 A2A Negative Gate

Validation must prove there is no:

- production A2A SDK import
- Runtime A2A adapter registration
- Desktop A2A configuration or availability claim
- app/Avatar direct A2A client path
- fake A2A server success fixture
- A2A task payload projected directly into `runtime.agent.*`

## K-DELEG-129 Future A2A Packet Requirements

A future production A2A packet must include:

- exact protocol revision and dependency source
- Runtime adapter normalization contract
- provider profile binding and credential custody
- gateway and firewall integration tests
- approval, audit, replay, and redaction tests
- no-direct-app/Avatar/Desktop/SDK bypass gates
- controlled non-fake integration fixture
- explicit migration posture from this future-seam-only contract

---

<!-- source: .nimi/spec/runtime/kernel/delegated-approval-contract.md -->

# Delegated Approval Contract

> Owner Domain: `K-DELEG-*`

Delegated approval is a Runtime-owned pause/resume decision contract. Desktop
may render the review surface, but Runtime owns approval state and action
admission.

## K-DELEG-090 Approval Authority

Runtime owns delegated approval policy, pending approval state, approval
decision state, resume semantics, rejection semantics, and audit linkage.

Desktop owns only approval review UX. Protocol adapters do not own approval
semantics.

## K-DELEG-091 Approval Request

Approval requests must include:

| Field | Type | Required |
|---|---|---|
| `approval_request_id` | string | yes |
| `delegation_request_id` | string | yes |
| `agent_id` | string | yes |
| `effect_class` | enum | yes |
| `sensitivity_class` | enum | yes |
| `provider_profile_id` | string | yes |
| `capability_id` | string | yes |
| `summary_ref` | string | yes |
| `policy_snapshot_id` | string | yes |
| `created_at` | timestamp | yes |

`summary_ref` must point to Runtime-reviewed approval copy. It must not expose
raw provider output that has not passed firewall review.

## K-DELEG-092 Approval Decision

Approval decision values are fixed to:

- `APPROVED_ONCE`
- `REJECTED`
- `APPROVED_FOR_SESSION`
- `POLICY_BLOCKED`
- `EXPIRED`

`APPROVED_FOR_SESSION` is valid only when Runtime policy allows session-scoped
approval for the exact provider, capability, effect class, and policy snapshot.

## K-DELEG-093 Approval Resume

Runtime may resume a paused delegated request only when:

- approval request id matches the paused request
- policy snapshot is still valid
- provider descriptor hash has not drifted
- request effect class has not changed
- user or administrative principal is authorized

If one condition fails, Runtime must reject or regenerate the approval request.

## K-DELEG-094 Approval Expiry

Every pending approval must have an expiry. Expired approvals transition to
`EXPIRED` and cannot be resumed.

## K-DELEG-095 Approval Audit

Every approval request and decision must link to:

- `delegation_request_id`
- `provider_profile_id`
- `capability_id`
- `policy_snapshot_id`
- principal id
- audit trace id

Approval audit uses `K-AUDIT-*` storage with `K-DELEG-*` payload fields.

## K-DELEG-096 Approval UI Boundary

Desktop approval UI may display summary, risk, provider, capability, effect
class, sensitivity, and retry options. It must submit a typed approve/reject
decision to Runtime and must not mutate provider policy, credential custody, or
request payload directly.

## K-DELEG-097 Approval Rejection

Rejected approvals must produce an observable delegation failure or rejected
suggestion. Runtime must not continue the same delegated request by silently
removing the risky operation.

## K-DELEG-098 Programmatic Approval

Programmatic approval may exist only as Runtime policy. Desktop, SDK,
protocol adapters, apps, and Avatar cannot auto-approve delegated
requests by local convention.

## K-DELEG-099 Approval Projection

SDK and Desktop may consume approval projection as typed Runtime state:

- pending approval list
- approval detail
- approval decision result
- approval failure

Approval projection is not policy truth. Runtime policy remains canonical.

---

<!-- source: .nimi/spec/runtime/kernel/delegated-audit-replay-contract.md -->

# Delegated Audit Replay Contract

> Owner Domain: `K-DELEG-*`

Delegated audit and replay are Runtime-owned correlation semantics layered on
top of `K-AUDIT-*`. They do not create a second audit store.

## K-DELEG-085 Delegation Audit Extension

Delegated audit events must use existing Runtime audit storage, retention,
export, and minimum fields from `K-AUDIT-*`.

Delegation-specific payload fields are:

| Field | Type | Required |
|---|---|---|
| `delegation_session_id` | string | conditional |
| `delegation_request_id` | string | conditional |
| `delegation_result_id` | string | conditional |
| `provider_profile_id` | string | conditional |
| `capability_id` | string | conditional |
| `firewall_verdict` | enum | conditional |
| `approval_decision_id` | string | conditional |
| `runtime_decision_id` | string | conditional |
| `projection_event_id` | string | conditional |

These fields belong in the `payload` extension of Runtime audit events.

## K-DELEG-086 Delegation Trace Chain

Replay must be able to join, at minimum:

1. Runtime turn or session id
2. delegated provider profile
3. delegated request
4. delegated result or failure
5. firewall verdict
6. approval decision when applicable
7. Runtime decision
8. final projection or action disposition

Missing join keys must fail replay validation.

## K-DELEG-087 Replay Redaction

Replay may expose redacted output and metadata, but raw credentials,
authorization headers, hidden prompts, and unapproved sensitive provider output
must remain unavailable to SDK/Desktop consumers.

Runtime audit may retain protected evidence according to policy, but replay
views must enforce access and redaction.

## K-DELEG-088 Replay Outcome

Replay outcome values are fixed to:

- `RECONSTRUCTED`
- `PARTIAL_REDACTED`
- `PARTIAL_MISSING_EVIDENCE`
- `BLOCKED_BY_POLICY`
- `INVALID_LINEAGE`

`PARTIAL_MISSING_EVIDENCE` and `INVALID_LINEAGE` are failures whenever replay
is required evidence.

## K-DELEG-089 Delegation Audit Domain

Delegation audit event `domain` values must use `runtime.delegation` or a
more-specific Runtime-owned subdomain such as `runtime.delegation.firewall`.

No Desktop, Avatar, app, MCP, or A2A audit domain may become the canonical
source for delegated decision lineage.

---

<!-- source: .nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md -->

# Delegated Capability Gateway Contract

> Owner Domain: `K-DELEG-*`

This contract admits Runtime-normalized delegated capability provider,
session, request, and result semantics. Protocol adapters such as MCP and
future A2A may be sources of delegated evidence, but their wire objects are not
Runtime authority.

## K-DELEG-001 Delegated Capability Gateway Authority

Runtime owns the Delegated Capability Gateway.

The gateway owns:

- delegated provider registry projection
- delegated provider lifecycle state
- delegated session identity
- normalized delegation request envelopes
- normalized delegation result envelopes
- gateway evidence custody before firewall verdict
- routing into the delegated output firewall

The gateway does not own final Runtime action decisions. Final decisions remain
owned by `K-AGCORE-*` and the Runtime agent decision path.

## K-DELEG-002 Provider Profile Identity

Every delegated provider profile must have a stable `provider_profile_id`.

Required identity fields:

| Field | Type | Required | Authority |
|---|---|---|---|
| `provider_profile_id` | string | yes | Runtime delegation |
| `provider_kind` | enum | yes | Runtime delegation |
| `display_name` | string | yes | Runtime delegation |
| `trust_tier` | enum | yes | Runtime policy |
| `custody_ref` | object | conditional | `K-CONN-*` / `K-KEYSRC-*` |
| `grant_scope_ref` | object | conditional | `K-GRANT-*` |
| `protocol_adapter_ref` | object | yes | adapter-local |
| `lifecycle_state` | enum | yes | Runtime delegation |

`provider_kind` values are fixed to `MCP_TOOL_PROVIDER`, `REMOTE_AGENT_SEAM`,
`RUNTIME_NATIVE_PROVIDER`, and `CONTROLLED_TEST_PROVIDER`. `REMOTE_AGENT_SEAM`
is inactive for production until A2A support is separately admitted.

## K-DELEG-003 Provider Profile Non-Equivalence To Connector

A delegated provider profile is not a Runtime connector record.

It may reference connector custody for endpoint or credential material, but it
must not duplicate connector credentials, connector lifecycle, provider health,
or managed key-source routing. Those facts remain owned by `K-CONN-*` and
`K-KEYSRC-*`.

## K-DELEG-004 Trust Tier

`trust_tier` values are fixed to:

| Value | Meaning |
|---|---|
| `CONTROLLED_LOCAL` | repository-controlled local provider used for tests or product-grade local integration |
| `USER_ADDED_REVIEWED` | user-added provider with explicit review and allowlist |
| `ORG_MANAGED` | organization-managed provider with administrative policy |
| `BLOCKED` | retained profile that cannot be invoked |

Missing trust tier must fail closed.

## K-DELEG-005 Provider Lifecycle State

Delegated provider lifecycle states are fixed to:

| State | Meaning |
|---|---|
| `REGISTERED` | profile exists but no active session is open |
| `DISCOVERING` | Runtime is discovering provider capabilities |
| `READY` | provider can be selected by Runtime policy |
| `DEGRADED` | provider is visible but not eligible for automatic selection |
| `DISABLED` | user or policy disabled provider |
| `QUARANTINED` | provider is blocked due to drift, poisoning, auth, or safety failure |
| `REMOVED` | profile is no longer active |

No lifecycle transition may hide the reason for `DEGRADED`, `DISABLED`, or
`QUARANTINED`.

## K-DELEG-006 Capability Descriptor

Runtime-normalized capability descriptors must use Nimi-owned fields:

| Field | Type | Required |
|---|---|---|
| `capability_id` | string | yes |
| `provider_profile_id` | string | yes |
| `capability_kind` | enum | yes |
| `effect_class` | enum | yes |
| `input_schema_ref` | string | yes |
| `output_shape` | enum | yes |
| `requires_approval` | enum | yes |
| `discovered_at` | timestamp | yes |
| `descriptor_hash` | string | yes |

`capability_kind` values are fixed to `READ_RESOURCE`, `QUERY_DATA`,
`SUGGEST_ACTION`, `PROPOSE_PRESENTATION`, `CREATE_ARTIFACT`, and
`CONTROLLED_TEST`.

## K-DELEG-007 Effect Class

Delegated capability effects are classified before invocation:

| Effect class | Meaning |
|---|---|
| `READ_ONLY` | reads or computes information without durable external effect |
| `LOCAL_SIDE_EFFECT` | changes local temporary state or test fixture state |
| `EXTERNAL_SIDE_EFFECT` | can change external system state |
| `SENSITIVE_READ` | can expose credentials, private data, or regulated data |
| `UNSUPPORTED_EFFECT` | not invokable |

`EXTERNAL_SIDE_EFFECT` and `SENSITIVE_READ` require approval unless a stricter
Runtime policy blocks them.

## K-DELEG-020 Delegated Session

A delegated session is Runtime-owned and must include:

| Field | Type | Required |
|---|---|---|
| `delegation_session_id` | string | yes |
| `provider_profile_id` | string | yes |
| `agent_id` | string | yes |
| `conversation_anchor_id` | string | conditional |
| `runtime_turn_id` | string | conditional |
| `opened_at` | timestamp | yes |
| `session_state` | enum | yes |
| `policy_snapshot_id` | string | yes |
| `audit_trace_id` | string | yes |

Session state values are `OPEN`, `PAUSED_FOR_APPROVAL`, `CLOSING`, `CLOSED`,
and `FAILED`.

## K-DELEG-021 Session Context Boundary

Runtime may pass only policy-approved context slices to delegated providers.

Context slices must be typed as:

- `USER_REQUEST_SUMMARY`
- `RUNTIME_SELECTED_ARGUMENTS`
- `APPROVED_RESOURCE_REF`
- `SAFE_MEMORY_EXCERPT`
- `CONTROLLED_TEST_PAYLOAD`

Raw Runtime memory, raw prompt chains, raw app private state, and raw
`runtime.agent.*` projection streams must not be forwarded as context.

## K-DELEG-030 Delegation Request

Every delegated request must include:

| Field | Type | Required |
|---|---|---|
| `delegation_request_id` | string | yes |
| `delegation_session_id` | string | yes |
| `capability_id` | string | yes |
| `request_kind` | enum | yes |
| `effect_class` | enum | yes |
| `input_ref` | string | yes |
| `context_refs` | list of string | yes |
| `approval_state` | enum | yes |
| `timeout_policy_id` | string | yes |
| `created_at` | timestamp | yes |

`input_ref` points to Runtime-owned typed input material. It must not be an
inline untyped protocol payload.

## K-DELEG-031 Request Kind

Request kind values are fixed to:

- `OBSERVE`
- `QUERY`
- `SUGGEST_INTENT`
- `SUGGEST_TOOL_REQUEST`
- `SUGGEST_PRESENTATION`
- `CREATE_ARTIFACT`
- `CONTROLLED_TEST`

Runtime must reject a request kind that is not listed here.

## K-DELEG-032 Request Approval State

Delegated request approval state values are:

| State | Meaning |
|---|---|
| `NOT_REQUIRED` | Runtime policy allows invocation without user review |
| `REQUIRED_PENDING` | request is paused until approval |
| `APPROVED` | Runtime has recorded an approval decision |
| `REJECTED` | Runtime has recorded rejection |
| `POLICY_BLOCKED` | Runtime policy blocks invocation |

Desktop may render approval UX, but it does not own these states.

## K-DELEG-040 Delegation Result

Every delegated result must include:

| Field | Type | Required |
|---|---|---|
| `delegation_result_id` | string | yes |
| `delegation_request_id` | string | yes |
| `provider_profile_id` | string | yes |
| `result_state` | enum | yes |
| `output_ref` | string | conditional |
| `failure_ref` | string | conditional |
| `provenance_ref` | string | yes |
| `descriptor_hash` | string | yes |
| `received_at` | timestamp | yes |

`output_ref` remains quarantined gateway evidence until the output firewall
emits a verdict.

## K-DELEG-041 Result State

Result state values are fixed to:

- `RECEIVED`
- `STREAMING`
- `COMPLETE`
- `FAILED`
- `TIMED_OUT`
- `CANCELED`
- `PROTOCOL_INVALID`
- `PROVIDER_DRIFTED`

`COMPLETE` does not mean accepted by Runtime. Acceptance is owned by the output
firewall and Runtime decision layer.

## K-DELEG-042 Streaming Result Envelope

Streaming delegated results must use typed stream segments:

| Field | Type | Required |
|---|---|---|
| `stream_segment_id` | string | yes |
| `delegation_result_id` | string | yes |
| `sequence` | integer | yes |
| `segment_kind` | enum | yes |
| `segment_ref` | string | yes |
| `received_at` | timestamp | yes |

`segment_kind` values are `DATA`, `HEARTBEAT`, `PROGRESS`, `TERMINAL_SUCCESS`,
and `TERMINAL_ERROR`.

## K-DELEG-043 Terminal Stream Failure

If a stream ends with `TERMINAL_ERROR`, all unaccepted segments from that result
must remain quarantined and must not enter model context, projection, action
input, or presentation output.

## K-DELEG-044 Protocol Metadata Boundary

Protocol metadata may be stored only as adapter evidence with:

- `protocol_name`
- `protocol_revision`
- `transport_kind`
- `adapter_version`
- `descriptor_hash`

Protocol-specific fields must not be promoted into Runtime semantic contracts
without a new Runtime rule.

## K-DELEG-045 Provider Drift

Runtime must detect descriptor drift by comparing `descriptor_hash` from
discovery, request, and result evidence.

Drift must transition the provider or capability to `DEGRADED` or
`QUARANTINED` until Runtime policy allows rediscovery.

## K-DELEG-046 Inactive Production Consumer Boundary

This contract does not activate production MCP, A2A, Desktop product, or
Avatar consumer implementation. Their target paths remain admitted targets with
no alternate active path until their own contract, implementation, and tests
admit production consumption:

- `delegated-mcp-adapter-contract.md`
- `.nimi/spec/desktop/agent-projection.authority.yaml`
- `delegated-a2a-future-seam-contract.md`
- Avatar reference-only alignment when Avatar consumption changes

---

<!-- source: .nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md -->

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

## K-DELEG-130 MCP Protocol Revision Result Boundary

The 2026-07-28 MCP revision introduces negotiated extensions, model-requested
tool results (`inputRequests`), and task handles. None of them is admitted
into the Runtime MCP adapter surface.

Fixed rules:

- the Runtime MCP gateway advertises no MCP extensions during connect and
  treats extension negotiation results as quarantined adapter evidence only
  (`K-DELEG-044`)
- a `tools/call` result carrying MRTR `inputRequests`, an unsolicited task
  handle, or any extension-negotiated continuation is not a supported result
  shape; it must fail closed as result-invalid (`K-DELEG-108`, `K-DELEG-114`)
  instead of being partially accepted, deferred, or silently stripped
- the gateway must not poll, resume, or acknowledge task handles; task
  lifecycle participation is not admitted by this contract
- a future remote-HTTP transport admission must satisfy the stateless
  no-session-affinity model and the revision's required request headers, and
  requires its own packet; nothing in this rule pre-admits it

---

<!-- source: .nimi/spec/runtime/kernel/delegated-output-firewall-contract.md -->

# Delegated Output Firewall Contract

> Owner Domain: `K-DELEG-*`

The delegated output firewall is the only path from delegated provider output
to Runtime model context, decisions, projection, app action input, or Avatar
presentation. Delegated output is hostile until this contract accepts or
quarantines it.

## K-DELEG-050 Firewall Authority

Runtime owns the delegated output firewall.

The firewall owns:

- schema validation for delegated output
- provenance validation
- confidence and evidence normalization
- poisoning and prompt-injection screening
- sensitive data classification
- stream segment acceptance state
- verdict emission

The firewall does not own final action execution. It emits accepted evidence or
suggestions that `K-AGCORE-*` may consume.

## K-DELEG-051 Firewall Input

Firewall input must reference a `delegation_result_id` from
`K-DELEG-040`. Direct protocol payloads are not valid firewall inputs.

Required fields:

| Field | Type | Required |
|---|---|---|
| `firewall_input_id` | string | yes |
| `delegation_result_id` | string | yes |
| `candidate_output_ref` | string | yes |
| `provider_profile_id` | string | yes |
| `capability_id` | string | yes |
| `descriptor_hash` | string | yes |
| `received_at` | timestamp | yes |

## K-DELEG-052 Firewall Verdict

Firewall verdict values are fixed to:

- `ACCEPTED_OBSERVATION`
- `ACCEPTED_SUGGESTION`
- `APPROVAL_REQUIRED`
- `QUARANTINED`
- `REJECTED`
- `PROVIDER_DRIFTED`
- `SCHEMA_INVALID`
- `POLICY_BLOCKED`

Missing verdict must fail closed.

## K-DELEG-053 Provenance Record

Every accepted or quarantined output must have a provenance record:

| Field | Type | Required |
|---|---|---|
| `provenance_id` | string | yes |
| `provider_profile_id` | string | yes |
| `capability_id` | string | yes |
| `delegation_request_id` | string | yes |
| `delegation_result_id` | string | yes |
| `descriptor_hash` | string | yes |
| `protocol_name` | string | yes |
| `protocol_revision` | string | yes |
| `received_at` | timestamp | yes |

Provenance records must not include raw credentials or authorization headers.

## K-DELEG-054 Confidence Semantics

Delegated confidence is Runtime-normalized and must include:

| Field | Type | Required |
|---|---|---|
| `confidence_level` | enum | yes |
| `confidence_score` | decimal string | conditional |
| `evidence_count` | integer | yes |
| `requires_user_confirmation` | boolean | yes |
| `confidence_reason` | enum | yes |

`confidence_level` values are `HIGH`, `MEDIUM`, `LOW`, and `UNSUPPORTED`.
Provider-native scores may inform `confidence_score`, but cannot bypass Runtime
normalization.

## K-DELEG-055 Evidence Reference

Evidence references are typed and must use one of:

- `PROVIDER_OUTPUT`
- `RESOURCE_SNAPSHOT`
- `TOOL_DESCRIPTOR`
- `USER_APPROVAL`
- `RUNTIME_POLICY`
- `CONTROLLED_FIXTURE`

Evidence references point to Runtime-owned evidence custody. They must not be
raw unbounded protocol objects.

## K-DELEG-056 Accepted Observation

An accepted observation is information Runtime may use as context.

Required fields:

| Field | Type | Required |
|---|---|---|
| `observation_id` | string | yes |
| `delegation_result_id` | string | yes |
| `observation_kind` | enum | yes |
| `content_ref` | string | yes |
| `confidence_ref` | string | yes |
| `provenance_ref` | string | yes |

Observation kind values are `FACTUAL_SUMMARY`, `RESOURCE_STATE`,
`DIAGNOSTIC_STATE`, and `CONTROLLED_TEST_RESULT`.

## K-DELEG-057 Accepted Suggestion

Accepted suggestions are not actions.

Suggestion families are:

- `suggested_intent`
- `suggested_tool_request`
- `suggested_presentation`

Runtime must still decide whether to ignore, ask for approval, convert to a
Runtime-owned tool request, convert to presentation projection, or emit a
diagnostic failure.

## K-DELEG-058 Suggested Intent

`runtime.delegation.suggested_intent.*` must include:

| Field | Type | Required |
|---|---|---|
| `suggested_intent_id` | string | yes |
| `intent_kind` | enum | yes |
| `summary_ref` | string | yes |
| `confidence_ref` | string | yes |
| `approval_requirement` | enum | yes |

Intent kind values are `ANSWER_USER`, `ASK_CLARIFYING_QUESTION`,
`REQUEST_TOOL`, `REQUEST_PRESENTATION`, and `NO_ACTION`.

## K-DELEG-059 Suggested Tool Request

`runtime.delegation.suggested_tool_request.*` must include:

| Field | Type | Required |
|---|---|---|
| `suggested_tool_request_id` | string | yes |
| `runtime_tool_kind` | enum | yes |
| `argument_ref` | string | yes |
| `effect_class` | enum | yes |
| `approval_requirement` | enum | yes |

The suggested request cannot execute directly. Runtime must re-authorize and
emit a Runtime-owned request if it accepts the suggestion.

## K-DELEG-060 Suggested Presentation

`runtime.delegation.suggested_presentation.*` must include:

| Field | Type | Required |
|---|---|---|
| `suggested_presentation_id` | string | yes |
| `presentation_kind` | enum | yes |
| `projection_target` | enum | yes |
| `content_ref` | string | yes |
| `confidence_ref` | string | yes |

Projection targets are `DESKTOP`, `AVATAR`, and `SDK_CONSUMER`. Avatar targets
must still pass through typed `runtime.agent.*` projection.

## K-DELEG-061 Artifact

`runtime.delegation.artifact.*` must include:

| Field | Type | Required |
|---|---|---|
| `artifact_id` | string | yes |
| `artifact_kind` | enum | yes |
| `artifact_ref` | string | yes |
| `provenance_ref` | string | yes |
| `content_hash` | string | yes |
| `retention_class` | enum | yes |

Artifact kind values are `TEXT`, `JSON_DOCUMENT`, `IMAGE`, `AUDIO`, `VIDEO`,
`BINARY`, and `CONTROLLED_FIXTURE`.

## K-DELEG-062 Quarantine

Quarantined output must retain enough evidence for audit without becoming model
context or presentation.

Quarantine fields:

- `quarantine_id`
- `delegation_result_id`
- `reason_code`
- `provenance_ref`
- `unsafe_excerpt_ref`
- `created_at`
- `review_state`

`unsafe_excerpt_ref` must be redacted or access-controlled according to
Runtime policy.

## K-DELEG-063 Failure Record

`runtime.delegation.failure.*` must include:

| Field | Type | Required |
|---|---|---|
| `failure_id` | string | yes |
| `delegation_request_id` | string | conditional |
| `delegation_result_id` | string | conditional |
| `reason_code` | enum | yes |
| `failure_stage` | enum | yes |
| `retry_class` | enum | yes |
| `message_ref` | string | yes |

Failure stage values are `DISCOVERY`, `REQUEST_BUILD`, `PROVIDER_CALL`,
`STREAMING`, `FIREWALL`, `APPROVAL`, and `DECISION`.

## K-DELEG-064 Failure Reason Codes

Delegation reason codes are defined in
`tables/delegation-reason-codes.yaml`. They are Runtime delegation reason
codes and must be mapped to public error projection through existing error
contracts when exposed.

## K-DELEG-065 Streaming Firewall

Every stream segment from `K-DELEG-042` is untrusted.

The firewall may accept a segment or aggregate segment group only after:

- segment schema is valid
- provenance matches the parent result
- descriptor hash is unchanged
- sensitive data policy is satisfied
- poisoning checks pass
- terminal state is coherent

Unaccepted partial output must remain quarantined.

## K-DELEG-066 Terminal Stream Error Handling

A terminal stream error invalidates all unaccepted partial output from that
delegation result. Runtime may keep evidence for audit, but it must not use the
partial output as model context, action input, projection, or presentation.

## K-DELEG-067 Prompt And Tool Poisoning

The firewall must treat tool descriptors, prompt-like resource content,
provider output, and remote agent messages as possible instruction-bearing
payloads.

Instruction-bearing payloads that attempt to override Runtime policy, reveal
hidden context, change tool routing, exfiltrate credentials, or bypass approval
must be quarantined or rejected.

## K-DELEG-068 Sensitive Data Classification

Sensitive output classification values are:

- `NONE`
- `USER_PRIVATE`
- `CREDENTIAL_LIKE`
- `ORG_PRIVATE`
- `REGULATED`
- `UNKNOWN_SENSITIVE`

`CREDENTIAL_LIKE`, `REGULATED`, and `UNKNOWN_SENSITIVE` require quarantine or
explicit policy approval before further use.

## K-DELEG-069 Approval Requirement Derivation

The firewall derives approval requirement from:

- effect class
- sensitivity class
- confidence level
- provider trust tier
- policy snapshot
- user or organization rule

Approval requirement values are `NOT_REQUIRED`, `REQUIRED`, and
`POLICY_BLOCKED`.

## K-DELEG-070 Model Context Admission

Accepted observations may enter Runtime model context only through a
Runtime-owned context builder that records `observation_id`, `provenance_id`,
and `confidence_ref`.

Raw provider output must not be inserted directly.

## K-DELEG-071 Projection Admission

Accepted presentation suggestions may influence `runtime.agent.*` projection
only after Runtime decision. Avatar and Desktop must consume the final typed
projection, not firewall input or raw provider output.

## K-DELEG-072 Action Admission

Accepted tool suggestions may become actions only after Runtime re-authorizes
the action through existing auth, grant, and Runtime agent decision rules.

## K-DELEG-073 Firewall Audit Link

Every firewall verdict must link to audit and replay through:

- `delegation_request_id`
- `delegation_result_id`
- `firewall_input_id`
- `provenance_id`
- `verdict`
- `reason_code`

## K-DELEG-074 Fail-Closed Default

Missing schema, missing provenance, missing descriptor hash, invalid stream
sequence, unknown provider, unknown capability, unknown approval state, or
unknown sensitivity class must fail closed.

## K-DELEG-075 Artifact Retention Class

Delegated artifact retention classes are fixed to `EPHEMERAL_EVIDENCE`,
`REPLAY_EVIDENCE`, `USER_VISIBLE_ARTIFACT`, and `QUARANTINED_EVIDENCE`.

`USER_VISIBLE_ARTIFACT` requires Runtime decision acceptance before SDK,
Desktop, Web, Avatar, or app consumption.

## K-DELEG-076 Artifact Hash Requirement

Every delegated artifact must have a content hash before it is accepted,
quarantined, or replayed. Missing hash must emit `DELEG_ARTIFACT_HASH_MISSING`.

## K-DELEG-077 Artifact Projection Boundary

Delegated artifacts are not `runtime.agent.*` projection. Runtime may create a
typed projection referencing an accepted artifact, but consumers must not infer
presentation truth from artifact custody alone.

## K-DELEG-078 Artifact Evidence Custody

Artifact evidence custody remains Runtime-owned. Provider URLs, temporary files,
or adapter-local handles cannot be used as durable Nimi artifact identity.

## K-DELEG-079 Artifact Failure Handling

If artifact fetch, hash, classification, or retention fails, Runtime must emit a
delegation failure and must not synthesize placeholder artifact success.

## K-DELEG-080 Failure Authority

Delegation failure records are canonical Runtime delegation facts. They do not
replace `K-ERR-*`, but they provide delegation-specific failure stage, retry,
and replay semantics.

## K-DELEG-081 Retry Class

Retry class values are fixed to `NEVER_RETRY`, `SAFE_RETRY`,
`RETRY_AFTER_REVIEW`, and `PROVIDER_REDISCOVERY_REQUIRED`.

`PROVIDER_REDISCOVERY_REQUIRED` must not retry the same descriptor hash.

## K-DELEG-082 Failure Projection

Failure projection to SDK/Desktop must use typed reason codes and failure
stages. User-facing surfaces may localize the message, but they must not hide
quarantine, policy block, or approval rejection.

## K-DELEG-083 No Silent Fallback

A delegated failure must not silently fall back to another provider, local
fabrication, cached stale output, or model-generated substitute. Runtime may
choose a new provider only through a new delegated request with independent
audit lineage.

## K-DELEG-084 Failure Reason Code Mapping

Delegation failure reason codes are listed in
`tables/delegation-reason-codes.yaml`. Public error projection may map these
codes to existing transport errors, but the original delegation reason code
must remain available in audit and replay.
