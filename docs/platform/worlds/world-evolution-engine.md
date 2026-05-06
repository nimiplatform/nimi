# World Evolution Engine

The World Evolution Engine (WEE) is the runtime-owned machinery that
makes a world feel alive — characters acting, scenes progressing,
events accruing — under contracts that are auditable, replayable, and
fail-closed.

## What WEE Solves

A world that has rules but no progression is just a database. A
world where any code can write canonical truth at any time is just
chaos. WEE is what sits between: a typed pipeline that turns
participant inputs and scheduled events into proposed mutations,
validates them, stages them as commit requests, and either commits
to Realm or fails closed under explicit reasons.

WEE runs inside Runtime. Realm remains the truth authority; WEE is
the engine that produces well-formed mutation requests for Realm to
admit. WEE does not bypass Realm; it composes against Realm.

## The Nine Stages

WEE has its own execution stage taxonomy, distinct from Workflow:

| Stage | Order | Purpose |
| --- | --- | --- |
| `INGRESS` | 1 | Receive an event proposal |
| `NORMALIZE` | 2 | Canonicalize the proposal shape |
| `SCHEDULE` | 3 | Order the work in the engine's queue |
| `DISPATCH` | 4 | Hand the work to the right handler |
| `TRANSITION` | 5 | Compute the typed state transition |
| `EFFECT` | 6 | Compute downstream effects (presence, social, economy) |
| `COMMIT_REQUEST` | 7 | Stage the proposed mutation as a typed commit request |
| `CHECKPOINT` | 8 | Snapshot the engine's intermediate state for replay |
| `TERMINAL` | 9 | The work has reached a terminal outcome |

Each stage has typed inputs and outputs. A stage that produces
malformed output fails closed; the engine does not silently fall
back to a generic stage handler.

## Recorded Replay Only

WEE V1 replays from **recorded events, checkpoints, and
commit-request outcomes** only. It doesn't re-infer; it does not
make fresh route selections during replay; it does not call models
again.

This is a deliberate choice. Replay is for understanding what
happened, not for re-executing. Re-inference at replay would mean
the engine could produce different answers in replay than in
production; that breaks audit reconstruction.

If a system later needs deterministic re-execution, it must be
admitted as a separate execution mode under its own contract.

## How WEE Differs From Workflow

Both WEE and Runtime's Workflow surface execute multi-step work.
They are separate by design.

| Property | Workflow | WEE |
| --- | --- | --- |
| Owner | Runtime | Runtime |
| Purpose | General AI execution graph (text/image/etc.) | World evolution: turning events into Realm commits |
| Stage taxonomy | 15 typed nodes (`AI_*`, `TRANSFORM_*`, `CONTROL_*`) | 9 stages (`INGRESS → ... → TERMINAL`) |
| State machine | `ACCEPTED → QUEUED → RUNNING → COMPLETED|FAILED|CANCELED|SKIPPED` | Stage progression with typed terminal outcomes |
| Replay | Recorded replay; no re-inference | Recorded replay; no re-inference |
| Output target | Stream / artifact / typed result | Realm commit request |

A workflow is the right tool for "generate this image with these
parameters." WEE is the right tool for "advance the world by one
event under typed contracts."

There is an explicit hardcut: workflow partial-reuse is forbidden as
a shortcut for WEE work. Building world evolution out of workflow
nodes by side effect is a shadow truth pattern; WEE has its own
contract precisely so this does not happen.

## Reader Scenario: A World Event Becomes A Realm Commit

A participant performs an action in a world running inside WEE —
say, a scripted scene transition.

1. **`INGRESS`** receives the event proposal: "scene S advances
   to phase P".
2. **`NORMALIZE`** canonicalizes the proposal: the scene id is
   resolved, the phase is validated against scene rules.
3. **`SCHEDULE`** orders the proposal in the engine's queue. If
   other proposals are pending for the same scene, ordering is
   typed.
4. **`DISPATCH`** routes the proposal to the scene-progression
   handler.
5. **`TRANSITION`** computes the typed state transition: scene
   moves from phase P-1 to phase P. The transition is bounded by
   admitted state-transition rules; an undefined transition fails
   closed.
6. **`EFFECT`** computes the downstream effects — presence
   updates, possible social-state shifts, economy events that
   the scene's rules entail.
7. **`COMMIT_REQUEST`** stages the proposed mutation as a typed
   commit request. The request carries the commit envelope
   required by Realm: `worldId`, `appId`, `sessionId`,
   `effectClass`, `scope`, `schemaId`, `schemaVersion`,
   `actorRefs`, `reason`, `evidenceRefs`.
8. **`CHECKPOINT`** snapshots the engine's intermediate state.
   If a later replay needs to reconstruct what happened up to
   this point, this checkpoint is the anchor.
9. **`TERMINAL`** records the outcome. If Realm admits the
   commit, the terminal outcome is `committed`; if Realm
   refuses (validation failure, authorization failure), the
   terminal outcome is `failed` with a typed reason.

This entire sequence is recorded. A future replay can step through
it without making any new model calls.

## Reader Scenario: Replay Cannot Append History

Suppose an auditor wants to understand what happened when a
specific world event went wrong yesterday.

- **Replay can read.** The recorded events, checkpoints, and
  commit-request outcomes are sufficient to reconstruct what the
  engine did.
- **Replay cannot append.** A replay run is not a `CANON_MUTATION`
  run; world history is append-only and only canon-mutating runs
  may append.
- **Replay cannot re-infer.** Replay does not re-call models or
  re-run route selection; it reuses recorded outcomes.

This is what makes replay a real audit tool. If replay could append
or re-infer, it would not be reading the past — it would be
overwriting it.

## Source Basis

- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
