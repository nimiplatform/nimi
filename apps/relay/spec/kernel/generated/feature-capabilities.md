# Relay Feature Capabilities

> Auto-generated from `tables/feature-capabilities.yaml` — do not edit manually

| Feature | Display Name | Runtime | Realm | Agent | Socket | Async | SDK Module | Rule | Notes |
|---------|-------------|---------|-------|-------|--------|-------|------------|------|-------|
| agent-chat | Agent Chat (Local AI) | yes | no | yes | no | no | `runtime.ai` | RL-FEAT-001 | |
| human-chat | Human Chat | no | yes | yes | yes | no | `realm` | RL-FEAT-002 | |
| tts | Text-to-Speech | yes | no | yes | no | no | `runtime.media.tts` | RL-FEAT-003 | listVoices requires `model`; agent profile resolves defaults |
| stt | Speech-to-Text | yes | no | **no** | no | no | `runtime.media.stt` | RL-FEAT-004 | Call is agent-independent; transcript consumption is agent-scoped via RL-FEAT-001 |
| live2d | Live2D Character | no | no | yes | no | no | — (renderer) | RL-FEAT-005 | |
| video | Video Generation | yes | no | yes | no | yes | `runtime.media.video` + `runtime.media.jobs` | RL-FEAT-006 | Job status via `jobs.subscribe/get`, not `video.status` |
| agent-profile | Agent Profile & Selection | no | yes | no | no | no | `realm` | RL-FEAT-007 | |
