# Participation Authority

## Status: Mixed; canonical chat supported, participation SDK deferred

The participation authority model is admitted at the kernel level
(`runtime-agent-participation-contract.md`, K-AGCORE-061..K-AGCORE-073).
The canonical Agent Chat profile is the supported runtime path today.
Non-canonical profiles (Realm groups, Scenario sandbox, OASIS world
actors, external A2A, debug) are contract boundaries for future
implementation. They are not a public production participation SDK
surface and must not be treated as shipped app-callable capability.

## What "Participation Authority" Means

A Nimi agent is not always doing the same kind of thing. Sometimes it
is in canonical Agent Chat with you. Sometimes it is in a Realm group
thread alongside humans. Sometimes it is acting inside a Scenario
sandbox or an OASIS world. Sometimes it is talking to an external A2A
counterpart. Each of these is a **different participation context**
with different rules about transcript ownership, identity, memory
access, capability scope, input trust, output destination, and
promotion to durable agent truth.

The participation authority model is the admitted set of rules that
covers all of these contexts uniformly. It is not a list of options
the app picks from — it is the **closed authority surface** that
runtime enforces when a profile is actually implemented. Deferred
profiles remain semantic-contract-only until their runtime and SDK
surfaces are admitted.

## Nine Orthogonal Axes

A participation profile is a fixed combination of values across nine
admitted axes. The axis registry is closed
(`tables/agent-participation-axis-model.yaml`); apps cannot submit
open-string values.

| Axis | What it identifies | Example values |
| --- | --- | --- |
| `transcript_owner` | Owner of transcript / event-log truth | `RUNTIME`, `REALM`, `SCENARIO_MODULE`, `OASIS_WORLD_DOMAIN`, `EXTERNAL_DOMAIN`, `EPHEMERAL` |
| `identity_source` | Owner and meaning of participant identity | `USER_OWNED_NIMI_AGENT`, `EXTERNAL_A2A_AGENT`, `MCP_BACKED_AI_CAPABILITY`, `SANDBOX_PROJECTION`, `NPC_WORLD_ACTOR` |
| `execution_owner` | Who assembles prompt + calls AI | `RUNTIME`, `EXTERNAL_RUNTIME_VIA_ADMITTED_GATEWAY`, `NOT_ADMITTED` |
| `memory_read_scope` | Which memory may be loaded into execution | `CANONICAL_OWNER_POLICY`, `DYADIC_PRIVATE_ALLOWED`, `DYADIC_PRIVATE_EXCLUDED`, `PUBLIC_SHARED_ONLY`, `DOMAIN_SHARED_ONLY`, `NO_MEMORY_READ` |
| `memory_write_default` | Whether output may write durable agent truth | `CANONICAL_WRITE_ALLOWED`, `WRITE_NONE`, `PROMOTION_GATED` |
| `capability_scope` | Which tools / files / delegated capabilities admitted | `CANONICAL_AGENT_SCOPE`, `PROFILE_LIMITED`, `DOMAIN_LIMITED`, `DIAGNOSTIC_READ_ONLY`, `EXTERNAL_GATEWAY_LIMITED`, `NONE` |
| `input_trust` | How prompt assembly ranks and isolates input | `TRUSTED_USER`, `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`, `SANDBOX_SCRIPT`, `EXTERNAL_A2A_PAYLOAD`, `TOOL_PROVIDER_PAYLOAD`, `WORLD_CONTEXT`, `DIAGNOSTIC_INPUT` |
| `output_destination` | Where an output candidate may be committed | `CANONICAL_CHAT`, `REALM_GROUP_MESSAGE_CANDIDATE`, `SCENARIO_TURN_CANDIDATE`, `WORLD_EVENT_CANDIDATE`, `EXTERNAL_REPLY_CANDIDATE`, `DIAGNOSTIC_CANDIDATE`, `EPHEMERAL` |
| `promotion_posture` | Whether non-canonical output may become durable | `NOT_ALLOWED`, `EXPLICIT_CANDIDATE`, `EXPLICIT_COMMIT_FLOW`, `EXISTING_CANONICAL_POLICY` |
| `execution_concurrency` | How simultaneous triggers admitted | `CANONICAL_CHAT_BUDGET`, `PER_AGENT_PARTICIPATION_QUEUE` |

The axes are orthogonal. Profiles combine them.

## Non-Canonical Posture (Default)

Every participation profile **except** `canonical_agent_chat` is
non-canonical by default. Non-canonical output:

- must be returned as an output candidate
- must not write memory by default
- must not commit cognition by default
- must not mutate Realm source-core by default
- must not become canonical chat history by default

Promotion into memory, cognition, Realm source-core, or canonical chat
requires a **later explicit promotion authority**. There is no
implicit elevation.

## Admitted Profiles

Profiles are admitted in `tables/agent-participation-profiles.yaml`.
The profile families:

| Profile family | Use |
| --- | --- |
| `canonical_agent_chat` | The 1:1 user ↔ agent chat |
| `realm_group_participation` | Agent acting as a slot in a Realm group thread |
| `scenario_sandbox_participation` | Agent acting in a Scenario package, run, or branch |
| `oasis_world_actor_participation` | Agent acting as an actor in an OASIS world |
| `external_a2a_participation` | Deferred; no production A2A support |
| `debug_participation` | Diagnostic / replay observation profile |

Each profile pins specific values across the nine axes.

## Why This Matters For Apps

An app that wants the agent to participate in something other than
canonical chat **cannot** invent its own posture. The runtime requires
the app to attach to an admitted profile. This is what keeps "agent
participates here" from collapsing into "agent reads everything,
writes everything, commits everything" by accident.

## Reader Scenario: Future Agent In A Realm Group

This is a deferred contract scenario, not a current public production
SDK promise. A user's agent is a slot in a Realm group thread alongside
other humans after the profile surface is implemented.

1. **Profile attaches.** App attaches the agent through
   `realm_group_participation`. Runtime validates the profile.
2. **Transcript owner is `REALM`.** Runtime does not own the group
   thread truth; Realm does.
3. **Input trust is `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`.** Prompt
   assembly ranks group messages below runtime system / policy /
   profile instructions.
4. **Memory read scope respects dyadic exclusion.** The agent does
   not read the user's private dyadic memory into the group context.
5. **Output destination is `REALM_GROUP_MESSAGE_CANDIDATE`.** Output
   is a candidate; Realm validates the slot binding before commit.
6. **No implicit promotion.** Anything the agent says in the group
   does not become canonical agent truth unless an explicit promotion
   path admits it.

The same agent in canonical chat with the user has full read scope
and direct commit. The profile is what keeps these contexts honest.

## Reader Scenario: Future Agent In An OASIS World Event

This is a deferred contract scenario. A user's agent participates in an
OASIS world event as a character after that world-domain profile surface
is implemented.

1. **Profile attaches.** `oasis_world_actor_participation`.
2. **Transcript owner is `OASIS_WORLD_DOMAIN`.** OASIS owns event
   log truth.
3. **Input trust is `WORLD_CONTEXT`.** Prompt assembly admits world
   context narrative under world-trust rules.
4. **Capability scope is `DOMAIN_LIMITED`.** Agent's normal tools do
   not all carry into the world; only world-domain capabilities are
   admitted.
5. **Output destination is `WORLD_EVENT_CANDIDATE`.** Output is a
   candidate the world domain validates.
6. **Memory write is `WRITE_NONE`.** The world event does not write
   durable agent memory by default.

If the user later wants the world experience to inform their agent's
durable truth, an admitted promotion flow handles it explicitly.

## Reader Scenario: Future Same Agent, Two Profiles Concurrently

This is a deferred contract scenario. A user's agent is in canonical chat
with them while also being a slot in a Realm group with other people after
the non-canonical profile surface is implemented.

1. **Two anchors, two profiles.** Canonical chat with the user uses
   `canonical_agent_chat` under one anchor; the Realm group uses
   `realm_group_participation` under a separate anchor.
2. **Concurrency is admitted under per-axis rules.** The
   `execution_concurrency` axis admits per-agent participation queue
   semantics; concurrent profiles do not contend for the canonical
   chat budget.
3. **Memory and capability scopes stay separate per profile.** The
   group profile does not inherit the canonical profile's grants.
4. **Audit lineage tracks both.** Each output is attributable to its
   profile.

This is what "participation authority" buys: the same agent acting in
multiple contexts at once without those contexts bleeding into each
other.

## What Participation Authority Does Not Do

- It does not own Realm thread / membership / message / read-state
  truth — that's Realm.
- It does not own Scenario package / run / branch / replay truth —
  that's Scenario.
- It does not own OASIS world / event / ontology truth — that's
  OASIS.
- It does not own A2A or MCP wire truth — those are protocols.
- It does not own Desktop / Web / Avatar / app UI state.

## Source Basis

- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-axis-model.yaml)
- [`.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/agent-participation-profiles.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
