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
