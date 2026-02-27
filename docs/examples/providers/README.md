# Provider Tutorials

`docs/examples/providers/*.ts` are end-user tutorials (not mock tests).
Each script uses `new Runtime(...)` + `createNimiAiProvider(...)` to call real runtime AI APIs.

## Core Rule

Before running any script, start runtime and configure the corresponding provider env vars on the runtime process.

Example runtime start:

```bash
cd runtime
go run ./cmd/nimi serve
```

(Provider-specific `NIMI_RUNTIME_*` env vars are documented at the top of each script.)

## Scripts

| Script | Typical Usage |
|---|---|
| [localai.ts](./localai.ts) | local text + image |
| [nexa.ts](./nexa.ts) | local text + tts + optional stt |
| [litellm.ts](./litellm.ts) | cloud text + embedding (+ optional image) |
| [bytedance-openspeech.ts](./bytedance-openspeech.ts) | cloud tts + stt |
| [gemini.ts](./gemini.ts) | cloud image + video |
| [minimax.ts](./minimax.ts) | cloud image + video |
| [glm.ts](./glm.ts) | cloud video + image + tts (+ optional stt) |
| [kimi.ts](./kimi.ts) | cloud chat-multimodal image |

## Run

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
