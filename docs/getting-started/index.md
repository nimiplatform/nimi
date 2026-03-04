# Getting Started

This guide gets you from zero to a first verifiable Nimi run.

## Prerequisites

- Go `1.24+`
- Node.js `24+`
- pnpm `10+`
- Install workspace dependencies once:

```bash
pnpm install
```

## Terminal Setup

Use two terminals:

- Terminal A: run `nimi-runtime`
- Terminal B: run health checks and SDK examples

## 1. Start Runtime (Terminal A)

```bash
pnpm runtime:serve
```

Default endpoints:

- gRPC: `127.0.0.1:46371`
- HTTP health: `127.0.0.1:46372`

## 2. Path A - Observe Platform State (No model required)

Run in Terminal B:

```bash
pnpm runtime:health
pnpm runtime:providers
npx tsx examples/sdk/sdk-quickstart.ts
```

Expected:

- runtime reports `READY`
- provider health snapshot is printed
- quickstart prints health and model inventory
- if no model is available yet, quickstart exits gracefully with next-step commands

## 3. Path B - Produce AI Output

Choose one route.

### Option 1: Local route (`local-runtime`)

```bash
cd runtime
go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json
cd ..
npx tsx examples/sdk/last-mile-route-switch.ts
```

### Option 2: Cloud route (`token-api`)

Restart runtime in Terminal A with provider credentials (example: Gemini):

```bash
cd runtime
NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=<your-key> \
go run ./cmd/nimi serve
```

Then run in Terminal B:

```bash
npx tsx examples/sdk/last-mile-route-switch.ts
```

Expected:

- output includes both `[local-runtime]` and `[token-api]` blocks
- each block shows generated text or explicit reason code and action hint

## 4. Common Errors and Exact Fixes

| Error | Meaning | Fix |
|---|---|---|
| `AI_LOCAL_MODEL_UNAVAILABLE` | local model not ready | `cd runtime && go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json` |
| `AI_REQUEST_CREDENTIAL_INVALID` | credentials missing/invalid in runtime process | export provider key in the runtime startup command and restart runtime |
| `AI_PROVIDER_AUTH_FAILED` | provider rejected auth | verify key, endpoint, and provider routing config (`pnpm runtime:providers`) |

## 5. Next Steps

- SDK integration: [App Developer](../guides/app-developer.md)
- Mod integration: [Mod Developer](../guides/mod-developer.md)
- Runtime integration: [Runtime Integrator](../guides/runtime-integrator.md)
- More recipes: [Quick Recipes](../cookbook/quick-recipes.md)

## Spec Pointers

- Spec index: [`spec/INDEX.md`](../../spec/INDEX.md)
- Human-readable generated spec: [`spec/generated/nimi-spec.md`](../../spec/generated/nimi-spec.md)
