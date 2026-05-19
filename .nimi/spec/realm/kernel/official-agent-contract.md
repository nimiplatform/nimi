# Official Agent Contract

> Owner Domain: `R-SOC-*`

## Scope

This contract defines Realm-owned official RealmAgent seed authority for Nimi
product guide agents. It admits official provenance, handle reservation, system
World association, and the Realm relationship facts consumed by Runtime
LocalAgent provisioning.

It does not define Runtime LocalAgent execution, Desktop UI fixtures, Avatar,
memory, cognition, or model routing.

## Official RealmAgent Seed Authority

Rule: `R-SOC-006`.

Realm owns official RealmAgent seed truth. Each official seed must have:

- stable `realmAgentId`;
- reserved handle;
- display name;
- official provenance;
- system World association;
- seed status;
- first-message floor or message policy reference;
- source rule.

Official seeds are governed by `tables/official-agent-seeds.yaml`.

`MUST NOT`: Desktop, Runtime, SDK, or app-local fixtures may not create a fake
official guide by hardcoding contact rows, LocalAgent rows, or display-only
records without a Realm official seed.

## Archivist Seed

Rule: `R-SOC-007`.

`Archivist / @archivist.nimi` is an admitted official RealmAgent seed.

Seed facts:

- display name: `Archivist`
- handle: `@archivist.nimi`
- provenance: official Nimi guide
- system World association: OASIS/system main World lineage
- role: product guide and librarian for Nimi setup, Runtime, profiles, apps,
  Worlds, RealmAgents, LocalAgents, and Avatar

`MUST NOT`: Archivist is not the product identity `Nimi`, not Avatar, not a
server bot bypass, and not Runtime/profile/app/account/memory/cognition owner.

## Automatic Relationship Provisioning Source

Rule: `R-SOC-008`.

Realm owns the official relationship source fact that new registered accounts
must receive an AgentFriend relationship to admitted official guide seeds whose
`auto_provision.agent_friend=true`.

`MUST`: provisioning must be idempotent and traceable to the official seed row.
Existing account repair may create the missing relationship only when the seed
row is still active and the relationship does not already exist.

`MUST NOT`: Desktop local contacts, source fixtures, or app-local data may stand
in for the Realm relationship source.

## Quota Exception

Rule: `R-SOC-009`.

Official guide AgentFriend relationships declared with
`quota_policy=official_guide_exception` do not count against ordinary
AgentFriend quota.

`MUST`: quota accounting must retain this exception as an explicit official
guide reason, not as a hidden quota bypass.

`MUST NOT`: this exception may not be generalized to arbitrary RealmAgents,
third-party agents, app-created agents, or manually added AgentFriends.

## Fact Sources

- `.nimi/spec/realm/kernel/social-contract.md` - Realm social admission graph
- `.nimi/spec/realm/kernel/world-state-contract.md` - system World association
- `.nimi/spec/realm/kernel/tables/official-agent-seeds.yaml`
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` - Runtime
  LocalAgent provisioning consumer
