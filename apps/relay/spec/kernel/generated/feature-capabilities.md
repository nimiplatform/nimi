# Relay Feature Capabilities

> Auto-generated from `tables/feature-capabilities.yaml` — do not edit manually
| Feature | Display Name | Runtime | Realm | Agent | Socket | Async | SDK Module | Rule | Notes |
|---------|-------------|---------|-------|-------|--------|-------|------------|------|-------|
| agent-chat | Agent Chat (Local AI) | yes | no | yes | no | no | `runtime.ai` | RL-FEAT-001 |  |
| human-chat | Human Chat | no | yes | yes | yes | no | `realm` | RL-FEAT-002 |  |
| tts | Text-to-Speech | yes | no | yes | no | no | `runtime.media.tts` | RL-FEAT-003 | listVoices requires model (mandatory); agent profile resolves default model + voiceId |
| stt | Speech-to-Text | yes | no | **no** | no | no | `runtime.media.stt` | RL-FEAT-004 | STT call is agent-independent; consumption of transcript is agent-scoped via RL-FEAT-001 |
| live2d | Live2D Character | no | no | yes | no | no | — (renderer) | RL-FEAT-005 |  |
| video | Video Generation | yes | no | yes | no | yes | `runtime.media.video + runtime.media.jobs` | RL-FEAT-006 | Job status via media.jobs.subscribe/get, not video.status (which does not exist) |
| agent-profile | Agent Profile & Selection | no | yes | **no** | no | no | `realm` | RL-FEAT-007 |  |
| model-config | Model Configuration | yes | no | **no** | no | no | `runtime.model + runtime.local + runtime.connector` | RL-FEAT-008 | Lightweight model status and management; full UI lives in Desktop (RL-INTOP-004) |
| chat-pipeline | Beat-First Chat Pipeline | yes | no | yes | no | no | `runtime.ai` | RL-PIPE-001 | Full turn pipeline — first-beat reactor, turn composer, delivery director |
| session-store | Session Persistence | no | no | yes | no | no | — (renderer) | RL-PIPE-002 | Conversation ledger persisted to Electron userData via RelayChatStorage |
| interaction-state | Interaction State Tracking | no | no | yes | no | no | — (renderer) | RL-PIPE-008 | Emotional temperature, relationship state, commitments, open loops |
| relation-memory | Relation Memory | no | no | yes | no | no | — (renderer) | RL-PIPE-009 | Slot-based memory (preference/boundary/rapport/promise/recurringCue/taboo) |
| media-orchestration | Media Modality Orchestration | yes | no | yes | no | no | `runtime.media.image + runtime.media.video` | RL-PIPE-006 | Per-beat modality selection with autonomy/cooldown/NSFW policy |
| proactive-heartbeat | Proactive Heartbeat | yes | no | yes | no | no | — (renderer) | RL-PIPE-007 | Deterministic policy engine with daily cap, cooldown, idle window gates |
| product-settings | Product Settings | no | no | **no** | no | no | — (renderer) | RL-PIPE-006 | mediaAutonomy, voiceAutonomy, visualComfortLevel, allowProactiveContact |
