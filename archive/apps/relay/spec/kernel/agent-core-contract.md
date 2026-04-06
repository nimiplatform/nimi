# Relay Agent Core Contract

> Rule namespace: RL-CORE-*
> This contract defines the agent-centric interaction invariant.

## RL-CORE-001 — Selected Agent Drives All Surfaces

A single `currentAgent` (agentId + profile) is the global interaction context.
Every feature surface — chat, voice, video, Live2D — is scoped to this agent.

When no agent is selected, all interaction surfaces show an agent selection prompt,
not an empty or generic state.

## RL-CORE-002 — Agent Binding Propagation

`currentAgent` is stored in the app-level store and consumed by:

- **Agent chat**: `agentId` passed in every `runtime.ai.text.generate` / `stream` call
- **Voice TTS**: agent's voice profile determines default `model` and `voiceId`
- **Voice STT**: agent-independent (raw transcription has no agent affinity);
  the *consumption* of transcribed text feeds into agent chat (RL-FEAT-001)
- **Live2D**: agent's model binding determines which Live2D model loads
- **Video**: generation scoped to current agent context
- **Human chat**: channel selection scoped to current agent's world/channel

Changing the selected agent resets all active sessions:
- Cancel in-flight streams
- Clear chat history (or switch to per-agent history)
- Unload current Live2D model, load the new agent's model

## RL-CORE-003 — Agent Resolution at Bootstrap

Renderer bootstrap resolves the initial agent:

1. If `NIMI_AGENT_ID` env var is set → use it as default
2. Else → fetch agent list from Realm, prompt user to select
3. Until an agent is selected, interaction surfaces are gated

## RL-CORE-004 — Agent Context in IPC

All agent-scoped IPC calls include `agentId` in their input payload.
Main process handlers extract `agentId` and pass it to SDK calls.

This is enforced at the IPC layer, not per-feature:
- `relay:ai:generate` → `{ agentId, prompt, ... }`
- `relay:ai:stream:open` → `{ agentId, prompt, ... }`
- `relay:media:tts:synthesize` → `{ agentId, text, ... }`
- `relay:media:video:generate` → `{ agentId, prompt, ... }`
