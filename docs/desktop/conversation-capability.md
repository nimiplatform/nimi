# Conversation Capability

> Status: Running today. The Desktop conversation capability
> contract (`canonical/desktop/agent-projection.authority.yaml`)
> is the shipped per-conversation capability negotiation surface.

The Desktop Conversation Capability surface governs **what
capabilities a conversation supports** — voice on / off, image
attachment on / off, tool calling admitted, etc. — at the
per-conversation grain. The capability set is per-conversation,
not per-agent globally.

## Why Per-Conversation

A user might want voice in one conversation with their agent and not
in another. A group thread might admit image attachments while a
dyadic chat does not. Per-conversation negotiation captures that
without forcing a uniform "voice on for this agent always."

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Per-conversation capability state | Realm thread / membership truth (Realm) |
| Capability negotiation UI | Voice / image / tool execution (Runtime + per-domain contracts) |
| Anchor-scoped capability admission | Agent participation profile (Runtime) |

The capability state is desktop-side per-conversation truth. It is
not promoted to runtime persistent profile or to Realm canonical
truth.

## Reader Scenario: User Toggles Voice For A Conversation

1. **User toggles voice on.** Desktop conversation capability
   updates per-conversation state.
2. **Subsequent turns admit voice paths.** Voice session contract
   activates for this conversation.
3. **Other conversations unaffected.** Per-conversation scope
   honored.

## What Conversation Capability Does Not Do

- It does not become canonical agent presentation profile.
- It does not redefine voice / image / tool semantics.
- It does not promote per-conversation state to global agent state.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
