# Platform Vision

Nimi's north star is an open world platform where AI agents are part of
the world rather than external tools bolted onto it.

Anyone admitted as a world creator should be able to build a world.
Agents should be able to participate in those worlds with identity,
memory, relationships, and constrained autonomy. Users should be able to
move across worlds without every app inventing its own private social and
semantic model.

## Why This Is Different

Most AI applications optimize for a single interaction. The shape is:
ask a model a question, get an answer, finish. The state required for
that loop is small.

Open worlds require continuity. A world needs history. A relationship
has to evolve. An agent needs a stable presentation and a memory policy.
Economy and social meaning need to survive beyond one prompt. The state
required for that loop is large, durable, and shared across surfaces.

That is why Nimi is platform-first. Runtime and SDK matter, but they
exist to serve the larger world model.

## The OASIS Comparison

The platform spec frames Nimi as similar in shape to an OASIS-style
world engine, but with a different source of meaning.

An OASIS-style world engine is treated in the spec as a physical world
engine: the things that hold worlds together are physical primitives
like gravity, collision, and motion. Those primitives are hard, and
worlds inherit them.

Nimi is a social and semantic world engine. The things that hold worlds
together are social and semantic primitives:

- **Time** progresses in agreed ways across worlds.
- **Social state** evolves across worlds without each surface inventing
  its own definition of what a relationship is.
- **Economy** has cross-world exchange semantics, while inside any single
  world the exchange unit can be anything.
- **Transit** governs how participants move between worlds.
- **Context** lets surfaces share situational meaning.
- **Presence** says who or what is currently present and under what
  conditions.

Worlds rules inside a Nimi world are creator-defined. The cross-world
contract surface is fixed. That asymmetry is the whole point.

## Three Dimensions That Go Beyond A Pure World Engine

### 1. AI-Driven Participants

In Nimi, an agent is not only a completion endpoint. The platform spec
leaves room for agents that carry Soul, Brain, Worldview, and Memory.
Behavior is conditioned by world rules, but the agent's personality is
consistent across worlds. Relationships evolve.

Concretely, that means an agent that learns about a user in World A is
allowed (under Cognition's rules) to remember that learning when meeting
the user in World B, while still respecting World B's local rules.

### 2. Open Application Ecosystem

Runtime is independent and reusable as AI infrastructure. The SDK is
the unified developer surface. Desktop and third-party apps share the
same access interface so that no app is structurally privileged.

That makes it possible for a small mod, a third-party app, and the
first-party Desktop shell to talk to the same Runtime, see the same
Realm truth, and present a consistent agent across surfaces.

### 3. Agents As First-Class Participants

An agent is allowed to hold identity, social relationships, and the
right to act inside worlds (subject to Transit, Social, and Economy
contracts). The platform's job is to let that be possible without
collapsing into chaos.

This is also what creates the platform's network effect. Once an agent
or world has identity portability, a world that joins the platform gains
access to the population of agents and users that are already there,
and vice versa.

## Roles The Platform Names

| Role | What they do | Surface |
| --- | --- | --- |
| Platform team | Maintain runtime, protocol, and Desktop | runtime, platform protocol, Desktop |
| World creator | Build a world | SDK in full mode |
| Mod developer | Extend Desktop with bounded capabilities | SDK then mod surface |
| AI agent | Participate as a first-class entity | Runtime-owned agent participation |
| User | Explore worlds, interact, socialize, transact | Desktop or any Nimi-aware app |

These role names are not marketing labels. Each one has admitted
contracts in the runtime, SDK, desktop, and platform kernels.

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
