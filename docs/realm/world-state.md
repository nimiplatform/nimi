# World State

> Status: Running today. Realm `R-WSTATE-*` is the shipped
> shared present-state authority.

World state is the **durable shared present** of a world. It
answers "what does this world look like right now." Mutations
require an explicit commit envelope; truth and history sit on
either side of state.

For the side-by-side comparison with history (when each surface
updates per `effectClass`), see
[State vs History](/platform/worlds/state-vs-history).

## What World State Is

| Property | Value |
| --- | --- |
| Storage | Realm `R-WSTATE-*` |
| Shape | Current snapshot of the world |
| Mutation | Through admitted commit envelope |
| Authority | Realm |
| Read pattern | Single-state read or projection |

State is not a cache. It is canonical present. Apps that read
state get the current truth; the read does not require
reconstruction from history.

## The Commit Envelope

Every state mutation is bound to an explicit commit envelope.

| Field | Purpose |
| --- | --- |
| `worldId` | Which world is being mutated |
| `appId` | Which app is committing |
| `sessionId` | Session lineage |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` | What schema this commit conforms to |
| `schemaVersion` | Which version of the schema |
| `actorRefs` | Who acted |
| `reason` | Why |
| `evidenceRefs` | Supporting evidence |

Creator tooling and authorized world-connected apps use **the same
commit envelope model**. There is no privileged shortcut for
creator tooling.

## Effect Class

`effectClass` controls what the commit affects:

| Value | Meaning |
| --- | --- |
| `NONE` | No state change; this is a dry run / probe / observation |
| `STATE_ONLY` | Mutates state without appending to history |
| `STATE_AND_HISTORY` | Mutates state and appends to history |

Most real mutations are `STATE_AND_HISTORY`. `STATE_ONLY` is for
specific cases (transient adjustments, certain policy operations).
`NONE` is for dry-runs and observation.

## Scope

`scope` controls what slice of the world is targeted:

| Value | Targeting |
| --- | --- |
| `WORLD` | World-level state |
| `ENTITY` | A specific entity inside the world |
| `RELATION` | A relation between entities |

A commit must declare its scope; ambiguous scope is rejected.

## Reader Scenario: A State Mutation From An Extension App

An admitted extension-app wants to change a participant's
position in the world.

1. **Build the envelope.** App constructs:
   - `worldId`: this world
   - `appId`: this extension-app
   - `sessionId`: the active session
   - `effectClass`: `STATE_AND_HISTORY`
   - `scope`: `ENTITY`
   - `schemaId` / `schemaVersion`: position-update schema
   - `actorRefs`: the participant being moved
   - `reason`: "participant moved into building"
   - `evidenceRefs`: supporting evidence (e.g., a participant
     action that caused the move)
2. **Submit.** Realm receives the commit.
3. **Validate.** Realm checks: app-world binding active, schema
   admitted, scope appropriate, evidence valid.
4. **Apply.** State updates; history appends.
5. **Audit.** Commit lineage recorded.

The envelope is what makes state mutations auditable. Every
mutation can be reconstructed: who, when, why, with what evidence.

## Reader Scenario: A Read Of Current State

An app wants to render a world's current state.

1. **Query state.** Through admitted Realm reads, the app
   queries world state for the relevant scope.
2. **Realm returns current state.** Single-snapshot read.
3. **App renders.** The app sees the current state.

The app does not reconstruct state from history. State is canonical
present, optimized for read.

## Reader Scenario: A Mutation That Crosses Multiple Primitives

An action causes social, economic, and presence consequences —
say, gifting an item in a public scene.

1. **Multiple commits.** The platform may use multiple commits
   to atomically capture the consequences:
   - Item ownership transfer (`scope: RELATION`,
     `effectClass: STATE_AND_HISTORY`)
   - Social interaction event (related social state)
   - Economic event (gift event in append-only economy)
   - Presence record (witnesses)
2. **Each commit envelope.** Carries its own typed envelope.
3. **History records each.** Each commit appends a history
   record.

The action is one product moment; the underlying contract spreads
the consequences across the right surfaces with the right typed
envelopes.

## What Apps Cannot Do

| Forbidden | Why |
| --- | --- |
| Mutate state without an envelope | Auditability requires envelopes |
| Use a free-form `schemaId` | Schemas are admitted at the kernel |
| Use undeclared scope | Scope is admitted; ambiguous scope is rejected |
| Skip evidence references | Evidence is required for traceability |

## Source Basis

- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/tables/world-state-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/world-state-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
