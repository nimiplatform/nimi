# App Developer Guide

Use this path if you are building a third-party app that consumes Nimi runtime, realm, or both.

## Integration model

- `Runtime` for local AI execution (gRPC)
- `Realm` for cloud state (REST + WebSocket)
- `@nimiplatform/sdk` as the only supported developer entry point
- `nimi-app create` from `@nimiplatform/dev-tools` as the author-side scaffold entry point

## Recommended flow

1. Start with [SDK Setup](./sdk-setup.md).
2. Scaffold a repo with `pnpm dlx @nimiplatform/dev-tools nimi-app create --dir my-nimi-app --template basic`.
3. Use [`examples/app-template`](https://github.com/nimiplatform/nimi/tree/main/examples/app-template) as the tracked minimal app shape.
4. Use `examples/sdk/01-hello.ts` as the smallest baseline.
5. Move to `examples/sdk/03-local-vs-cloud.ts` once you want both execution planes.
6. Adopt structured error handling using `reasonCode` and `traceId`.

## Scaffold once

```bash
pnpm dlx @nimiplatform/dev-tools nimi-app create --dir my-nimi-app --template basic
cd my-nimi-app
pnpm install
pnpm start
```

Available templates today:

- `basic`
- `vercel-ai`

If you are reading this inside the monorepo before public package publication, note that tracked templates use published semver package names. They are the reference output shape, not necessarily self-installing workspace packages yet.

## Recommended integration shape

Use the runtime as the operational boundary and keep provider keys in the runtime process, not spread through every app.

```ts
import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'What is Nimi?',
});

console.log(result.text);
```

Add `provider: 'gemini'` when you want the provider default cloud model:

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'What is Nimi?',
});
```

If you want a tracked example for the basic scaffold shape, see [`examples/app-template`](https://github.com/nimiplatform/nimi/tree/main/examples/app-template). If you want a provider-bridged example, see [`examples/sdk/04-vercel-ai-sdk.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/04-vercel-ai-sdk.ts).

## Production checklist

- Explicit timeout and fallback policy on AI calls when moving beyond first-run defaults
- Runtime/realm token lifecycle handling
- Error telemetry with `traceId`
- Version compatibility check before release

See [Compatibility Matrix](../reference/compatibility-matrix.md).
