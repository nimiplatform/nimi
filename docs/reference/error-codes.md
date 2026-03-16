# Error Codes

Nimi surfaces structured errors using stable `reasonCode` values.

```ts
type NimiError = Error & {
  code: string
  reasonCode: string
  actionHint: string
  traceId: string
  retryable: boolean
  source: 'realm' | 'runtime' | 'sdk'
  details?: Record<string, unknown>
}
```

## Developer guidance

- Branch business logic by `reasonCode`, not by free-form message text.
- Persist and expose `traceId` in logs and support channels.
- Respect `retryable` for automatic retry policies.

## Source references

- Runtime reason code definitions: [`proto/runtime/v1/common.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/common.proto)
- SDK reason-code utilities: [`sdk/src/types/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdk/src/types/index.ts)
