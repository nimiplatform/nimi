# Conversation Capability Projection

> Status: Running today. Desktop shows which capabilities are available
> for the conversation you currently have open.

This surface combines what Runtime reports with a small set of
per-conversation controls. It doesn't define a capability set, a
participation profile, an implementation choice, or any permanent
Conversation state.

## Why Per-Conversation

You might want voice playback or attachments in one conversation and
not in another. Scoping these controls to the conversation you have
open keeps a quick UI choice from hardening into agent-wide state.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Ephemeral controls and availability rendering | Conversation anchor and continuity (Runtime) |
| Typed unavailable and setup UI | Voice, media, tool, implementation, Quota, and Budget decisions (Runtime) |
| Attachment selection before submission | Committed attachment and turn truth (Runtime) |

Desktop may cache what it renders for speed, but that cache is never
the real state — and it can't prove a future operation will execute.

## Reader Scenario: User Toggles Voice For A Conversation

1. **User requests voice.** Desktop submits typed intent for the active
   Runtime conversation anchor.
2. **Runtime evaluates the request.** Current capability intent, authorization,
   Quota, Budget, and implementation availability determine the result.
3. **Desktop renders the projection.** Other conversation anchors are
   unaffected.

## Runtime Ownership

These controls stay separate from the agent's presentation and
participation profiles. Voice, media, tool, implementation, and
authorization semantics all stay with Runtime. UI and cached state
never rewrite the Conversation or the LocalAgent.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
