# Provider Tutorials

`docs/examples/providers/*.ts` are end-user tutorials (not mock tests).
`deepseek-chat.ts` and `bytedance-tts.ts` are now single-file runtime examples:
1. save API key into app-managed connector storage
2. get `connectorId`
3. call runtime with `connectorId`-resolved request metadata (`keySource=inline`)

## Core Rule

Before running any script, start runtime and configure the corresponding provider env vars on the runtime process.

Example runtime start:

```bash
cd runtime
go run ./cmd/nimi serve
```

(Provider-specific runtime env vars are documented at the top of each script.)

## Scripts

| Script | Typical Usage |
|---|---|
| [localai.ts](./localai.ts) | local text + image |
| [nexa.ts](./nexa.ts) | local text + tts + optional stt |
| [nimillm.ts](./nimillm.ts) | cloud text + embedding (+ optional image) |
| [deepseek-chat.ts](./deepseek-chat.ts) | cloud chat (DeepSeek via OpenAI-compatible endpoint) |
| [bytedance-tts.ts](./bytedance-tts.ts) | cloud tts (Bytedance OpenSpeech only) |
| [bytedance-openspeech.ts](./bytedance-openspeech.ts) | cloud tts + stt |
| [gemini.ts](./gemini.ts) | cloud image + video |
| [minimax.ts](./minimax.ts) | cloud image + video |
| [glm.ts](./glm.ts) | cloud video + image + tts (+ optional stt) |
| [kimi.ts](./kimi.ts) | cloud chat-multimodal image |

## Run

```bash
npx tsx docs/examples/providers/localai.ts
npx tsx docs/examples/providers/nexa.ts
npx tsx docs/examples/providers/nimillm.ts
npx tsx docs/examples/providers/deepseek-chat.ts
npx tsx docs/examples/providers/bytedance-tts.ts
npx tsx docs/examples/providers/bytedance-openspeech.ts
npx tsx docs/examples/providers/gemini.ts
npx tsx docs/examples/providers/minimax.ts
npx tsx docs/examples/providers/glm.ts
npx tsx docs/examples/providers/kimi.ts
```
