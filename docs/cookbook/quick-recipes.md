# Quick Recipes

Runnable code lives in the repository root `examples/` package.

## Core recipes

- SDK quick start: `examples/sdk/sdk-quickstart.ts`
- AI inference: `examples/sdk/ai-inference.ts`
- Streaming: `examples/sdk/ai-streaming.ts`
- AI provider bridge: `examples/sdk/ai-provider.ts`
- App auth lifecycle: `examples/sdk/app-auth.ts`
- Workflow DAG: `examples/sdk/workflow-dag.ts`
- Mod baseline (`createHookClient` + `createModRuntimeClient`): `examples/mods/mod-basic.ts`
- Runtime CLI path: `examples/runtime/cli-quickstart.sh`

## Run

```bash
npx tsx examples/sdk/sdk-quickstart.ts
```

## Compile check

```bash
pnpm --filter @nimiplatform/examples run check
```
