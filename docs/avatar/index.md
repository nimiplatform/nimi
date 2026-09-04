# Avatar

Avatar covers how an Agent gets shown — in a window, as a virtual
character, in an animation. The rule is simple: presentation can vary,
but the Agent itself doesn't become a different Agent just because
rendering changed.

## What An Avatar Actually Is

An avatar isn't just an image. It's the whole presentation layer for an
AI participant: the visual body, the motion, the events, what each
carrier surface is willing to display, and the rendering branches of
each backend.

Presentation has to follow the agent's truth, not make up its own. If
an avatar stops moving because the renderer hit a bug, that's a
presentation problem — the agent itself didn't go offline. If a carrier
shows a different look from what the agent's profile says, that's a
renderer mismatch — the agent didn't change.

## What Avatar Owns And What It Does Not Own

Avatar owns:

- how an agent's embodiment is presented onto a carrier;
- whether a carrier can display that embodiment, and in what shape;
- the shell-specific rendering branches (Desktop avatars and other
  shells each have their own rules).

Avatar doesn't own:

- Character identity (Realm keeps durable identity) or LocalAgent
  execution identity (Runtime materializes the agent and runs its
  lifecycle);
- LocalAgent long-term memory (Cognition keeps long-term Memory;
  Runtime keeps its own runtime state);
- the world's social relationships (Realm keeps those);
- generation and execution (Runtime does that).

This split matters. An Avatar surface that started deciding who an
agent is, or what it remembers, would stop being a presentation layer
and start competing with the parts of the platform those facts belong
to.

## Reader Scenario: An Embodiment That A Carrier Cannot Display

Suppose an agent has an embodiment definition that includes motion
behavior the current carrier cannot render. Under the avatar
contracts:

1. The carrier visual acceptance contract decides whether the
   embodiment is admitted on this carrier.
2. If the embodiment is not fully admissible, the carrier does not
   silently render a half-version. The contract decides what happens
   (fall back to an admitted projection, refuse, or signal a typed
   incompatibility).
3. The Character and LocalAgent truth in Realm and Runtime is unchanged
   regardless of what the carrier does.

The presentation problem stays in Avatar. The agent stays the agent.

## Reader Scenario: Why Avatar Is Separate From Runtime

Suppose someone asks why presentation is its own authority instead of
a runtime feature. The reason is that presentation:

- has to be projected differently across carriers (Desktop's avatar,
  potentially other carriers);
- has its own visual acceptance posture;
- can be debugged or replayed as a presentation problem rather than as
  an execution problem.

If presentation lived inside Runtime, those concerns would crowd
Runtime's execution semantics. Splitting them keeps each domain's
contracts focused.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
