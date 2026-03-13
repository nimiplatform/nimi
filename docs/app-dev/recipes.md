# Quick Recipes

These recipes map directly to the runnable examples shipped with Nimi.

Before running SDK recipes:

```bash
nimi start
```

Use `nimi serve` instead if you want the runtime in the foreground with direct logs.

Node.js is only needed when you execute the TypeScript example files directly.

## Core recipes

- SDK quick start: `examples/sdk/01-hello.ts`
- Streaming: `examples/sdk/02-streaming.ts`
- Local vs cloud switch: `examples/sdk/03-local-vs-cloud.ts`
- AI provider bridge: `examples/sdk/04-vercel-ai-sdk.ts`
- Multimodal runtime path: `examples/sdk/05-multimodal.ts`
- App auth lifecycle: `examples/sdk/advanced/app-auth.ts`
- Workflow DAG: `examples/sdk/advanced/workflow.ts`
- Knowledge indexing/search: `examples/sdk/advanced/knowledge.ts`
- Mod baseline (`createHookClient` + `createModRuntimeClient`): `examples/mods/mod-basic.ts`
- Runtime CLI path: `examples/runtime/cli-quickstart.sh`

`examples/sdk/05-multimodal.ts` is the fastest walkthrough for image generation and TTS on the same runtime surface.

![Nimi multimodal walkthrough](../assets/nimi-multimodal.gif)

## Run

```bash
npx tsx examples/sdk/01-hello.ts
nimi run "Hello from Nimi"
nimi run "Hello from Nimi" --provider gemini
```

## Compile check

```bash
pnpm --filter @nimiplatform/examples run check
```
