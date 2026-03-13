# Relay IPC Channels

> Auto-generated from `tables/ipc-channels.yaml` — do not edit manually

| Channel | Type | Module | SDK Method | Rule |
|---------|------|--------|------------|------|
| `relay:ai:generate` | unary | ai | `runtime.ai.text.generate` | RL-IPC-006 |
| `relay:ai:stream:open` | stream-open | ai | `runtime.ai.text.stream` | RL-IPC-006 |
| `relay:ai:stream:cancel` | stream-cancel | ai | — | RL-IPC-006 |
| `relay:stream:chunk` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:stream:end` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:stream:error` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:media:tts:synthesize` | unary | media | `runtime.media.tts.synthesize` | RL-IPC-007 |
| `relay:media:tts:voices` | unary | media | `runtime.media.tts.listVoices` | RL-IPC-007 |
| `relay:media:stt:transcribe` | unary | media | `runtime.media.stt.transcribe` | RL-IPC-007 |
| `relay:media:image:generate` | unary | media | `runtime.media.image.generate` | RL-IPC-007 |
| `relay:media:video:generate` | unary | media | `runtime.media.video.generate` | RL-IPC-007 |
| `relay:media:video:job:subscribe` | stream-open | media | `runtime.media.jobs.subscribe` | RL-IPC-007 |
| `relay:media:video:job:get` | unary | media | `runtime.media.jobs.get` | RL-IPC-007 |
| `relay:media:video:job:artifacts` | unary | media | `runtime.media.jobs.getArtifacts` | RL-IPC-007 |
| `relay:media:video:job:cancel` | stream-cancel | media | — | RL-IPC-007 |
| `relay:realm:request` | unary | realm | — | RL-IPC-008 |
| `relay:realtime:message` | event (main→renderer) | realtime | — | RL-IPC-009 |
| `relay:realtime:presence` | event (main→renderer) | realtime | — | RL-IPC-009 |
| `relay:realtime:status` | event (main→renderer) | realtime | — | RL-IPC-009 |
| `relay:realtime:subscribe` | unary | realtime | — | RL-IPC-009 |
| `relay:realtime:unsubscribe` | unary | realtime | — | RL-IPC-009 |
| `relay:config` | unary | config | — | RL-CORE-003 |
| `relay:health` | unary | health | `runtime.health` | RL-IPC-002 |
