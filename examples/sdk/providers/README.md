# Provider Demos

`examples/sdk/providers/*.ts` are demo files, not authority. They only show
flows that already have vNext SDK surfaces.

## First Clarify The Goal

If you only want to prove cloud generation works from the CLI, use the one-shot path:

```bash
nimi run "Hello from Nimi" --provider gemini
```

That path can prompt for a missing API key once, save it, and continue the same run. It does not require a daemon restart.

These provider scripts are different: they are SDK/provider tutorials. They assume credentials are configured on the runtime machine before the script runs.

## Runtime-Machine Setup

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

2. Run a single provider demo.

```bash
npx tsx examples/sdk/providers/deepseek-chat.ts
```

3. Verify output includes generated text and optional artifact save path.

## Scripts

| Script | Typical Usage | Minimum Prerequisites | Output Artifact |
|---|---|---|---|
| [deepseek-chat.ts](./deepseek-chat.ts) | cloud chat through vNext Runtime AI model | `NIMI_DEEPSEEK_API_KEY` | text |
| [bytedance-tts.ts](./bytedance-tts.ts) | cloud TTS through vNext generation feature | `NIMI_BYTEDANCE_API_KEY` | mp3 |

Older demos that depended on `createNimiAiProvider` were removed during the SDK
vNext hardcut. Re-add provider-specific demos only when they can be expressed
through admitted vNext SDK surfaces.

## Run

```bash
npx tsx examples/sdk/providers/deepseek-chat.ts
npx tsx examples/sdk/providers/bytedance-tts.ts
```
