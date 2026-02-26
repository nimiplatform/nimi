# Runtime AI Provider Support Matrix

> Implementation inventory for `nimi-runtime`.
> This page documents **current implementation**; contract truth remains in `ssot/runtime/*.md`.

## 1. Field Definitions

- `Online/Local`: `local-runtime` (local) or `token-api` (cloud).
- `Model Family`: expected model-id prefix or provider family.
- `Model Types`: runtime modality coverage (`text`, `stream`, `embed`, `image`, `video`, `tts`, `stt`).
- `OpenAI-compatible`: provider path can be called via OpenAI-style REST/SSE schema.
- `Nimi-compatible`: normalized by Nimi canonical mapping, reasonCode, and audit semantics.
- `Transport`: runtime integration protocol (`REST`, `SSE`, `WS`, `Task Polling`).
- `Adapter`: adapter selected in runtime media execution path.
- `Demo (Go)`: Go test reference.
- `Demo (TS Tutorial)`: end-user TypeScript script (`docs/examples/providers/*.ts`).

## 2. Current Support Matrix

| Provider | Online/Local | Model Family | Model Types | OpenAI-compatible | Nimi-compatible | Transport | Adapter | Key Features / Limits | Demo (Go) | Demo (TS Tutorial) |
|---|---|---|---|---|---|---|---|---|---|---|
| LocalAI | Local (`local-runtime`) | `localai/*` or `local/*` | `text/stream/embed/image/video/tts/stt` | Yes | Yes | REST + SSE | `openai_compat_adapter` | Local OpenAI-compatible full modality path. | [provider_openai_test.go](../../runtime/internal/services/ai/provider_openai_test.go), [service_test.go](../../runtime/internal/services/ai/service_test.go) | [localai.ts](../examples/providers/localai.ts) |
| Nexa | Local (`local-runtime`) | `nexa/*` | `text/stream/embed/image/tts/stt`, `video` fail-close | Partial (OpenAI gateway shape) | Yes | REST + SSE | `nexa_native_adapter` | `video` returns `AI_ROUTE_UNSUPPORTED` (strict fail-close). | [provider_local_test.go](../../runtime/internal/services/ai/provider_local_test.go) | [nexa.ts](../examples/providers/nexa.ts) |
| LiteLLM | Online (`token-api`) | `litellm/*` | `text/stream/embed/image/video/tts/stt` | Yes | Yes | REST + SSE | `openai_compat_adapter` | Cloud default backend + provider-hint routing. | [provider_cloud_test.go](../../runtime/internal/services/ai/provider_cloud_test.go) | [litellm.ts](../examples/providers/litellm.ts) |
| Alibaba (cloud adapter) | Online (`token-api`) | `aliyun/*`, `alibaba/*` | `text/stream/embed/image/video/tts/stt` | Yes | Yes | REST + SSE | `openai_compat_adapter` | Prefix route + availability fail-close. | [provider_cloud_test.go](../../runtime/internal/services/ai/provider_cloud_test.go) | [litellm.ts](../examples/providers/litellm.ts) |
| Bytedance (cloud adapter) | Online (`token-api`) | `bytedance/*`, `byte/*` | `text/stream/embed/image/video/tts/stt` | Yes | Yes | REST + SSE | `openai_compat_adapter` | Prefix route + availability fail-close. | [provider_cloud_test.go](../../runtime/internal/services/ai/provider_cloud_test.go) | [bytedance-openspeech.ts](../examples/providers/bytedance-openspeech.ts) |
| Bytedance OpenSpeech (custom) | Online (`token-api`) | speech custom route | `tts/stt` | No | Yes | REST + WS | `bytedance_openspeech_adapter` | STT supports audio chunk WS path + canonical options passthrough. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [bytedance-openspeech.ts](../examples/providers/bytedance-openspeech.ts) |
| Gemini Operation (custom) | Online (`token-api`) | `gemini/*` (image/video operation) | `image/video` | No | Yes | REST + Task Polling | `gemini_operation_adapter` | Async operation submit/poll with provider job tracking. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [gemini.ts](../examples/providers/gemini.ts) |
| MiniMax Task (custom) | Online (`token-api`) | `minimax/*` | `image/video` | No | Yes | REST + Task Polling | `minimax_task_adapter` | Async task submit/query with canonical forwarding. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [minimax.ts](../examples/providers/minimax.ts) |
| GLM Task (custom) | Online (`token-api`) | `glm/*` (video task) | `video` | No | Yes | REST + Task Polling | `glm_task_adapter` | Async video task with poll state updates. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [glm.ts](../examples/providers/glm.ts) |
| GLM Native (custom) | Online (`token-api`) | `glm/*` (native image/audio endpoints) | `image/tts/stt` | No | Yes | REST | `glm_native_adapter` | Native endpoint mapping for image/audio RPCs. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [glm.ts](../examples/providers/glm.ts) |
| Kimi Chat Multimodal (custom) | Online (`token-api`) | `kimi/*`, `moonshot/*` | `image` | No | Yes | REST | `kimi_chat_multimodal_adapter` | Image extraction from chat-multimodal response. | [media_job_methods_test.go](../../runtime/internal/services/ai/media_job_methods_test.go) | [kimi.ts](../examples/providers/kimi.ts) |

## 3. Demo Commands

### 3.1 Go Contract Demos

```bash
cd runtime
go test ./internal/services/ai -run TestLocalProviderNexaModalitiesAndFailCloseVideo -count=1
go test ./internal/services/ai -run TestCloudProviderLiteLLMAllModalities -count=1
go test ./internal/services/ai -run TestOpenAIBackendVideoFallbackPath -count=1
go test ./internal/services/ai -run TestOpenAIBackendVideoUnsupported -count=1
go test ./internal/services/ai -run TestSubmitMediaJobBytedanceOpenSpeechSTTWS -count=1
go test ./internal/services/ai -run TestSubmitMediaJobGeminiOperation -count=1
go test ./internal/services/ai -run TestSubmitMediaJobMiniMaxVideoTask -count=1
go test ./internal/services/ai -run TestSubmitMediaJobGLMVideoTask -count=1
go test ./internal/services/ai -run TestSubmitMediaJobKimiImageChatMultimodal -count=1
```

### 3.2 TypeScript Tutorial Demos

```bash
npx tsx docs/examples/providers/localai.ts
npx tsx docs/examples/providers/nexa.ts
npx tsx docs/examples/providers/litellm.ts
npx tsx docs/examples/providers/bytedance-openspeech.ts
npx tsx docs/examples/providers/gemini.ts
npx tsx docs/examples/providers/minimax.ts
npx tsx docs/examples/providers/glm.ts
npx tsx docs/examples/providers/kimi.ts
```

Each script header documents:

1. how to start runtime for that provider,
2. which `ENV` to set (`API_KEY`, model IDs, output path),
3. concrete AI consume actions (chat/image/video/tts/stt).

## 4. Live Smoke (Go)

```bash
cd runtime
NIMI_LIVE_LOCAL_BASE_URL=http://127.0.0.1:1234 \
NIMI_LIVE_LOCAL_MODEL_ID=localai/qwen2.5 \
go test ./internal/services/ai -run TestLiveSmokeLocalGenerateText -count=1 -v

NIMI_LIVE_LITELLM_BASE_URL=https://your-litellm-endpoint \
NIMI_LIVE_LITELLM_API_KEY=sk-xxx \
NIMI_LIVE_LITELLM_MODEL_ID=litellm/gpt-4o-mini \
go test ./internal/services/ai -run TestLiveSmokeLiteLLMGenerateText -count=1 -v
```
