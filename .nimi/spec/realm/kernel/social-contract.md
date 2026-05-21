---
id: SPEC-REALM-KERNEL-SOCIAL-001
title: Realm Social Kernel Contract
status: active
owner: "@team"
updated: 2026-03-23
---

# Social Contract

> Domain: social
> Rule family: R

## Scope

This contract defines the canonical social admission layer for `nimi-realm`.

## R-SOC-001

Friendship is the canonical admission graph for realm-level social relationships.

## R-SOC-002

Friendship uses an ordered pair uniqueness model so the same pair cannot produce duplicate canonical rows.

## R-SOC-003

Social defines relationship and admission facts. It does not define agent-chat runtime, model routing, or turn execution.

## R-SOC-004

Social may gate human chat via preconditions, but canonical chat surface lives in Realm Chat and agent chat runtime stays outside Realm.

## R-SOC-005

Nimi-authored guide agents use the same Realm social mechanics as any ordinary
RealmAgent. Their AgentFriend relationships are ordinary Friendship rows and do
not create privileged Agent classes, special social schema, hidden quota
exceptions, or authority-bearing official-agent status.

## R-SOC-006

New-user initialization may seed a Nimi guide AgentFriend relationship only
through ordinary Realm social admission. Before creating or repairing that
relationship, the backend path must validate the guide Agent account, required
RealmAgent identity, and required AgentProfile / Realm payload needed for the
ordinary relationship. Missing or invalid payloads fail closed as typed
provisioning or repair states.

`MUST NOT`: Guide AgentFriend provisioning must not create a privileged
official-agent class, social schema fork, quota bypass, server-bot bypass,
Runtime local-only agent, Desktop fixture, or prompt/docs authority shortcut.

## R-SOC-007

AgentFriend removal and LocalAgent deletion are one server-authoritative
canonical linkage. Removing an AgentFriend relationship (deleting a Friendship
row whose `kind` is the agent variant) MUST delete the one-to-one LocalAgent
projection bound to that relationship. The two sides fail or succeed together;
neither may survive the other.

`MUST`: The removal-to-deletion linkage trigger is owned by the backend / Realm
social admission path. The renderer or any Desktop client MUST NOT own the
linkage. The backend is the only authority that knows a removed Friendship was
the agent variant and which RealmAgent account it pointed at, and it is
therefore the only authority that may issue the LocalAgent termination.

`MUST`: An AgentFriend removal MUST execute as one fail-closed unit in this
order: (1) validate the Friendship exists and is the agent variant and resolve
the `(ownerUserId, realmAgentId)` pair; (2) delete the canonical Friendship row
through ordinary social admission (`R-SOC-001`); (3) issue the runtime
`TerminateAgent` deletion for the resolved `localAgentRef`
(`local-agent:{ownerUserId}:{realmAgentId}`, the deterministic identity defined
by `R-CHAT-016`); (4) the LocalAgent projection deletion executes through the
runtime lifecycle owned by `K-AGCORE-139`.

`MUST`: The linkage MUST be idempotent. Repeating the removal, retrying after a
transport failure, or removing an AgentFriend whose LocalAgent was never
materialized MUST converge to the same end state — no dangling LocalAgent and
no dangling AgentFriend — with no duplicate-error and no resurrected agent.

`MUST`: A failure to delete the LocalAgent projection MUST fail closed. The
removal is not "successful" until both the Friendship row is gone and the
LocalAgent projection deletion is acked, or a durable retried termination
intent is persisted for guaranteed convergence. A failure surfaces as a typed
error or that durable retried intent.

`MUST NOT`: The removal path MUST NOT leave a half-applied state — it must not
delete the Friendship while leaving an orphan LocalAgent, and it must not delete
the LocalAgent while leaving a dangling AgentFriend.

`MUST NOT`: AgentFriend removal MUST NOT mutate the canonical truth of the
corresponding RealmAgent. The RealmAgent is a public, world-attached identity;
deleting a local AgentFriend relationship and its LocalAgent projection never
writes back to RealmAgent canonical truth.

`MUST NOT`: The linkage MUST NOT be projected as renderer-synthesized success.
The client MUST NOT report an AgentFriend as removed while its LocalAgent
projection still exists. Transport retry and auth refresh remain transport
mechanisms only; they MUST NOT be used to rescue a failed deletion into pseudo-success.

This rule defines the removal half of the AgentFriend ↔ LocalAgent one-to-one
invariant only. Creation-time linkage (materializing the LocalAgent projection
when the AgentFriend is created) is governed separately and is out of scope for
this rule.

## R-SOC-008

`R-SOC-007` names the AgentFriend-removal → LocalAgent-deletion linkage and
admits "a durable retried termination intent" as the convergence guarantee, but
it does not define that intent's record, lifecycle, retrieval API, or the
transport that delivers `TerminateAgent` to the LocalAgent's runtime. `R-SOC-008`
is the companion mechanism rule: it defines the `LocalAgentTerminationIntent`
record, its lifecycle, the viewer-scoped list/ack API, and the desktop
reconciliation courier. `R-SOC-007` remains the linkage authority; `R-SOC-008`
is the mechanism by which that linkage converges. This rule introduces no new
linkage authority and does not weaken any `R-SOC-007` or `K-AGCORE-141` clause.

The architectural fact this rule resolves: the LocalAgent projection lives on a
runtime reachable only from its own device (the runtime gRPC surface is
loopback-bound and the backend holds no runtime client). The backend therefore
cannot synchronously issue `TerminateAgent`. `R-SOC-007` step (3) is satisfied
by the backend persisting a durable termination intent and the device's own
desktop client transporting `TerminateAgent` to its local runtime.

### The `LocalAgentTerminationIntent` record

`MUST`: An AgentFriend removal whose Friendship `kind` is the agent variant MUST
persist exactly one durable `LocalAgentTerminationIntent` record as the
canonical, server-owned representation of the pending LocalAgent deletion. The
record is the durable retried termination intent named by `R-SOC-007` and the
"durable termination intent" whose retry `K-AGCORE-141` assigns to the upstream
Realm linkage. The record MUST carry the linkage identity: the owner user, the
RealmAgent account, and the deterministic `localAgentRef`
(`local-agent:{ownerUserId}:{realmAgentId}`, the `R-CHAT-016` identity) that is
the `TerminateAgent` target, plus provenance of the removed Friendship, the
lifecycle `status`, a substrate-failure attempt counter, the last typed error,
a backoff-gated availability time, and acknowledgement metadata.

`MUST`: The record MUST be unique per `localAgentRef`. A repeated removal of the
same AgentFriend MUST converge onto the same record (re-opening it per the
lifecycle below) rather than creating a second intent — this is the record-level
expression of the `R-SOC-007` idempotency guarantee.

### Lifecycle

`MUST`: The record lifecycle is the typed state set `OPEN`, `ACKED`, `FAILED`:

- `OPEN` — the intent is written and awaiting courier delivery. The courier
  considers an `OPEN` record once its backoff availability time has elapsed.
- `ACKED` — terminal success. The courier delivered `TerminateAgent` and the
  runtime returned a typed success, which per `K-AGCORE-141` includes the
  absent-ref / never-materialized typed no-op. The backend records the
  acknowledgement source and time.
- `FAILED` — needs-attention. The intent reached the substrate-failure attempt
  cap. `FAILED` is NOT hard-terminal: a `FAILED` record MUST be reopenable to
  `OPEN` (by a later removal re-issue of the same AgentFriend or an admitted
  backend recovery path) so the `R-SOC-007` "guaranteed convergence" holds
  beyond the attempt cap. `FAILED` is the fail-closed needs-attention surface;
  it MUST NOT be silently dropped or auto-resolved.

`MUST`: The intent record MUST be written in the SAME database transaction as
the canonical `Friendship` row deletion (`R-SOC-001`). The Friendship delete and
the intent write either both commit or both roll back. This transactional
coupling is the "one fail-closed unit" of `R-SOC-007`: if the intent write
fails, the Friendship delete MUST roll back, so no removal is reported and no
half-applied state arises (`R-SOC-007` forbids the orphan / dangling state).

`MUST NOT`: The intent record MUST NOT be carried by a server-drained outbox or
any transport whose consumer cannot reach the LocalAgent's loopback runtime. The
record is a viewer-pulled, device-acknowledged intent; its only delivery path is
the courier defined below.

### Viewer-scoped list / ack API

`MUST`: The backend MUST expose a viewer-scoped API to list and acknowledge
termination intents. The list operation MUST return only the authenticated
viewer's own intents (the records whose owner user is the caller); an intent
MUST NOT be readable or acknowledgeable by any other account. Cross-viewer
access fails closed as a typed permission error.

`MUST`: Acknowledgement MUST be a backend-owned state transition. The courier
reports a typed outcome; the backend — not the courier — applies the lifecycle
transition: a `terminated` outcome moves an `OPEN` record to `ACKED`; a typed
substrate-failure outcome charges one attempt and either re-arms the record as
`OPEN` with a backoff availability time or, at the attempt cap, moves it to
`FAILED`. Acknowledgement MUST be idempotent: acknowledging an already-`ACKED`
record succeeds and returns the same record without error.

`MUST`: Only typed runtime substrate failures (the `K-AGCORE-141` fail-closed
deletion failures) charge the attempt counter toward the cap. Transport-layer
and offline failures — the local runtime daemon being unreachable, the Realm
API being unreachable — MUST NOT charge an attempt and MUST NOT move a record
toward `FAILED`; such a record stays `OPEN` and is retried whenever the device
is next able to deliver. The attempt cap is the maximum `10` substrate-failure
attempts.

### Desktop reconciliation courier

`MUST`: The desktop reconciliation courier is pure transport. It pulls the
viewer's `OPEN` intents, delivers `runtime.agent.terminateAgent` (the
`K-AGCORE-141` hard delete) to the local runtime for each intent's
`localAgentRef`, and reports the typed outcome to the backend ack API. The
courier owns no decision: it does not decide whether a LocalAgent should be
terminated (the backend authored the intent), does not author or own the
linkage, and does not create intent state. This satisfies the `R-SOC-007`
requirement that the renderer or any Desktop client MUST NOT own the linkage —
a courier restricted to transport owns no linkage authority.

`MUST`: The courier MUST be idempotent against `K-AGCORE-141`. Because
`TerminateAgent` for an already-deleted or never-materialized `localAgentRef` is
a typed no-op, a courier that delivers a terminate more than once (for example
when an ack report was lost) is safe; the re-pulled intent is re-acknowledged
and the backend ack is idempotent. The whole linkage therefore converges to
no-dangling-either-side under repeat, retry, or never-materialized LocalAgent,
consistent with `R-SOC-007`.

`MUST`: The backend `LocalAgentTerminationIntent` table is the sole durable
store for the pending deletion. The courier MUST be stateless: it MUST NOT keep
a desktop-local persistent intent queue. On each pass it re-pulls open intents
from the backend. A device that is offline when the AgentFriend is removed
MUST converge when it next comes online and the courier next runs — the intent
has remained `OPEN` server-side and the runtime holding the LocalAgent is on
that same device, so it becomes reachable exactly when the device returns. This
is the long-offline convergence guarantee.

`MUST NOT`: The courier MUST NOT synthesize success. It MUST report a
`terminated` outcome only on a real typed runtime success (including the
`K-AGCORE-141` absent-ref typed no-op). On a transport or offline error it MUST
NOT acknowledge the intent — it leaves the record `OPEN` for a later pass.
Transport retry and auth refresh remain transport mechanisms only and MUST NOT
be used to rescue a failed `TerminateAgent` into a pseudo-success acknowledgement
(`R-SOC-007` and `K-AGCORE-141` fail-closed posture).

`MUST NOT`: The courier MUST NOT drive renderer-local linkage or removal state.
Any UI surface that shows whether an AgentFriend removal has converged MUST
project the intent `status` returned by the viewer-scoped list API (`OPEN` =
removal pending runtime convergence, `ACKED` = converged); it MUST NOT compute
that state from courier activity. Truth is the server-owned intent record and
the runtime projection, never renderer-local courier state.

This rule defines the termination-intent record, its lifecycle, the
viewer-scoped list/ack API, and the courier mechanism only. The `Friendship`
delete trigger, the resolution of `(ownerUserId, realmAgentId)`, and the
overall removal authority remain owned by `R-SOC-007`; the runtime deletion
semantics of `TerminateAgent` remain owned by `K-AGCORE-141`.
