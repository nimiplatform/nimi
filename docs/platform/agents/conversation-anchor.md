# Conversation Anchor

A Conversation anchor identifies one Runtime-owned LocalAgent Conversation. It
is not the LocalAgent identity itself and it is never inferred from a UI route,
Avatar instance, transcript cache, or the last LocalAgent a surface displayed.

Runtime owns opening, committing, snapshotting, recovering, interrupting, and
projecting a Conversation. More than one Conversation may exist for the same
LocalAgent, so consumers must keep the explicit anchor returned through the
standard SDK surface.

## Opening and recovery

The caller supplies typed intent and an explicit LocalAgent target. Runtime
derives the account, App identity, authorization, ownership or access, and
current session before it creates or recovers a Conversation.

Recovery uses Runtime-owned anchors and snapshots. Local message history is a UI
cache only; it cannot prove continuity or reconstruct Conversation, Memory, or
Knowledge truth.

## Projection boundary

An authorized consumer may receive committed turns and bounded status for the
active Conversation. Raw provider output, parser payloads, credentials,
internal prompts, and Runtime proof remain private.

Avatar may attach a visible instance to an authorized Conversation for
presentation. Its launch ID and renderer state do not create or prove the
Conversation.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
