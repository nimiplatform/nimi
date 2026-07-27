# Avatar

Avatar covers how an Agent gets shown — in a window, in a virtual
character, in an animation. The rule is simple: presentation can vary,
but the Agent itself doesn't become a different Agent just because
rendering changed.

This is an authority overview, not a complete public-product promise.

## What An Avatar Actually Is

An avatar isn't just an image. It's a governed presentation layer for an
AI participant. It can include the visual body, motion, events, what
each carrier surface is willing to display, and backend-specific
rendering branches.

Avatar is its own authority domain because presentation has to follow
the agent's truth, not make up its own. If an avatar stops moving
because the renderer hit a bug, that's a presentation problem — the
agent itself didn't go offline. If a carrier shows a different look from
what the agent's profile says, that's a renderer mismatch — the agent
didn't change.

## What Avatar Owns And What It Does Not Own

Avatar owns:

- embodiment projection contracts (how the agent is projected onto a
  carrier);
- carrier visual acceptance contracts (whether a carrier can display
  this embodiment under admitted shapes);
- shell-specific rendering branches (Desktop avatars and other shells
  have their own admitted contracts).

Avatar doesn't own:

- Character identity (Realm owns durable identity) and LocalAgent
  execution identity (Runtime owns materialization and lifecycle);
- LocalAgent memory (Runtime owns Memory authority);
- the world's social relationships (Realm owns those);
- generation and execution (Runtime owns that).

This split is important. An Avatar surface that drifted into agent
identity or memory authority would be a parallel authority, not a
presentation domain.

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
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
