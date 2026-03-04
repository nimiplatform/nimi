# Provider Tutorials

`examples/sdk/providers/*.ts` are end-user tutorials (not mock tests).

> [!WARNING]
> Start runtime with provider environment variables on the same runtime process before running these scripts.
> If runtime starts without provider env vars, request routing will fail even if your shell has keys.

## Minimum Successful Path

1. Start runtime with one provider configured (example: NimiLLM).

```bash
cd runtime
NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL=https://your-nimillm-endpoint \
NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY=sk-xxx \
go run ./cmd/nimi serve
```

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
