# Runtime Agent Participation Contract

> Owner Domain: `K-AGCORE-*`

This contract admits Runtime-owned agent participation semantics for contexts
that are not always canonical 1:1 Agent Chat.

It defines Runtime authority only. It does not create SDK, proto, Desktop,
Avatar, app, Realm implementation, OASIS, Scenario, A2A production, or MCP
production surfaces.

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
- Desktop, Web, or Avatar UI state
- A2A or MCP protocol wire truth

## K-AGCORE-062 Non-Canonical Candidate Posture

Every participation profile except `canonical_agent_chat` is non-canonical by
default.

Non-canonical output:

- must be returned as an output candidate
- must not write memory by default
- must not commit cognition by default
- must not mutate Realm source-core by default
- must not become canonical chat history by default

Promotion into memory, cognition, Realm source-core, or canonical chat requires a
separate explicit promotion authority.

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

Apps, SDKs, and product domains must not submit open string axis values.

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
Realm source-core mutations, paid/cloud operations, or provider access may be used.

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
