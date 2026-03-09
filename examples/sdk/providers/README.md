# Provider Tutorials

`examples/sdk/providers/*.ts` are end-user tutorials (not mock tests).

## First Clarify The Goal

If you only want to prove cloud generation works from the CLI, use the one-shot path:

```bash
nimi run "Hello from Nimi" --provider gemini
```

That path can prompt for a missing API key once, save it, and continue the same run. It does not require a daemon restart.

These provider scripts are different: they are SDK/provider tutorials. They assume credentials are configured on the runtime machine before the script runs.

## Runtime-Machine Setup For Provider Tutorials

1. Configure one provider on the runtime machine (example: NimiLLM).

Reusable config path:

```bash
nimi provider set nimillm --api-key-env NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY --base-url https://your-nimillm-endpoint --default-model your-default-model --default
nimi start
```

If the runtime was already running when you changed provider config, restart it before running the tutorial script.

Env-only path:

```bash
NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL=https://your-nimillm-endpoint \
NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY=sk-xxx \
nimi serve
```

The env-only path is for foreground/runtime-process-local setup. Those variables must be present on the runtime process itself.

2. Run a single provider tutorial.

```bash
npx tsx examples/sdk/providers/nimillm.ts
```

3. Verify output includes generated text and optional artifact save path.

## Scripts

| Script | Typical Usage | Minimum Prerequisites | Output Artifact |
|---|---|---|---|
| [localai.ts](./localai.ts) | local text + image | `NIMI_RUNTIME_LOCAL_AI_BASE_URL` | text + png |
| [nexa.ts](./nexa.ts) | local text + tts + optional stt | `NIMI_RUNTIME_LOCAL_NEXA_BASE_URL` | text + mp3 (+ optional transcript) |
| [nimillm.ts](./nimillm.ts) | cloud text + embedding (+ optional image) | `NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY` | text + embedding (+ optional png) |
| [deepseek-chat.ts](./deepseek-chat.ts) | cloud chat (DeepSeek via OpenAI-compatible endpoint) | `NIMI_DEEPSEEK_API_KEY` | text |
| [bytedance-tts.ts](./bytedance-tts.ts) | cloud tts (Bytedance OpenSpeech only) | `NIMI_BYTEDANCE_API_KEY` | mp3 |
| [bytedance-openspeech.ts](./bytedance-openspeech.ts) | cloud tts + stt | `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY` | mp3 + transcript |
| [gemini.ts](./gemini.ts) | cloud image + video | `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY` | png + mp4 |
| [minimax.ts](./minimax.ts) | cloud image + video | `NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY` | png + mp4 |
| [glm.ts](./glm.ts) | cloud video + image + tts (+ optional stt) | `NIMI_RUNTIME_CLOUD_GLM_API_KEY` | mp4 + png + mp3 |
| [kimi.ts](./kimi.ts) | cloud chat-multimodal image | `NIMI_RUNTIME_CLOUD_KIMI_API_KEY` | text + png |

`deepseek-chat.ts` and `bytedance-tts.ts` intentionally use the raw `Runtime` client surface instead of the provider wrapper. The other tutorials use `createNimiAiProvider`.

## Run

```bash
npx tsx examples/sdk/providers/localai.ts
npx tsx examples/sdk/providers/nexa.ts
npx tsx examples/sdk/providers/nimillm.ts
npx tsx examples/sdk/providers/deepseek-chat.ts
npx tsx examples/sdk/providers/bytedance-tts.ts
npx tsx examples/sdk/providers/bytedance-openspeech.ts
npx tsx examples/sdk/providers/gemini.ts
npx tsx examples/sdk/providers/minimax.ts
npx tsx examples/sdk/providers/glm.ts
npx tsx examples/sdk/providers/kimi.ts
```
