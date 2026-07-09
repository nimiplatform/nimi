# Runtime Agent Participation Domain Promotion Contract

> Owner Domain: `K-AGCORE-*`

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
- memory/cognition/canonical-chat writes remain forbidden until future
  promotion authority admits them

## K-AGCORE-097 Scenario Sandbox Future Seam

`scenario_sandbox` is a pending future-consumer seam for a standalone Scenario
Sandbox product domain.

Runtime participation may consume typed scenario package, run, branch, visible
scene state, and recent sandbox transcript projections. Runtime participation
must not implement scenario product ontology, scenario replay branches, scenario
transcript storage, ScenarioJob execution, or custom prompt APIs.

Fixed posture:

- the pending Scenario Sandbox product requirement remains product-domain
  pressure, not active implementation
- `K-JOB-*` may be referenced only as existing ScenarioJob lifecycle authority
- public raw scenario prompt blobs and custom prompt APIs are forbidden
- app-local scenario agent execution authority is forbidden
- output remains a `SCENARIO_TURN_CANDIDATE`
- Runtime direct scenario transcript/run/replay commit is forbidden
- memory/cognition/canonical-chat writes remain forbidden until future
  promotion authority admits them

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

Matches in Runtime/Realm kernel contracts, generated docs, pending requirement notes,
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
GROUP promotion candidate is valid only for `realm_group_source` and must carry
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
