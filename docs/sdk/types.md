# Shared Types and Errors

The `@nimiplatform/sdk/types` package exports shared JSON types, request metadata, standardized error classes, structured reason codes, and retry utilities.

Developers are encouraged to import types selectively according to the operations they invoke. This module provides foundational low-level primitives and error models rather than an exhaustive union of all domain entities.

## Current Exports

| Export | Role & Purpose |
| --- | --- |
| `JsonPrimitive`, `JsonValue`, `JsonObject` | Strongly-typed JSON structures |
| `NimiError`, `NimiErrorSource` | Standardized error interface and source union type with reason codes, action hints, trace IDs, and retry metadata |
| `isNimiError`, `asNimiError`, `createNimiError` | Type-guard helpers to inspect, normalize, or construct SDK errors |
| `ReasonCode`, `ReasonCodeValue` | Standard platform error reason constants and types |
| `CoreMetadata`, `CoreUnaryRequest`, `CoreStreamRequest` | Low-level transport descriptors and client communication contract shapes |
| `RetryOptions`, `RetryEvent`, `RetryReasonKind` | Configuration options and observation callbacks for retry policies |
| `createNimiClientId`, `createNimiUlid` | Helpers to generate standardized unique identifiers |

In a standard Nimi App, import `NimiLocalAppClient` from `@nimiplatform/sdk`. Type-only imports exist purely at compile-time and incur zero runtime transport overhead.

## Keeping Identifiers in Context

Many low-level platform identifiers are represented as strings. Developers should ensure identifiers remain coupled with the operations that issued them:
- A Character reference is not an Agent handle;
- An Artifact ID does not imply ambient read access;
- Official App agent operations require the session-scoped `agentHandle` returned by authorized listings; never manually construct or type-cast raw local agent IDs into handles. Runtime validates the current account, application identity, session lifecycle, and target permissions at execution time.

## Catching and Narrowing Typed Errors

`NimiError` provides rich diagnostic metadata. In catch blocks, use the `isNimiError` type guard to safely narrow unknown values:

```ts
import { isNimiError, type NimiError } from '@nimiplatform/sdk/types';

export function nimiFailureDetails(error: unknown): Pick<
  NimiError, 'message' | 'reasonCode' | 'actionHint' | 'retryable'
> | null {
  // 1. Narrow unknown catch value
  if (!isNimiError(error)) return null;

  // 2. Extract standard diagnostic properties
  return {
    message: error.message,
    reasonCode: error.reasonCode,
    actionHint: error.actionHint,
    retryable: error.retryable,
  };
}
```

Reference code is verified in [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts). A `null` return indicates that the thrown value does not conform to the `NimiError` shape; preserve the original error and handle it through the application's ordinary error pathways.

Use the returned `reasonCode` and `actionHint` to guide user recovery. Note that `retryable: true` is an operation-level hint indicating that a retry may be attempted; it does not authorize blind replay of non-idempotent operations when external outcomes are indeterminate. For asynchronous Jobs, preserve the original Job ID and verify actual outcomes before deciding to resubmit.

## Source Basis

- [`sdks/typescript/types/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/index.ts)
- [`sdks/typescript/types/errors.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/errors.ts)
- [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
