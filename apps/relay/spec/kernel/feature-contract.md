# Relay Feature Contract

> Rule namespace: RL-FEAT-*
> Fact source: tables/feature-capabilities.yaml
> Prerequisite: RL-CORE-001 — agent-scoped features require a selected agent
> Exception: STT and Agent Profile operate without agent selection (see per-rule notes)

## RL-FEAT-001 — Agent Chat (Local AI)

Direct SDK runtime.ai calls — no mod system intermediary:

- Text generation: `runtime.ai.text.generate({ agentId, prompt, ... })`
- Text streaming: `runtime.ai.text.stream({ agentId, prompt, ... })`
- `agentId` from the current agent context (RL-CORE-002)

The renderer invokes these through IPC (RL-IPC-006).
Scenario execution follows K-SCENARIO-* rules.
Streaming follows K-STREAM-* rules.

Changing the selected agent cancels any in-flight stream and clears the chat view
(or switches to per-agent history if history persistence is implemented).

## RL-FEAT-002 — Realtime Presence

Relay only keeps realtime presence/message subscription plumbing.
Human-agent chat send is not exposed through Relay IPC; agent execution stays on the runtime pipeline.

## RL-FEAT-003 — Voice (TTS)

Via SDK `runtime.media.tts`:

- `synthesize({ agentId, text, voiceId?, model })`: text → audio (base64 PCM/WAV)
- `listVoices({ model, ... })`: available voice catalog
  - SDK `SpeechListVoicesInput` requires `model` (string, mandatory)
  - Optional: `subjectUserId`, `connectorId`, `route`, `fallback`, `metadata`
- Agent voice resolution: current agent's profile determines the default `model` and `voiceId`
  for both `synthesize` and `listVoices` calls (RL-CORE-002)

Renderer plays audio via Web Audio API.
IPC channel: `relay:media:tts:synthesize`, `relay:media:tts:voices` (RL-IPC-007)

## RL-FEAT-004 — Voice (STT)

Via SDK `runtime.media.stt`:

- `transcribe({ audio, format })`: audio → text

Renderer captures microphone via MediaRecorder API.
Audio data sent as base64 over IPC (RL-IPC-005).
Transcribed text can be fed into agent chat (RL-FEAT-001) as user input.
IPC channel: `relay:media:stt:transcribe` (RL-IPC-007)

**Agent dependency**: STT itself is agent-independent — transcription does not require knowing
which agent is selected. The *consumption* of the transcript (feeding into RL-FEAT-001) is
agent-scoped, but the STT call is not. `requires_agent: false` in the capabilities table
reflects this: STT can operate even before an agent is selected.

## RL-FEAT-005 — Live2D

Renderer-side implementation using pixi.js + pixi-live2d-display:

- Model loading: model path derived from current agent's Live2D binding (RL-CORE-002)
- Animation control: idle, tap, motion groups
- Lip sync: TTS playback state (RL-FEAT-003) → Live2D `ParamMouthOpenY` parameter
- Agent switch triggers model unload → load of new agent's model

Reference: `nimi-mods/runtime/buddy/src/live2d/`

This is a renderer-only feature — no runtime or realm dependency.
Requires `pixi.js` and `pixi-live2d-display` as renderer dependencies.

## RL-FEAT-006 — Video

Via SDK `runtime.media.video` + `runtime.media.jobs`:

- `runtime.media.video.generate({ agentId, prompt, mode, model, content, ... })`
  - Returns `VideoGenerateOutput: { job: ScenarioJob, artifacts: ScenarioArtifact[], trace }`
  - If the job completes synchronously, artifacts are populated immediately
- For async jobs (artifacts empty, job status pending/processing):
  - `runtime.media.jobs.subscribe(jobId)` → `AsyncIterable<ScenarioJobEvent>` (preferred)
  - `runtime.media.jobs.get(jobId)` → `ScenarioJob` (fallback polling)
  - `runtime.media.jobs.getArtifacts(jobId)` → retrieve artifacts on completion
- `runtime.media.video.stream(input)` → `AsyncIterable<ArtifactChunk>` (alternative streaming path)

**Note**: there is no `runtime.media.video.status()` method. Job status tracking is through
the shared `runtime.media.jobs` module, which covers all async media jobs (image, video, music).

Renderer plays result via `<video>` element.

IPC channels (all under RL-IPC-007, stream protocol per RL-IPC-003):

| Channel | Type | Purpose |
|---------|------|---------|
| `relay:media:video:generate` | unary | Submit generation, returns `{ job, artifacts, trace }` |
| `relay:media:video:job:subscribe` | stream-open | Subscribe to job events → `relay:stream:chunk/end/error` |
| `relay:media:video:job:cancel` | stream-cancel | Cancel job event subscription |
| `relay:media:video:job:get` | unary | Poll job status (fallback) |
| `relay:media:video:job:artifacts` | unary | Retrieve completed artifacts |

Main process handles job subscription/polling; renderer receives status updates via
`relay:stream:chunk` with `ScenarioJobEvent` data shape (RL-IPC-003).

## RL-FEAT-007 — Agent Profile & Selection

Via typed Relay bridge:

- Fetch agent list: `relay:agent:list`
- Fetch agent profile: `relay:agent:get`
- Agent switching: update `currentAgent` in store, propagate to all surfaces (RL-CORE-002)

Agent selection is the entry gate for all other features (RL-CORE-001).

## RL-FEAT-008 — Model Configuration

Lightweight model status and management via SDK passthrough:

- **Model service** (RL-IPC-010): list all registered models, pull/remove models, check health
- **Local runtime** (RL-IPC-011): list/install/remove/start/stop local models, device profile, catalog search
- **Connector management** (RL-IPC-012): CRUD connectors, test connections, browse provider catalogs
- **Desktop interop** (RL-IPC-013): one-click open Desktop runtime config for advanced management

Model configuration is not agent-scoped — operations apply to the runtime globally.
Relay provides a lightweight status panel; full management UI lives in Desktop (RL-INTOP-004).
