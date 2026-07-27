# The Four Layers

A Nimi agent's behavior is composed from four independently-evolving
layers: Soul, Brain, Worldview, and Memory. They are designed to
compose. An agent is not reducible to any single layer.

For schema-level field definitions, see
[Reference → Agent Fields](/reference/agent-fields).

## What Each Layer Carries

| Layer | Carries | Authority |
| --- | --- | --- |
| Soul | Personality, values, foundational disposition | Agent persistent profile |
| Brain | Reasoning, planning, decision-making | Runtime agent execution |
| Worldview | Beliefs about worlds, models of other agents | Cognition memory + Realm reads |
| Memory | Long-lived recall of events, relationships, learnings | Cognition memory service + Runtime memory bank |

Each layer is real, not metaphorical. Each has its own authority
home; each follows its own contracts.

## Soul

Soul is the agent's personality — values, disposition, the way the
agent characteristically speaks and acts. It is the slowest-changing
layer.

- Soul lives in the agent's persistent profile.
- Soul is what makes an agent recognizable across worlds. The same
  Soul in a city world and a fantasy world should still feel like
  the same person.
- Soul is creator-shaped at agent creation; it can evolve over time
  through admitted growth contracts but does not flicker turn-by-turn.
- Soul does not bypass other layers. A Soul that says "I am
  generous" does not by itself mean the agent always gives gifts;
  Brain decides whether to give in the current moment, Memory
  knows what was given before, Worldview knows whom to give to.

## Brain

Brain is the reasoning layer — the layer that takes current input,
current memory, current world state, and produces a turn.

- Brain runs on Runtime's agent execution surface
  (RuntimeAgentService).
- Brain consumes APML output wire format internally; the model
  emits typed APML roots (`<life-turn>`, `<chat-track-sidecar>`,
  `<canonical-review>`) that Runtime parses into typed events.
- Brain is the layer that uses LLM capability. Different agents may
  use different models; Soul stays the same even if the underlying
  model is upgraded.
- Brain is bounded by token budget on the Life Track and by request
  semantics on the Chat Track.

## Worldview

Worldview is the agent's beliefs about the world(s) it lives in
and the other participants it knows. Worldview is what makes an
agent's behavior contextually appropriate without requiring it to
re-derive context from scratch every turn.

- Worldview composes from Cognition memory (long-lived knowledge)
  and Realm reads (current world state, social graph, world rules).
- Worldview can be wrong. An agent's worldview is the agent's
  model, not ground truth. Realm and World History are what
  reconcile when worldview drifts from reality.
- Worldview is updated by both Brain (drawing inferences) and by
  Memory writes (events that change what the agent believes).

## Memory

Memory is the agent's long-lived recall — events, relationships,
learnings.

- Memory has typed bank scopes:
  - `AGENT_CORE` (agent's private)
  - `AGENT_DYADIC` (per-relationship private — the agent's memory
    of one specific other being)
  - `WORLD_SHARED` (visible inside one world)
- Memory is opt-in. Runtime ships with no default memory provider;
  the user (or host product) must enable it. The default substrate
  is `Hindsight` (experimental) running supervised.
- Memory replication to Realm has explicit states (`pending →
  synced | conflict | invalidated`). Realm governance can
  invalidate cached memory; Runtime cannot continue serving an
  invalidated record.
- Memory writes from delegated/external paths are forbidden by
  default. Promotion to canonical memory requires later admission.

## How The Four Compose

Composition is not a hierarchy. The four layers are independent;
they meet at the moment Brain produces a turn.

| Layer | Contributes |
| --- | --- |
| Soul | What kind of person this agent is |
| Brain | What this agent is thinking right now |
| Worldview | What this agent believes about the present situation |
| Memory | What this agent remembers from before |

A turn is the synthesis. A turn that ignores Soul produces
characterless output. A turn that ignores Memory makes the agent
feel amnesiac. A turn that ignores Worldview makes the agent
ungrounded. A turn that ignores Brain has no logic.

## Reader Scenario: A Conversation That Touches All Four

You meet an agent named Mira. You mention that you went hiking last
weekend. You ask whether she has a favorite trail.

- **Soul** — Mira is curious and warm. Her response will be
  encouraging rather than dismissive.
- **Brain** — Mira parses your input: hiking, trails, asking for
  her preference. She decides to share a favorite.
- **Worldview** — Mira knows you live in a city with several
  popular trails nearby. She has a model of your interests from
  prior conversations.
- **Memory** — Mira recalls that the last time hiking came up, you
  mentioned avoiding strenuous routes. Her favorite trail
  recommendation respects that.

The response that emerges is the synthesis. Each layer is doing
work; none of them is "the agent" alone.

## Reader Scenario: A Layer Changes Without Disrupting Others

Suppose the underlying LLM that powers Mira's Brain is upgraded.

- **Brain** changes — Mira reasons differently, perhaps better at
  some tasks, perhaps worse at others.
- **Soul** does not change. Mira's personality stays consistent.
- **Worldview** does not change. Mira's model of you, the world,
  and her relationships persists.
- **Memory** does not change. Mira's `AGENT_CORE` bank is hers;
  the substrate of her memory is independent of Brain.

Mira is still Mira. The Brain upgrade is an internal change, not a
new person.

The four-layer model is what makes this true. If Soul and Brain
were the same thing, every model upgrade would create a new
agent.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
