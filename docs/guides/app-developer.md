# App Developer Guide

Use this path if you are building a third-party app that consumes Nimi runtime, realm, or both.

## Integration model

- `Runtime` for local AI execution (gRPC)
- `Realm` for cloud state (REST + WebSocket)
- `@nimiplatform/sdk` as the only supported developer entry point

## Recommended flow

1. Start with [Getting Started](../getting-started/index.md).
2. Use `examples/sdk/01-hello.ts` as the smallest baseline.
3. Move to `examples/sdk/03-local-vs-cloud.ts` once you want both execution planes.
4. Adopt structured error handling using `reasonCode` and `traceId`.

## Recommended integration shape

Use the runtime as the operational boundary and keep provider keys in the runtime process, not spread through every app.

```ts
import { Runtime } from '@nimiplatform/sdk';

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

## Production checklist

- Explicit timeout and fallback policy on AI calls when moving beyond first-run defaults
- Runtime/realm token lifecycle handling
- Error telemetry with `traceId`
- Version compatibility check before release

See [Compatibility Matrix](../reference/compatibility-matrix.md).
