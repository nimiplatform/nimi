# Worlds

A World is the most important product object in Nimi. Worlds are
why the platform exists.

## What Is A World

A World in Nimi is a long-lived semantic environment with
creator-defined rules, persistent shared state, an append-only
history of canonical facts, and participants — humans and AI agents
together — whose identity, social graph, and economic standing are
not invented per world but shared across all worlds.

A world is **not**:

- A chat room. Chat is a surface inside a world; the world is the
  environment that gives the chat meaning.
- A campaign. A campaign is a temporary play frame; a world keeps
  evolving even when no one is playing.
- A level. A level is a designed encounter; a world is a place that
  has its own rules and history independent of any single visit.
- An app. An app projects part of the platform; the world is the
  meaning the app projects.

A world is more like a small universe with consistent rules —
authored by a creator, populated by participants, durable across
time.

## Three Things A World Carries

Every world has three related but distinct concepts. These are
canonical Realm semantics; [State vs History](/platform/worlds/state-vs-history)
walks the state-vs-history relationship in detail (with the
per-realm pages [Truth](/realm/truth), [World State](/realm/world-state),
[World History](/realm/world-history) for each surface).

| Concept | What it answers | Owner |
| --- | --- | --- |
| Truth | What is canonically true here, regardless of when written | Realm `R-TRUTH-*` |
| World State | What this world looks like right now | Realm `R-WSTATE-*` |
| World History | How this world reached its current state | Realm `R-WHIST-*` |

A surface that conflates these silently loses information. A world
without truth has no rules. A world without state has no present. A
world without history has no past.

## Adjacent Realm Surfaces

A world also carries other typed surfaces that participate in its
meaning:

| Surface | Purpose |
| --- | --- |
| Chat | Canonical thread / message / membership / agent-slot lifecycle when conversation participates in world meaning |
| Social | Friendship admission graph; gates chat preconditions |
| Economy | World creator economy + revenue + settlement |
| Asset / Bundle / Resource / Binding | What the world contains and how those things attach to participants and scenes |
| Transit | The single-hop continuity protocol via OASIS that lets participants move between worlds |

Each is owned by Realm; together they make a world feel like a
place rather than a database.

## What This Section Contains

- [State vs History](/platform/worlds/state-vs-history) — when state
  updates vs history appends, governed by `effectClass`. (Truth lives
  on its own per-realm page: [Truth](/realm/truth).)
- [OASIS](/platform/worlds/oasis) — the unique system main world.
- [Lifecycle](/platform/worlds/lifecycle) — how a world is created,
  published, bound to apps, suspended, revoked.

For schema-level field definitions, see
[Reference → World Fields](/reference/world-fields).

## Reader Scenario: Walking Into A World

You sign into Nimi and join a world a friend has created.

- Your identity is the same identity you use everywhere else. The
  world admits you; it does not invent you.
- Your wallet, your friendships, and your asset library are all
  visible and useful inside this world. They are not duplicated;
  they are platform truth.
- The world has its own rules — maybe currency is "ticket stubs",
  maybe time runs at 4× real-time. These local rules apply inside
  this world. They don't retroactively change your standing
  outside it.
- Your conversation with the agents in this world is durable.
  Their memory of you is theirs (with your consent), not the
  world's. When you leave for another world, that memory travels
  with the LocalAgent under Runtime's Memory contracts.
- When you leave, you transit through OASIS. Creator worlds cannot
  peer-transit directly; OASIS is the hub.

Every line of that walkthrough corresponds to an admitted contract.
The architecture exists to make this experience consistent across
worlds without any single world inventing its own rules of identity.

## Reader Scenario: A Creator Publishing A World

You are designing a world. You are not just shipping a level — you
are shipping a place.

- You author the world's truth: rules, agents, scenes, projections,
  release. The truth is creator-governed, versioned, atomic, and
  auditable.
- You publish via a `WorldRelease` — a transactional commit that
  freezes the truth, the projections, and the package version. If
  something goes wrong, rollback is a release operation, not an ad
  hoc rewrite.
- Your world has its own internal economy if you want one — but
  the canonical platform economy stays on the platform. The
  separation is intentional.
- Once published, your world is a real Nimi destination. Participants
  can transit to it through OASIS. Their identity, social graph, and
  economic standing are the same as in any other world.

This is the world creator's compact with the platform: the platform
gives you durable identity and cross-world meaning; you give the
platform a coherent place that respects the protocol primitives.

## Source Basis

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
