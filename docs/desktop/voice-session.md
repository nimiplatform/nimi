# Voice Session

> Status: Running today. Desktop's agent chat voice session, voice
> executor, and voice workflow contracts are shipped at the
> kernel level (`agent-chat-voice-*-contract.md`).

The Desktop voice session is the surface where a user holds a voice
conversation with their agent: speech in, agent reply out, captions
synchronized, lifecycle states explicit. The contracts split
deliberately into session, executor, and workflow.

## Three Contracts

| Contract | Owns |
| --- | --- |
| Voice session | Higher-level voice session lifecycle as it appears in chat |
| Voice executor | Per-turn voice execution mechanics |
| Voice workflow | Cross-turn workflow + identity binding |

The split keeps "did the user start a voice conversation" separate
from "how is one turn executing" separate from "how does the agent's
voice identity bind across turns."

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Desktop chat voice surface lifecycle + UI | Voice creation (`K-VOICE-*` runtime — see [Voice Asset Lifecycle](/runtime/voice-asset-lifecycle)) |
| Per-turn voice executor in chat | TTS / STT provider semantics (Runtime) |
| Workflow + identity binding in chat | Avatar lipsync (Avatar) |

The Desktop voice surface consumes runtime voice + projects through
the captioned chat UI. It does not invent voice cloning or asset
storage.

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

- It does not own voice creation (`K-VOICE-*` runtime).
- It does not redefine TTS / STT provider semantics.
- It does not bypass `RuntimeAgentService` turn lifecycle.
- It does not own Avatar lipsync.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
