# Runtime Agent Participation Profile Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-074 Profile Registry

Participation profile kinds are closed and defined by
`tables/agent-participation-profiles.yaml`.

Fixed profile kinds:

- `canonical_agent_chat`
- `realm_group_source`
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

`realm_group_source` represents a Runtime-executed agent reply candidate for a
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
