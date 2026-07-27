# Local Audit

Runtime emits a local audit ledger covering every AI call, model
operation, app message, and authorization decision. Audit is local
truth — it lives on your machine. Realm cloud audit is a separate
plane that runtime can optionally aggregate to.

## What Local Audit Records

Runtime records:

| Event family | Examples |
| --- | --- |
| AI calls | Workflow start, node execution, scenario job lifecycle, terminal outcomes |
| Model operations | Provider routing, local engine routing, model resolution |
| App messages | App-to-app messaging via runtime |
| Authorization decisions | Token validation, scope check, capability admission |
| Delegation lineage | External AI session, firewall verdict, approval decisions, action lineage |
| Memory writes and replication | Write admission, replication state transitions, conflict / invalidation |
| Hook lifecycle | Admission, scheduling, firing, terminal |

Each event has structured fields, principal lineage, and trace ids
that survive across runtime restart.

## Local-First Audit

Audit being local-first is a deliberate posture. The cloud is not
required; the audit ledger does not depend on Realm being online.

| Concern | Why local-first |
| --- | --- |
| Privacy | Audit is yours; you do not have to upload it |
| Independence | Runtime audit works offline |
| Authority | Local audit is local truth, not a degraded copy of cloud audit |
| Optional aggregation | Runtime can ship aggregates upward when configured |

If a user later signs in to Realm and opts to aggregate, the
runtime ships aggregates upward. The local audit truth does not
change retroactively; the aggregation is forward-only.

## Audit Lineage

Audit records carry typed lineage that lets a future reader
reconstruct what happened.

| Lineage element | Purpose |
| --- | --- |
| Trace id | Identifies a single end-to-end run |
| Principal id | Who was acting (user / agent / app / external principal) |
| Workflow id | Which workflow this event belongs to |
| Job id | The `ScenarioJob` lineage |
| Provider id | Which provider was involved |
| Action lineage | For delegated paths, links suggestion → verdict → approval → action |

A reader looking at audit can answer "what happened" not just
"what was logged."

## Audit Statistics And Health Snapshot

The audit contract admits structured statistics and health
snapshots. `nimi doctor` exposes:

| Metric | Meaning |
| --- | --- |
| Audit volume | Records per unit time |
| Replication backlog | Pending records awaiting cloud aggregation (if enabled) |
| Failure ratio | Recent failure events relative to total |
| Workflow throughput | Recent workflow completion rate |

These metrics are observable; apps subscribing to audit health get
a stream of typed events.

## Reader Scenario: Reconstructing A Failed Workflow

Something went wrong yesterday. A user wants to know exactly what
happened.

1. **Locate by trace id.** The user has the trace id (from a
   chat error message or app log). They query audit by trace id.
2. **Workflow lineage.** The workflow lifecycle is recorded —
   `ACCEPTED → QUEUED → RUNNING → ... → FAILED` with each
   `NODE_STARTED → NODE_PROGRESS → NODE_FAILED` along the way.
3. **Scenario job lineage.** Each AI node fans out to a
   `ScenarioJob`; the audit shows job state transitions.
4. **Provider lineage.** Which provider was routed; what state
   the provider was in; what error code came back.
5. **Streaming lineage.** The terminal frame that caused the
   workflow to move to `FAILED` is recorded.
6. **Reconstruction.** The user has a structured chain of "this
   request → this workflow → this node → this provider → this
   error → this terminal" without guessing.

The audit is the platform's answer to "what happened." Free-form
log files would not give this; typed audit lineage does.

## Reader Scenario: A Delegation Audit Chain

An external AI took an action. Later, the user wants to see how it
was authorized.

1. **Session record.** External principal session start, with
   trust tier and policy snapshot.
2. **Suggestion record.** The typed delegation request shape.
3. **Firewall verdict.** What the firewall said.
4. **Approval record.** User approval (if `APPROVAL_REQUIRED`).
5. **Action record.** Runtime-owned action with its own lineage.
6. **Outcome record.** Terminal state of the action.

The chain is end-to-end: an auditor reading the chain can answer
"who proposed, who authorized, what happened" without ambiguity.

## Reader Scenario: A User Reviews Their Memory Activity

A user wants to know what their agent has been remembering.

1. **Memory write events.** Audit shows each admitted write,
   including the bank scope and the source.
2. **Replication events.** State transitions for each write
   (`pending → synced` or otherwise).
3. **Read events.** Audit shows when memory was read in
   subsequent turns.
4. **Conflict / invalidation events.** Any reconciliation steps.

The user can answer "did my agent remember X, and did it ever
get invalidated" through the audit.

## Optional Aggregation To Realm

Runtime can optionally ship audit aggregates upward to Realm.

| Property | Value |
| --- | --- |
| Default | Aggregation is off |
| Enabled by | User config / host product config |
| Direction | Local → Realm; never Realm → Local rewrite |
| Granularity | Aggregates and digests; not raw record stream |

The local audit is the source of truth. Realm aggregation is a
projection.

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`config/runtime-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-reason-codes.yaml)
