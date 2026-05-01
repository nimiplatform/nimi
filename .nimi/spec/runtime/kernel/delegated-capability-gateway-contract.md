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
is future-only until a later A2A wave admits production support.

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

## K-DELEG-046 Later-Wave Target Status

Wave-1 does not activate production MCP, A2A, Desktop product, or Avatar
consumer implementation. Their target paths remain admitted targets with no
alternate active path:

- `delegated-mcp-adapter-contract.md` is owned by wave-2.
- `agent-delegation-control-surface-contract.md` is owned by wave-5.
- `delegated-a2a-future-seam-contract.md` is owned by wave-7.
- Avatar reference-only alignment is owned by the wave that first changes
  Avatar consumption.
