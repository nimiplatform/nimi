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
