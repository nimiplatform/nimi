# Code Examples

Runnable TypeScript/Go examples for the current Nimi public APIs.

## TypeScript

| Example | Description |
|---------|-------------|
| [sdk-quickstart.ts](./sdk-quickstart.ts) | Initialize client, check runtime health, generate text |
| [ai-inference.ts](./ai-inference.ts) | Text, embedding, image/video/TTS/STT calls against runtime |
| [ai-streaming.ts](./ai-streaming.ts) | `streamGenerate` event handling (`payload.oneofKind`) |
| [ai-provider.ts](./ai-provider.ts) | Vercel AI SDK v6 integration via `@nimiplatform/sdk/ai-provider` |
| [providers/*.ts](./providers/README.md) | Provider tutorials for real runtime usage (`localai/nimillm/bytedance/gemini/minimax/glm/kimi`) |
| [app-auth.ts](./app-auth.ts) | ExternalPrincipal register/authorize/validate/delegate/revoke |
| [workflow-dag.ts](./workflow-dag.ts) | Workflow submit + event subscription with workflow-builder helpers |
| [mod-basic.ts](./mod-basic.ts) | Mod SDK V2 usage (`createHookClient`, `createAiClient`) |

## Go (CLI)

| Example | Description |
|---------|-------------|
| [cli-quickstart.sh](./cli-quickstart.sh) | Runtime CLI quick path from health check to app-auth |

## Prerequisites

- Runtime daemon running (`cd runtime && go run ./cmd/nimi serve`)
- SDK installed (`pnpm add @nimiplatform/sdk`)
- For AI provider examples: `pnpm add @nimiplatform/sdk/ai-provider ai`

## Running Examples

```bash
# Start runtime first
cd runtime && go run ./cmd/nimi serve

# In another terminal (repo root)
npx tsx docs/examples/sdk-quickstart.ts
```

Default gRPC endpoint used by examples: `127.0.0.1:46371`.

## CI Compile Gate

Examples are compile-checked via:

```bash
pnpm check:examples
```
