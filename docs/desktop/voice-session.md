# Voice Session

> Status: Running today. Voice sessions in Desktop agent chat are live;
> the session, executor, and workflow pieces are defined at the kernel
> level (`agent-chat-voice-*-contract.md`).

A voice session is where you talk with your agent out loud: you speak,
the agent replies in voice, captions stay in sync, and the session
state is always visible. The underlying contracts split deliberately
into session, executor, and workflow.

## Three Contracts

| Contract | Owns |
| --- | --- |
| Voice session | Higher-level voice session lifecycle as it appears in chat |
| Voice executor | Per-turn voice execution mechanics |
| Voice workflow | Cross-turn workflow + identity binding |

The split keeps three questions apart: "did you start a voice
conversation", "how is one turn executing", and "how does the agent's
voice identity carry across turns".

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Desktop chat voice surface lifecycle + UI | Voice creation (`K-VOICE-*` runtime — see [Voice Asset Lifecycle](/runtime/voice-asset-lifecycle)) |
| Per-turn voice executor in chat | TTS / STT provider semantics (Runtime) |
| Workflow + identity binding in chat | Avatar lipsync (Avatar) |

The Desktop voice surface plays Runtime's voice capabilities through
the captioned chat UI. It doesn't do voice cloning or asset storage
itself.

## Reader Scenario: User Voice Turn

User taps voice in chat and speaks.

1. **Voice session begins.** Desktop tracks lifecycle.
2. **STT executes.** Per voice executor contract; transcribes user
   speech.
3. **Turn submits.** Per `RuntimeAgentService` turn lifecycle.
4. **Agent reply streams.** TTS executes per executor contract.
5. **Captions sync.** Desktop chat surface keeps captions aligned
   to audio.
6. **Avatar lipsync.** If Avatar is also open, runtime presentation
   stream + Avatar audio pipeline drive `ParamMouthOpenY`.

## What Voice Session Does Not Do

- It doesn't create voice assets (`K-VOICE-*` lives in Runtime).
- It doesn't redefine TTS / STT provider semantics.
- It doesn't bypass the `RuntimeAgentService` turn lifecycle.
- It doesn't drive Avatar lipsync.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
