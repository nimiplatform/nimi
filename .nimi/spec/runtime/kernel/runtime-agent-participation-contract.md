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
- must not write AgentRule by default
- must not become canonical chat history by default

Promotion into memory, cognition, AgentRule, or canonical chat requires a
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

## K-AGCORE-089 External Entry Boundary Matrix

External-entry boundary rules are defined by
`tables/agent-participation-external-entry-boundaries.yaml`.

The matrix is the Runtime participation view over external protocol pressure. It
does not define protocol wire truth and does not rewrite `K-DELEG-*`.

Every external-entry boundary row must declare:

- participation profile
- identity source
- input trust
- protocol authority contract and rule range
- required context blocks
- required gateway/firewall/audit/credential verdict references
- memory read scope
- memory write default
- capability scope
- output destination
- promotion posture
- production-claim posture

## K-AGCORE-090 MCP-Backed AI Capability Entry

`MCP_BACKED_AI_CAPABILITY` is admitted only as delegated gateway evidence for
the `external_agent_entry` participation profile.

Fixed posture:

- `K-DELEG-100..119` owns MCP adapter/protocol authority
- MCP wire objects, tool schemas, tool output, and provider metadata are not
  Runtime participation semantic authority
- Runtime participation may consume only typed gateway verdict, delegated
  firewall verdict, credential custody reference, audit lineage, and typed
  output candidate references
- pre-firewall MCP output consumption is forbidden
- Nimi memory, cognition, canonical chat, Realm GROUP, and product-domain writes
  are forbidden by default

## K-AGCORE-091 Future A2A External Agent Entry

`EXTERNAL_A2A_AGENT` is a future-seam participation identity source only.

Fixed posture:

- `K-DELEG-120..129` owns A2A future-seam and no-production posture
- A2A task payloads, agent cards, remote state, and protocol metadata are not
  Runtime participation semantic authority
- production A2A adapter activation, Runtime registration, SDK/proto public
  surface, app/Desktop UI claim, and fake-server success are forbidden without a
  separate high-risk admission
- future A2A entry must still pass Runtime gateway, policy, audit, and firewall
  boundaries before any projection or action
- Nimi memory, cognition, canonical chat, Realm GROUP, and product-domain writes
  are forbidden by default

## K-AGCORE-092 External Principal Writeback Boundary

External participants cannot commit Nimi semantic truth by default.

Forbidden writeback targets:

- Runtime memory
- cognition memory/commit surfaces
- canonical chat history
- Realm GROUP transcript
- Scenario transcript
- OASIS/world event truth
- product-domain transcript or state truth

Any future promotion from external output requires a later explicitly admitted
promotion path and must preserve `K-AGCORE-084`, `K-AGCORE-087`, `K-DELEG-*`,
`K-MEM-*`, and cognition authority.

## K-AGCORE-093 External Entry Gateway Chain

External-entry projection is fail-closed unless the gateway chain is complete.

The required order is:

1. external identity evidence
2. protocol adapter or future admission check
3. gateway verdict
4. delegated firewall verdict when protocol execution occurs
5. capability scope verdict
6. memory read verdict
7. memory write verdict
8. audit lineage record
9. output candidate projection

Pre-verdict consumption is forbidden. Missing verdicts fail closed.

## K-AGCORE-094 External Entry Negative Gates

External-entry alignment must be audited with negative gates for:

- production A2A claims
- direct MCP clients outside Runtime delegated adapter paths
- direct A2A clients outside a future admitted Runtime adapter
- raw protocol payload public participation fields
- `K-DELEG-*` rule redefinition in participation waves
- fake external server success

Matches in `K-DELEG-*` contracts, generated docs, or explicit prohibition text
are allowed evidence only when they preserve protocol/gateway ownership and do
not create public implementation support.

## K-AGCORE-095 Domain Future Seam Matrix

Domain future-consumer seam rules are defined by
`tables/agent-participation-domain-future-seams.yaml`.

The matrix describes how OASIS/world and Scenario Sandbox may consume Runtime
participation authority in the future. It does not implement those product
domains and does not redefine their transcript, state, history, run, replay, or
commit truth.

Every domain future seam row must declare:

- participation profile
- transcript owner
- identity source
- execution owner
- authority references
- required context blocks
- admitted typed context shape
- forbidden raw context shape
- memory read scope
- memory write default
- capability scope
- output destination
- promotion posture
- commit owner
- Runtime direct-commit posture
- product ontology implementation posture

## K-AGCORE-096 OASIS World Participation Future Seam

`oasis_world_participation` is a future-consumer seam for world participation.

Runtime participation may consume typed world context, event, visible state, and
recent transcript/event projections. Runtime participation must not define world
product ontology, world prompt shape, Realm/OASIS truth, world history, or world
commit authority.

Fixed posture:

- `K-WEV-*` may be referenced for Runtime-local world execution evidence only
- Realm/OASIS world truth and history remain domain-owned
- public raw world prompt blobs are forbidden
- app-local world agent execution authority is forbidden
- output remains a `WORLD_EVENT_CANDIDATE`
- Runtime direct world truth commit is forbidden
- memory/cognition/canonical-chat writes remain forbidden until a later
  promotion wave admits them

## K-AGCORE-097 Scenario Sandbox Future Seam

`scenario_sandbox` is a pending future-consumer seam for a standalone Scenario
Sandbox product domain.

Runtime participation may consume typed scenario package, run, branch, visible
scene state, and recent sandbox transcript projections. Runtime participation
must not implement scenario product ontology, scenario replay branches, scenario
transcript storage, ScenarioJob execution, or custom prompt APIs.

Fixed posture:

- the pending Scenario Sandbox topic remains product-domain pressure, not active
  implementation
- `K-JOB-*` may be referenced only as existing ScenarioJob lifecycle authority
- public raw scenario prompt blobs and custom prompt APIs are forbidden
- app-local scenario agent execution authority is forbidden
- output remains a `SCENARIO_TURN_CANDIDATE`
- Runtime direct scenario transcript/run/replay commit is forbidden
- memory/cognition/canonical-chat writes remain forbidden until a later
  promotion wave admits them

## K-AGCORE-098 Domain Truth Separation

Runtime participation owns execution semantics only.

For domain future seams, the following remain outside Runtime participation
truth:

- OASIS/world state
- OASIS/world history
- OASIS/world commit authorization
- Scenario package ontology
- Scenario run, branch, and replay truth
- Scenario transcript storage
- product-domain visible state truth

Runtime participation output candidates are not domain commits.

## K-AGCORE-099 Product Implementation Gates

OASIS/world and Scenario Sandbox product implementation require separate
admission.

This contract does not admit:

- OASIS/world product UI or backend implementation
- Scenario Sandbox product UI or backend implementation
- ScenarioJob execution changes
- SDK/proto/app/Desktop/Avatar public surfaces
- promotion implementation
- world/scenario product success fixtures

## K-AGCORE-100 Domain Future Seam Negative Gates

Domain future seams must be audited with negative gates for:

- raw world prompt blobs
- raw scenario prompt blobs
- Runtime direct world truth commit
- Runtime direct scenario transcript/run/replay commit
- app-local world agent execution
- app-local scenario agent execution
- fake world/scenario product success
- memory/cognition/canonical-chat writes before promotion admission

Matches in Runtime/Realm kernel contracts, generated docs, pending-topic notes,
or explicit prohibition text are allowed evidence only when they preserve domain
truth ownership and do not create product implementation support.

## K-AGCORE-101 Promotion Boundary Registry

Promotion boundaries are defined by
`tables/agent-participation-promotion-boundaries.yaml`.

Promotion is explicit candidate admission. It is not default write behavior and
it is not a transport implementation.

Every promotion target row must declare:

- target id
- owning authority contract or future authority
- owning rule family
- admitted source profiles
- forbidden source profiles
- required evidence
- default write posture
- direct-write posture
- missing-evidence policy

## K-AGCORE-102 Runtime Memory Or Cognition Promotion Target

Promotion into Runtime memory or cognition may be admitted only through the
owning `K-MEM-*` and `C-COG-*` authority boundaries.

Runtime participation must not directly write memory or cognition. It may only
produce a promotion candidate carrying output candidate provenance, audit
lineage, policy verdicts, memory/capability verdicts, target owner
authorization, and explicit user or manager intent.

External-entry and debug/probe profiles are not admitted as source profiles for
this target.

## K-AGCORE-103 Canonical Chat Promotion Target

Promotion into canonical chat must preserve existing RuntimeAgentService
canonical chat authority.

Runtime participation must not append canonical chat history directly. It may
only produce a promotion candidate for owner-authorized canonical handling.

External-entry and debug/probe profiles are not admitted as source profiles for
this target.

## K-AGCORE-104 Realm GROUP Transcript Promotion Target

Realm GROUP transcript commit remains owned by Realm Chat.

Runtime participation must not directly commit Realm GROUP messages. A Realm
GROUP promotion candidate is valid only for `realm_group_agent` and must carry
Realm thread, agent slot, audit, output candidate, and authenticated commit
references.

## K-AGCORE-105 Domain Truth Promotion Target

Domain truth promotion remains owned by the target domain.

Runtime participation must not directly commit:

- OASIS/world state
- OASIS/world history
- Scenario transcript
- Scenario run/branch/replay truth
- external-domain truth

`scenario_sandbox` and `oasis_world_participation` may produce domain truth
promotion candidates only when target domain owner authorization and target
commit candidate references are present.

## K-AGCORE-106 Promotion Fail-Closed Invariants

Promotion is fail-closed.

Forbidden:

- non-canonical default writes
- app-local promotion decisions
- external principal self-promotion
- debug/probe promotion
- side audit stores
- promotion transport implementation without promotion transport admission
- open-string promotion targets

Required for every promotion candidate:

- target owner
- audit lineage
- provenance
- policy verdict
- source profile
- output candidate reference
- missing-required-input policy of `fail_closed`
