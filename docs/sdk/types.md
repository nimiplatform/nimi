# Shared Types and Errors

`@nimiplatform/sdk/types` exports shared JSON, request metadata, error, reason-code, and retry utilities. Use the types exported by the public operation you call; this module is not a universal collection of domain identifiers.

## Current Exports

| Export | Use |
| --- | --- |
| `JsonPrimitive`, `JsonValue`, `JsonObject` | Typed JSON values |
| `NimiError`, `NimiErrorSource` | Error types with reason, action, trace, and retry metadata |
| `isNimiError`, `asNimiError`, `createNimiError` | Inspect, normalize, or construct SDK errors |
| `ReasonCode`, `ReasonCodeValue` | Shared reason constants and their type |
| `CoreMetadata`, `CoreUnaryRequest`, `CoreStreamRequest` | Low-level SDK request descriptions; not an alternative App access path |
| `RetryOptions`, `RetryEvent`, `RetryReasonKind` | Retry helper configuration and observations |
| `createNimiClientId`, `createNimiUlid` | Generate identifiers for their admitted caller-owned uses |

For a Nimi App, import `NimiLocalAppClient` from `@nimiplatform/sdk` and obtain the client through its generated Host binding. Import capability request/result types from their owning public SDK entry point. A type-only import does not require executing that module's transport code.

## Keep Identities in Their Owner Context

Many API identifiers are represented as strings; do not assume the compiler will reject every cross-domain mix-up. Keep each identifier with the result and operation that issued it. A Character reference is not a LocalAgent operation selector, and an artifact ID does not grant access.

Formal App Agent operations use the session-scoped `agentHandle` from the authorized reference listing. Do not invent or cast a raw LocalAgent ID into a handle. Runtime still validates the current account, App, session, target, and operation.

## Inspect a Typed Error

`NimiError` is a TypeScript type. Use `isNimiError` to narrow an unknown caught value:

```ts
import { isNimiError, type NimiError } from '@nimiplatform/sdk/types';

export function nimiFailureDetails(error: unknown): Pick<
  NimiError, 'message' | 'reasonCode' | 'actionHint' | 'retryable'
> | null {
  if (!isNimiError(error)) return null;
  return {
    message: error.message,
    reasonCode: error.reasonCode,
    actionHint: error.actionHint,
    retryable: error.retryable,
  };
}
```

This function is compiled as [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts). A `null` result means the value did not match the SDK error shape; preserve and handle the original failure through the App's normal error path. It does not mean the operation succeeded.

Use the returned reason and action hint to choose the next user action. The `retryable` field is not permission to replay a business operation after an uncertain external outcome. For Jobs, retain the original identity and follow [observation and recovery](/runtime/streaming).

## Source Basis

- [`sdks/typescript/types/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/index.ts)
- [`sdks/typescript/types/errors.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/errors.ts)
- [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
