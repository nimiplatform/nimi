# WEE Execution

## Status: Admitted as platform direction

The World Evolution Engine kernel framing (`K-WEV-*`) is admitted at
the contract level — semantic-owner boundary, replay/checkpoint
semantics, supervision boundaries, effect-stage ordering, commit-
request staging. WEE is a future runtime engine that produces
well-formed mutation requests for Realm to admit; there is no public
Runtime API today.

## What WEE Is

The **World Evolution Engine** (WEE) is the runtime-owned engine
that turns participant inputs and scheduled events into typed
mutation requests for Realm to admit. It is the contract that says:
"a world should feel alive — characters acting, scenes progressing,
events accruing — but every change must be auditable, replayable,
and fail-closed."

WEE runs inside Runtime. Realm remains canonical truth authority;
WEE produces well-formed mutation requests; Realm admits or rejects.
WEE never bypasses Realm.

## Authority Boundary (K-WEV-001..K-WEV-002)

| Owner | What it owns |
| --- | --- |
| Runtime kernel `K-WEV-*` | Execution-event semantic home, replay semantics, checkpoint semantics, supervision + fault-isolation, effect-stage ordering, commit-request staging |
| Platform kernel | Placement and cross-layer boundary text (only) |
| SDK | Downstream projection (only) |
| Realm | Canonical truth owner for shared world state and history |

The runtime-local execution evidence WEE produces — execution events,
replay metadata, checkpoint metadata, supervision state, effect-stage
evidence, operator-facing execution correlation — stays under
**Runtime semantic ownership**. These artifacts are not Realm shared
present-state truth and not Realm canonical happened-fact truth.

## WEE Is Not Workflow

| WEE | Workflow |
| --- | --- |
| Drives world evolution under Realm authority | Drives general-purpose orchestration |
| Has its own admitted execution event family `K-WEV-003` | Workflow event family `K-WF-*` |
| Stages typed commit requests for Realm | Does not stage Realm commits as its primary purpose |

Conflating the two is a known error. WEE has a distinct semantic
home; even when WEE introduces a stable execution event or envelope,
its semantic home is `K-WEV-*`, not `K-WF-*`, `K-AUDIT-*`, SDK
projection, or platform boundary text.

## Reuse Anchors (K-WEV-003)

Future WEE execution event / envelope contract:

| Must reuse | From |
| --- | --- |
| Realm provenance anchors | `R-WHIST-003` |
| Commit-envelope anchors | `R-WSTATE-002` |
| Runtime correlation floors | `K-AUDIT-001`, `K-AUDIT-003`, `K-AUDIT-019`, `K-AUDIT-020` |

Must **not** redefine:

- Realm run-mode authority
- Realm `effectClass` vocabulary
- Realm commit-envelope authority
- Runtime audit-record schema as semantic truth

## Commit / History / Audit Boundary (K-WEV-004)

WEE produces typed commit requests; Realm admits. The truth chain:

| Surface | Owner |
| --- | --- |
| WEE commit-request staging | Runtime (`K-WEV-*`) |
| Commit envelope shape | Realm (`R-WSTATE-002`) |
| State write authorization | Realm (run-mode authorization matrix per `R-WSTATE-005`) |
| History append on `STATE_AND_HISTORY` effectClass | Realm (`R-WHIST-*`) |
| Runtime audit record | Runtime (`K-AUDIT-*`) — execution evidence, not Realm semantic truth |

WEE does not invent run modes. WEE does not invent `effectClass`.
WEE does not silently demote a `CANON_MUTATION` to a `REPLAY` to
bypass authorization.

## The Nine Stages

WEE has its own execution stage taxonomy:

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

## Reader Scenario: A World Event Flows Through WEE

A scheduled world event fires (e.g., a periodic season change).

1. **`INGRESS`.** WEE receives the event proposal.
2. **`NORMALIZE`.** Proposal canonicalized into the admitted event
   shape.
3. **`SCHEDULE`.** Engine orders the work.
4. **`DISPATCH`.** Right handler picked.
5. **`TRANSITION`.** Typed state transition computed.
6. **`EFFECT`.** Downstream effects (presence, social, economy)
   computed.
7. **`COMMIT_REQUEST`.** Mutation request staged for Realm.
8. **Realm admits or rejects.** Per `R-WSTATE-005` authorization
   matrix. If `effectClass=STATE_AND_HISTORY`, history append happens.
9. **`CHECKPOINT`.** Engine snapshots intermediate state for replay.
10. **`TERMINAL`.** Work reaches terminal outcome.

Each stage is typed. Each transition emits runtime-local execution
evidence. Realm is the truth admitter; WEE is the request producer.

## Reader Scenario: Replay From Checkpoint

A new node joins or recovery is needed.

1. **Checkpoint loaded.** The most recent admitted checkpoint is
   resolved.
2. **Events replayed.** The execution event family replays from the
   checkpoint forward.
3. **Realm truth re-derived.** Through the same admit pipeline; no
   silent shortcut to "trust the checkpoint, skip Realm admission."
4. **Operator correlation.** Runtime-local audit shows the replay
   chain.

Replay is the engine's correctness primitive. The contract pins
that replay does not bypass admission.

## Reader Scenario: A `REPLAY` Run Tries To Append History

WEE replays a prior canon mutation under `REPLAY` mode.

1. **Replay path executes.** WEE re-derives the original mutation.
2. **Realm history admit.** Per `R-WHIST-004`, `REPLAY` runs must
   not append shared world history.
3. **Append rejected.** No new history row is created; the prior
   canon row stays as the truth.
4. **Audit reflects.** Runtime-local audit shows the replay; Realm
   history is unchanged.

The replay path does not become a side door for double-history
appends.

## What WEE Does Not Do

- It does not redefine Workflow event semantics.
- It does not become Realm truth authority.
- It does not bypass Realm commit envelope or authorization matrix.
- It does not let runtime-local execution evidence claim Realm
  truth ownership.
- It does not redefine `effectClass` or run modes.
- It does not silently fall back to a generic stage handler on
  malformed stage output.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Execution semantics + replay + checkpoint + supervision + effect-stage + commit-request staging | Runtime (`K-WEV-*`) |
| Execution-event semantic home (when stable) | `K-WEV-*` |
| Runtime-local execution evidence | Runtime (non-canonical) |
| Realm shared present-state truth | Realm (`R-WSTATE-*`) |
| Realm canonical happened-fact truth | Realm (`R-WHIST-*`) |
| Cross-layer placement boundary text | Platform kernel |
| Downstream projection | SDK |

## Source Basis

- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
