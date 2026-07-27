# LocalAgent Presentation Stream

Runtime owns transient LocalAgent turn, state, activity, emotion, voice,
interruption, and presentation projection truth. Consumers own only their
rendering, playback, interaction, and ephemeral UI state.

## Projection boundary

The presentation stream carries typed, authorized product events. Runtime
validates model and provider output before any event is committed. Raw parser
payloads, provider metadata, credentials, prompts, tool material, and internal
proof never become public stream fields.

Access is derived from the active session. A consumer must supply an explicit
LocalAgent or Conversation target where the operation requires one; it cannot
infer a global current LocalAgent.

## Avatar and other renderers

Avatar may map typed Runtime input into renderer-local motion, expression,
camera, physics, lipsync, and playback. Those details stay local to Avatar.
Renderer state cannot be written back as LocalAgent truth, and Apps do not
receive raw motion or driver control.

Desktop and other Apps follow the same rule: a visible state is a projection,
not permission to synthesize or override Runtime state.

## Failure behavior

Unavailable diagnostics, voice, or optional presentation details report their
own typed state. They do not fabricate Runtime success or block unrelated
LocalAgent Conversation.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
