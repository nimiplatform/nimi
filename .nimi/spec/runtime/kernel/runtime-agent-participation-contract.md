# Runtime Agent Participation Contract

> Owner Domain: `K-AGCORE-*`

This contract admits Runtime-owned agent participation semantics for contexts
that are not always canonical 1:1 Agent Chat.

It materializes the wave-1 frozen authority model from
`2026-05-02-runtime-agent-participation-authority`. It does not create SDK,
proto, Desktop, Avatar, app, Realm implementation, OASIS, Scenario, A2A
production, MCP production, or mod surfaces.

## K-AGCORE-061 Runtime Participation Authority

Runtime owns agent participation execution semantics.

It owns:

- participation profile validation
- typed context block admission
- prompt assembly policy for participation execution
- AI consume / provider routing for participation execution
- output candidate schema
- memory read verdict
- memory write verdict
- capability scope verdict
- audit/replay linkage
- same-agent cross-profile concurrency admission

Runtime does not own:

- Realm GROUP thread, membership, message, read-state, sync, or commit truth
- Scenario package, run, branch, replay, or transcript truth
- OASIS/world state, event log, or product ontology
- Desktop, Web, Avatar, or mod UI state
- A2A or MCP protocol wire truth

## K-AGCORE-062 Non-Canonical Candidate Posture

Every participation profile except `canonical_agent_chat` is non-canonical by
default.

Non-canonical output:

- must be returned as an output candidate
- must not write memory by default
- must not commit cognition by default
- must not write AgentRule by default
- must not become canonical chat history by default

Promotion into memory, cognition, AgentRule, or canonical chat requires a later
explicit promotion authority.

## K-AGCORE-063 Axis Registry

Participation axes are closed and defined by
`tables/agent-participation-axis-model.yaml`.

The fixed axis families are:

- `transcript_owner`
- `identity_source`
- `execution_owner`
- `memory_read_scope`
- `memory_write_default`
- `capability_scope`
- `input_trust`
- `output_destination`
- `promotion_posture`
- `execution_concurrency`

Apps, SDKs, mods, and product domains must not submit open string axis values.

## K-AGCORE-064 Transcript Owner Axis

`transcript_owner` identifies the owner of transcript or event-log truth.

Fixed values:

- `RUNTIME`
- `REALM`
- `SCENARIO_MODULE`
- `OASIS_WORLD_DOMAIN`
- `EXTERNAL_DOMAIN`
- `EPHEMERAL`

Transcript owner does not imply execution owner.

## K-AGCORE-065 Identity Source Axis

`identity_source` identifies the owner and meaning of the participant identity.

Fixed values:

- `USER_OWNED_NIMI_AGENT`
- `EXTERNAL_A2A_AGENT`
- `MCP_BACKED_AI_CAPABILITY`
- `SANDBOX_PROJECTION`
- `NPC_WORLD_ACTOR`

`SANDBOX_PROJECTION` is an admitted Nimi/user agent projected into a scenario
role. `NPC_WORLD_ACTOR` is domain-owned actor truth. They are not aliases.

## K-AGCORE-066 Execution Owner Axis

`execution_owner` identifies who assembles prompt/context and calls AI.

Fixed values:

- `RUNTIME`
- `EXTERNAL_RUNTIME_VIA_ADMITTED_GATEWAY`
- `NOT_ADMITTED`

External execution does not transfer boundary ownership. Runtime still owns
gateway verdict, policy, audit, and output candidate semantics.

## K-AGCORE-067 Memory Read Scope Axis

`memory_read_scope` identifies which memory may be loaded into participation
execution context.

Fixed values:

- `CANONICAL_OWNER_POLICY`
- `DYADIC_PRIVATE_ALLOWED`
- `DYADIC_PRIVATE_EXCLUDED`
- `PUBLIC_SHARED_ONLY`
- `DOMAIN_SHARED_ONLY`
- `NO_MEMORY_READ`

Non-canonical participation profiles must not read dyadic/private canonical
memory by default.

## K-AGCORE-068 Memory Write Default Axis

`memory_write_default` identifies whether participation output may write durable
agent truth by default.

Fixed values:

- `CANONICAL_WRITE_ALLOWED`
- `WRITE_NONE`
- `PROMOTION_GATED`

`WRITE_NONE` is the default for non-canonical profiles.

## K-AGCORE-069 Capability Scope Axis

`capability_scope` identifies which tools, files, delegated capabilities,
AgentRule mutations, paid/cloud operations, or provider access may be used.

Fixed values:

- `CANONICAL_AGENT_SCOPE`
- `PROFILE_LIMITED`
- `DOMAIN_LIMITED`
- `DIAGNOSTIC_READ_ONLY`
- `EXTERNAL_GATEWAY_LIMITED`
- `NONE`

Canonical Agent Chat capability grants do not carry into non-canonical
participation profiles by default.

## K-AGCORE-070 Input Trust Axis

`input_trust` identifies how prompt assembly must rank and isolate input.

Fixed values:

- `TRUSTED_USER`
- `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`
- `SANDBOX_SCRIPT`
- `EXTERNAL_A2A_PAYLOAD`
- `TOOL_PROVIDER_PAYLOAD`
- `WORLD_CONTEXT`
- `DIAGNOSTIC_INPUT`

Untrusted transcript and protocol payload content must remain below Runtime
system, policy, and profile instructions in prompt assembly.

## K-AGCORE-071 Output Destination Axis

`output_destination` identifies where an output candidate may be committed.

Fixed values:

- `CANONICAL_CHAT`
- `REALM_GROUP_MESSAGE_CANDIDATE`
- `SCENARIO_TURN_CANDIDATE`
- `WORLD_EVENT_CANDIDATE`
- `EXTERNAL_REPLY_CANDIDATE`
- `DIAGNOSTIC_CANDIDATE`
- `EPHEMERAL`

Candidate destination does not authorize direct domain commit.

## K-AGCORE-072 Promotion Posture Axis

`promotion_posture` identifies whether and how non-canonical output may become
durable agent truth.

Fixed values:

- `NOT_ALLOWED`
- `EXPLICIT_CANDIDATE`
- `EXPLICIT_COMMIT_FLOW`
- `EXISTING_CANONICAL_POLICY`

Promotion remains fail-closed until a later authority admits the promotion flow.

## K-AGCORE-073 Execution Concurrency Axis

`execution_concurrency` identifies how simultaneous participation triggers for
the same agent are admitted.

Fixed values:

- `CANONICAL_CHAT_BUDGET`
- `PER_AGENT_PARTICIPATION_QUEUE`
- `PROFILE_ISOLATED_BUDGET`
- `DOMAIN_TRIGGER_QUEUE`
- `REJECT_WHILE_ACTIVE`
- `GATEWAY_BUDGET_QUEUE`
- `LOW_PRIORITY_CANCELABLE`

Runtime owns same-agent cross-profile queueing, cancellation, and budget
admission. Apps, Realm, Scenario, OASIS/world, external gateways, and debug
surfaces must not own this decision.

This axis must preserve `K-AGCORE-002`, `K-AGCORE-007`, and `K-AGCORE-027`.
It does not create a second Chat Track, Life Track, token-budget, or cadence
owner.

## K-AGCORE-074 Profile Registry

Participation profile kinds are closed and defined by
`tables/agent-participation-profiles.yaml`.

Fixed profile kinds:

- `canonical_agent_chat`
- `realm_group_agent`
- `scenario_sandbox`
- `oasis_world_participation`
- `external_agent_entry`
- `debug_or_probe`

Profiles are axis compositions. They are not product-local lane names and must
not be open string extensible by apps.

## K-AGCORE-075 Canonical Agent Chat Reference Profile

`canonical_agent_chat` references existing `RuntimeAgentService` authority.

It does not rewrite:

- canonical conversation anchors
- Chat Track / Life Track separation
- token budget authority
- Life Track cadence authority
- admitted canonical memory policy

Those remain governed by `K-AGCORE-*`.

## K-AGCORE-076 Realm Group Agent Profile

`realm_group_agent` represents a Runtime-executed agent reply candidate for a
Realm GROUP transcript.

Fixed posture:

- `transcript_owner = REALM`
- `execution_owner = RUNTIME` by default
- `memory_read_scope = DYADIC_PRIVATE_EXCLUDED`
- `memory_write_default = WRITE_NONE`
- `capability_scope = PROFILE_LIMITED`
- `input_trust = UNTRUSTED_MULTI_PARTY_TRANSCRIPT`
- `output_destination = REALM_GROUP_MESSAGE_CANDIDATE`
- `promotion_posture = EXPLICIT_CANDIDATE`
- `execution_concurrency = PER_AGENT_PARTICIPATION_QUEUE`

Runtime must not directly commit GROUP messages. Realm-authenticated commit and
anti-spoof validation remain governed by `R-CHAT-*`.

## K-AGCORE-077 Scenario Sandbox Profile

`scenario_sandbox` is a future-consumer profile.

It does not admit Scenario product ontology, scenario package truth, scenario
prompt language, or scenario implementation.

Fixed posture:

- memory read is domain-shared or no-read by default
- memory write is `WRITE_NONE`
- capability scope is scenario/domain limited
- output is a scenario turn candidate

## K-AGCORE-078 OASIS World Participation Profile

`oasis_world_participation` is a future-consumer profile for world/domain
contexts.

It does not admit OASIS/world product ontology.

Fixed posture:

- memory read is world-shared or no-read by default
- memory write is `WRITE_NONE`
- capability scope is world/domain limited
- output is a world event/domain candidate

## K-AGCORE-079 External Agent Entry Profile

`external_agent_entry` represents an external A2A/MCP participant normalized
through Runtime boundary.

It requires:

- external identity reference
- gateway verdict reference
- domain context reference
- no Nimi private memory read by default
- `WRITE_NONE` memory write default
- external-gateway-limited capability scope

A2A and MCP protocol payloads remain non-authoritative. `K-DELEG-*` owns the
gateway/protocol boundary and is not modified by this contract.

## K-AGCORE-080 Debug Or Probe Profile

`debug_or_probe` represents diagnostic participation.

It consumes existing `K-AGCORE-036..052` projection surfaces and does not create
presentation truth ontology.

Fixed posture:

- diagnostic-minimal memory read
- `WRITE_NONE` memory write default
- diagnostic read-only capability scope
- diagnostic/probe candidate output
- `NOT_ALLOWED` promotion posture

## K-AGCORE-081 Context Block Registry

Typed context blocks are closed and defined by
`tables/agent-participation-context-blocks.yaml`.

Context blocks must be profile-scoped. Product domains may provide typed
references, projections, and gateway verdict references, but they must not
submit raw prompt blobs as public participation input.

## K-AGCORE-082 Output Candidate

Every Runtime participation execution returns a typed output candidate.

Required fields:

| Field | Type | Required |
|---|---|---|
| `participation_id` | string | yes |
| `profile_kind` | enum | yes |
| `agent_id` | string | conditional |
| `identity_source` | enum | yes |
| `participant_ref` | string | yes |
| `trigger_ref` | string | yes |
| `context_block_refs` | list of string | yes |
| `output_destination` | enum | yes |
| `candidate_ref` | string | yes |
| `policy_verdict_ref` | string | yes |
| `memory_read_verdict` | enum | yes |
| `memory_write_verdict` | enum | yes |
| `capability_scope_verdict` | enum | yes |
| `audit_id` | string | yes |
| `created_at` | timestamp | yes |

Inline raw provider output, raw prompt chains, or raw protocol payloads are not
admitted as public candidate fields.

## K-AGCORE-083 Domain Commit Separation

Output candidates do not commit domain transcript truth.

Domain commit remains owned by the domain:

- Realm GROUP commit remains `R-CHAT-*`
- Scenario transcript commit remains future Scenario authority
- OASIS/world event commit remains future world authority
- external reply commit remains the owning domain/external path

## K-AGCORE-084 Memory Policy Tables

Memory read and write policy defaults are defined by:

- `tables/agent-participation-memory-read-scopes.yaml`
- `tables/agent-participation-memory-policy.yaml`

Non-canonical profiles must default to no dyadic/private canonical memory read
and no memory/cognition/canonical-chat write.

## K-AGCORE-085 Capability Scope Table

Capability scope defaults are defined by
`tables/agent-participation-capability-scopes.yaml`.

Canonical Agent Chat capability grants must not automatically carry into
non-canonical participation profiles.

AgentRule mutation, private file access, paid/cloud capability use, external
provider calls, and delegated tool execution require an admitted capability
scope for the active participation profile.

## K-AGCORE-086 Concurrency Policy Table

Same-agent cross-profile admission is defined by
`tables/agent-participation-concurrency-policy.yaml`.

Runtime owns:

- cross-profile queueing
- cancellation
- budget admission
- active execution rejection
- audit linkage for admission decisions

This policy must preserve `K-AGCORE-002`, `K-AGCORE-007`, and `K-AGCORE-027`.

## K-AGCORE-087 Audit And Replay

Participation execution audit must layer on existing Runtime audit authority.

Fixed rules:

- audit event fields must satisfy `K-AUDIT-001` and `K-AUDIT-006`
- participation audit may add domain extension fields
- replay lineage must reference `audit_id`
- no participation-specific side audit store is admitted
- delegated external-entry replay may reference `K-DELEG-085` and
  `K-DELEG-086` as external evidence lineage, without modifying `K-DELEG-*`

## K-AGCORE-088 Public Raw Prompt Boundary

Public participation surfaces must not accept raw prompt blobs as their primary
semantic input.

Allowed public input shape is typed context block references plus policy and
identity refs.

Runtime-internal backend parameters such as private `systemPrompt` fields are
implementation details. They are not public raw-prompt APIs by themselves.
