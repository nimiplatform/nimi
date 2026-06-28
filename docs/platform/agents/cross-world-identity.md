# Cross-World Identity

A Nimi `LocalAgent` is an owner-scoped runtime projection that can enter
multiple worlds through admitted source materialization packets. Realm-side identity is not
an Agent domain; it is carried by `RealmPersona` or `WorldCharacterCore`.

## What Stays The Same Across Worlds

| Dimension | Where it lives |
| --- | --- |
| Identity | Runtime `LocalAgent` identity plus its source provenance reference |
| Social graph | Realm `R-SOC-*` (admission graph, ordered-pair uniqueness) |
| Economic standing | Realm `R-ECON-*` (canonical wallet, settlement events) |
| Memory | Cognition + Runtime memory bank scopes (`AGENT_CORE`, `AGENT_DYADIC`, `WORLD_SHARED`) |
| Presentation profile | Runtime LocalAgent presentation profile (slow-changing) |

| Dimension | What changes per world |
| --- | --- |
| World rules | Each world authors its own rules |
| Local economy meaning | A world may use any internal currency or exchange model |
| Local social rules | A world may admit relationships under its own rules |
| Visual carrier | Avatar's embodiment projection adapts to the carrier surface |

The split is intentional: cross-world meaning has a fixed contract while
world-internal meaning is creator-defined. A LocalAgent entering a world keeps
its owner-scoped runtime identity; the world admits it through source binding
and world-local rules.

## Identity Is Source-Bound

Realm does not define an Agent identity. Realm owns source objects:
`RealmPersona` for user-owned/persona IP sources and `WorldCharacterCore` for
world-owned characters. Runtime consumes a by-value `SourceMaterializationPacket`
to materialize a LocalAgent for one owner.

- A world can own `WorldCharacterCore` records inside its `WorldCore`.
- A world cannot rewrite a user's `RealmPersona`.
- A LocalAgent entering a world carries a source provenance reference; the world
  may admit or refuse that source without rewriting the LocalAgent.

This is the foundation that makes everything else portable.

## The Social Graph Is Canonical

When two participants become friends in any world, the friendship
is canonical platform truth, not world-local truth.

- Friendship lives in Realm's social contract — `R-SOC-*`.
- Friendship is an ordered-pair uniqueness graph; it is admitted at
  the platform level.
- Friendship gates chat preconditions but does not own the chat
  thread itself.
- Worlds may apply their own local social rules. Maybe in World A,
  "friend" grants visit privileges; in World B, "friend" grants
  shared currency. Each world reads the canonical friendship and
  interprets locally.

What does **not** happen: a world can't silently invent a
friendship between two participants. A world cannot delete a
friendship. Friendship is canonical.

## Economic Standing Is Canonical

A wallet, a transaction history, a creator-revenue settlement event
— these all live in Realm's economy contract (`R-ECON-*`).

- Append-only economy: every gift, every revenue split, every
  settlement event is a typed event with explicit type.
- Worlds may have their own internal economies (ticket stubs,
  reputation points, scene-local resources). These do not modify
  the canonical platform economy unless the world's rules admit a
  conversion event.
- AI compute cost is **not** modeled as Realm core truth. Cost
  accounting is a separate concern.

A user moving between worlds keeps their wallet. A creator
publishing a world keeps the platform-canonical revenue model. A
world's internal rules can decide what local meaning to give to
canonical balances; the canonical record persists.

## Memory Travels (Under Cognition)

Memory is part of the agent's identity in the four-layer sense.
When an agent moves between worlds, its memory travels with it,
under Cognition's authority and the appropriate bank scopes.

| Bank scope | Visibility |
| --- | --- |
| `AGENT_CORE` | Agent's own private memory; travels everywhere |
| `AGENT_DYADIC` | Per-relationship private memory; travels everywhere with the relationship |
| `WORLD_SHARED` | Visible inside one specific world only |
| `APP_PRIVATE` | App infrastructure scope |
| `WORKSPACE_PRIVATE` | Workspace infrastructure scope |

`AGENT_CORE` and `AGENT_DYADIC` are world-portable. `WORLD_SHARED`
is intentionally not portable — it stays with its world.

Memory is opt-in. An agent without memory enabled is still a real
agent; memory is a layer that can be turned on by the user (or
host product) under admitted memory contracts.

## Presentation Adapts; Identity Persists

Avatar's embodiment projection is the visual presentation of an
agent on a carrier surface. Different worlds and different
carriers may project the same agent differently.

- The agent's `AgentPresentationProfile` is runtime-owned and
  slow-changing — avatar backend, asset reference, expression
  preset, voice binding.
- A world's carrier may accept the embodiment, accept a degraded
  version, or refuse — governed by the carrier visual acceptance
  contract.
- The agent's identity does not change because the carrier
  changed. The presentation projection changes; the agent stays.

## Reader Scenario: An Agent Crosses Two Worlds

An agent named Tov lives in World A, where she runs a small
flower shop. A user invites Tov to visit World B, a music concert.

- **Identity** stays. Tov is the same Tov in World B.
- **Social graph** crosses canonically. Tov's friendships from
  World A are visible to World B's social contract; whether World
  B's local rules grant any privileges based on those friendships
  is up to World B.
- **Economic standing** stays. Tov's wallet is platform truth.
  World B may have its own internal currency for concert tickets;
  Tov can convert (if World B admits a conversion) or simply
  attend.
- **Memory** travels under bank scopes. Tov's `AGENT_CORE` memory
  travels. Her `WORLD_SHARED` memory specific to World A's flower
  shop stays in World A.
- **Presentation** adapts. World B's carrier may render Tov with
  a concert-appropriate embodiment if her presentation profile
  has a suitable variant; otherwise the carrier accepts the
  default.

Tov's user perceives her as the same agent. The platform's contracts
make this true at every level.

## Reader Scenario: A World That Wants To Change An Agent's Identity

Suppose a world's creator wants to ship an "alternate-universe"
version of an existing agent — same name, slightly different
personality, world-only canon.

- The platform does not admit this as identity mutation. The
  agent's canonical identity is not creator-mutable from the
  outside.
- The creator can build a new agent with a similar Soul as a
  separate canonical entity. The new agent has its own identity
  and its own memory.
- The original agent stays as the original. The two agents
  coexist; cross-world transit between them is not implied.

The non-mutability is what makes the cross-world identity
guarantee meaningful. If creators could rewrite identity,
"the same agent across worlds" would be a marketing claim, not a
contract.

## Source Basis

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
