# App Developer Guide

Use this path if you are building a third-party app that consumes Nimi runtime, realm, or both.

## Integration model

- `Runtime` for local AI execution (gRPC)
- `Realm` for cloud state (REST + WebSocket)
- `@nimiplatform/sdk` as the only supported developer entry point

## Recommended flow

1. Start with [Getting Started](../getting-started/index.md).
2. Use `examples/sdk/sdk-quickstart.ts` as baseline.
3. Add route policy explicitly for AI calls (`local` or `cloud`).
4. Adopt structured error handling using `reasonCode` and `traceId`.

## Production checklist

- Explicit timeout and fallback policy on AI calls
- Runtime/realm token lifecycle handling
- Error telemetry with `traceId`
- Version compatibility check before release

See [Compatibility Matrix](../reference/compatibility-matrix.md).
