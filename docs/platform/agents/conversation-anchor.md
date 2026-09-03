# Conversation Anchor

A Conversation anchor names one specific conversation with a LocalAgent.
Runtime issues it, and it is the only reliable way to refer to that
conversation later. It is not the LocalAgent's identity, and it can never be
guessed from a UI route, an Avatar instance, a cached transcript, or whatever
LocalAgent a screen happened to show last.

Runtime opens, commits, snapshots, recovers, and interrupts conversations, and
provides typed views of them. One LocalAgent can have many conversations, so
consumers must hold on to the explicit anchor the standard SDK surface
returns.

## Opening and recovery

The caller passes typed intent and an explicit LocalAgent target. Before
creating or recovering a conversation, Runtime works out the account, the App
identity, the authorization, and the ownership or access from the active
session.

Recovery uses anchors and snapshots that Runtime keeps. Local message history
is a UI cache only: it cannot prove continuity, and it cannot rebuild what the
conversation, memory, or knowledge actually hold.

## Projection boundary

An authorized consumer can receive committed turns and bounded status for the
active conversation. Raw provider output, parser payloads, credentials,
internal prompts, and Runtime-internal proofs stay private.

Avatar can attach a visible instance to an authorized conversation for
presentation. Its launch ID and renderer state neither create nor prove the
conversation.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
