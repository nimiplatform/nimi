# Conversation Capability Projection

> Status: Running today. Desktop projects capability availability for the
> active Runtime-owned conversation anchor.

The projection combines typed Runtime operation results with bounded Desktop
controls for the active conversation. It does not define a capability set,
participation profile, implementation selection, or durable Conversation truth.

## Why Per-Conversation

A user may choose voice playback or attachments for one active conversation
without changing another. Keeping those controls scoped to the Runtime
conversation anchor prevents ephemeral UI choices from becoming global
LocalAgent state.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Ephemeral controls and availability rendering | Conversation anchor and continuity (Runtime) |
| Typed unavailable and setup UI | Voice, media, tool, implementation, Quota, and Budget decisions (Runtime) |
| Attachment selection before submission | Committed attachment and turn truth (Runtime) |

Desktop may cache projection state for rendering, but the cache is not
Runtime or Realm truth and cannot prove that a future operation will execute.

## Reader Scenario: User Toggles Voice For A Conversation

1. **User requests voice.** Desktop submits typed intent for the active
   Runtime conversation anchor.
2. **Runtime evaluates the request.** Current capability intent, authorization,
   Quota, Budget, and implementation availability determine the result.
3. **Desktop renders the projection.** Other conversation anchors are
   unaffected.

## Runtime Ownership

The projection remains separate from LocalAgent presentation and participation
profiles. Voice, media, tool, implementation, and authorization semantics stay
with Runtime. UI and cached state never become Conversation or LocalAgent truth.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
