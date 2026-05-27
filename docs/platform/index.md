# Platform

Nimi is an AI-driven open world platform. It's built for long-lived worlds
where people and AI agents participate together, keep their identity and
relationships across contexts, and move through a shared social and semantic
environment — instead of meeting only inside one isolated chat or one
isolated app.

The platform isn't a chat app, an SDK, or a runtime by itself. Those are
surfaces of a larger model. This page is where that larger model starts.

## What This Section Contains

- [Vision](/platform/vision) — the north-star framing and the comparison
  with OASIS-style world engines.
- [Architecture](/platform/architecture/) — the cross-layer map that says
  who owns what.
- [Protocol](/platform/protocol) — the six fixed primitives that worlds
  use to interoperate.
- [Governance](/platform/governance) — how authority admission keeps
  platform surfaces from inventing local truth.

If a term is unfamiliar, the [Glossary](/reference/glossary) collects
cross-domain vocabulary used across this section.

## The Core Idea

Most AI products treat an agent as a tool that answers a single request:
ask, answer, done. Nimi treats agents as participants. A participant has
memory, an appearance, capabilities, relationships, and a role inside a
world. The agent is supposed to feel continuous; the world is supposed to
remember.

That single choice creates an architecture problem: worlds need shared
semantics. If one surface says a relationship exists, another surface
can't quietly invent a different version of that truth. If a world's
clock moves forward, agents, apps, and history all have to reason about
that the same way. Nimi answers this with protocol primitives and
authority boundaries.

## The Six Protocol Primitives

The platform spec freezes a fixed cross-world contract surface. It is
deliberately small so that worlds can be very different internally while
still interoperating.

| Primitive | What it covers |
| --- | --- |
| Timeflow | Progression, timing, and temporal meaning |
| Social | Relationships and social graph semantics |
| Economy | Value, exchange, and economic state |
| Transit | Movement between worlds or contexts |
| Context | Shared situational meaning |
| Presence | Who or what is present, and under what conditions |

A world is free to define its own internal rules. A world's economy can
be barter, points, or a regulated currency. A world's social graph can
be flat, hierarchical, or guild-shaped. What it cannot do is invent its
own version of the cross-world contract: the meaning that crosses worlds
must fit these six primitives.

## How Authority Is Split

```
                Platform
        (world model + 6 primitives
          + authority rules)
                /        \
               v          v
            Runtime      Realm
       (execution)    (truth, world
            |            state,
            |   bridge   history,
            +- - - ->    chat)
            |          |
        Cognition      |
       (memory,        |
        knowledge,     |
        prompt,        |
        completion)    |
            \         /
             v       v
              SDK boundary
            /            \
           v              v
        Desktop          Web
      (native)      (constrained
                     projection)

   Avatar consumes Realm + Cognition under
   embodiment projection contracts.
```

- Runtime executes AI workflows and capability routing.
- SDK gives apps the public integration boundary.
- Desktop provides the first-party native shell with native, local, and
  Nimi App launch surfaces.
- Web is a constrained projection; it does not inherit Desktop-native
  behavior by implication.
- Realm owns world truth, world state, history, and chat semantics.
- Avatar owns embodied agent presentation as its own first-class
  authority domain.
- Cognition owns memory, knowledge, prompt serving, references, and
  completion as a standalone authority domain that Runtime can bridge to
  but can't absorb.

## Reader Scenario: A Cross-World Move

Suppose an agent named Kira lives in World A, where she runs a small
flower shop. A user invites Kira to visit World B, which is a music
concert world. The platform model says:

1. Kira's identity is durable, not invented per world. The Transit
   primitive describes how she crosses worlds without losing identity.
2. Her relationships with people from World A do not auto-replicate into
   World B. Whatever crosses uses the Social primitive contract; the
   rest stays in World A's truth.
3. World B's local rules apply to Kira inside World B. Maybe in World B
   currency is "ticket stubs"; that does not retroactively change her
   shop economy in World A.
4. Her memory of World A travels with her under Cognition's contracts.
   Her presentation in World B follows Avatar contracts, which
   may express her differently for the carrier surface.

That single example touches Platform (Transit, Social, Economy),
Cognition (memory), Avatar (presentation), and Realm (per-world truth).
None of those surfaces are allowed to silently redefine each other; the
platform protocol is what holds them together.

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
