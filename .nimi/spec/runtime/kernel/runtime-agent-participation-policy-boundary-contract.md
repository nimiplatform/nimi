# Runtime Agent Participation Policy Boundary Contract

> Owner Domain: `K-AGCORE-*`

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

Realm source-core mutation, private file access, paid/cloud capability use, external
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
- `K-DELEG-*` rule redefinition in participation authority
- fake external server success

Matches in `K-DELEG-*` contracts, generated docs, or explicit prohibition text
are allowed evidence only when they preserve protocol/gateway ownership and do
not create public implementation support.
