# Conversation Capability Projection

> Status: Running today. Desktop projects capability availability for the
> active Runtime-owned conversation anchor.

The projection combines Runtime route and readiness results with bounded
Desktop controls for the active conversation. It does not define a capability
set, participation profile, execution route, or durable Conversation truth.

## Why Per-Conversation

A user may choose voice playback or attachments for one active conversation
without changing another. Keeping those controls scoped to the Runtime
conversation anchor prevents ephemeral UI choices from becoming global
LocalAgent state.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Ephemeral controls and availability rendering | Conversation anchor and continuity (Runtime) |
| Typed unavailable and setup UI | Voice, media, tool, route, Quota, and Budget decisions (Runtime) |
| Attachment selection before submission | Committed attachment and turn truth (Runtime) |

Desktop may cache projection state for rendering, but the cache is not
Runtime or Realm truth and cannot prove a capability ready.

## Reader Scenario: User Toggles Voice For A Conversation

1. **User requests voice.** Desktop submits typed intent for the active
   Runtime conversation anchor.
2. **Runtime evaluates the request.** Current authorization, route, Quota,
   Budget, and readiness determine the result.
3. **Desktop renders the projection.** Other conversation anchors are
   unaffected.

## What Conversation Capability Does Not Do

- It does not become a LocalAgent presentation or participation profile.
- It does not redefine voice, media, tool, route, or authorization semantics.
- It does not promote UI or cached state to Conversation or LocalAgent truth.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
