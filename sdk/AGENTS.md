# SDK AGENTS.md

> Conventions for AI agents working on @nimiplatform/sdk (TypeScript).

## Context

The SDK is the unified developer interface for Nimi. It's a pnpm workspace containing multiple packages that provide access to realm (cloud) and runtime (local) capabilities.

## Package Structure

```
sdk/
├── packages/
│   ├── sdk/             @nimiplatform/sdk — Aggregated facade entry
│   ├── realm/           @nimiplatform/sdk/realm — Realm HTTP/WS client
│   ├── runtime/         @nimiplatform/sdk-runtime — Runtime transport client
│   ├── mod-sdk/         @nimiplatform/mod-sdk — Mod/hook SDK
│   ├── types/           @nimiplatform/sdk-types — Shared type surface (consumer import: @nimiplatform/sdk/types)
│   └── ai-provider/     @nimiplatform/ai-provider — Vercel AI SDK v6 provider
```

### Package Dependencies (Strict)

```
sdk         → realm, runtime, types
realm       → types (NEVER runtime)
runtime     → types (NEVER realm)
ai-provider → runtime, types (NEVER realm)
types       → nothing
```

## TypeScript Conventions

- **ESM only** — imports use `.js` extension even for `.ts` files
- **Zod** for runtime validation (`safeParse` pattern)
- **No `any`** in public API surface — all exports must have explicit types
- **No `console.log`** — use structured error types
- Types that cross package boundaries must live in `types/`
- Generated code (from OpenAPI/proto) is committed and CI-verified (zero-drift)

## Import Rules

**Allowed:**
```ts
import { ... } from '@nimiplatform/sdk';
import { ... } from '@nimiplatform/sdk/realm';
import { ... } from '@nimiplatform/sdk/runtime';
import { ... } from '@nimiplatform/sdk/types';
import { ... } from '@nimiplatform/ai-provider';
```

**Forbidden:**
```ts
import { ... } from '@nimiplatform/sdk/internal/...';
import { ... } from '@nimiplatform/sdk/generated/...';
import { ... } from '../../../some-deep-path';
```

## Error Types

All SDK errors use `NimiError`:

```ts
type NimiError = {
  reasonCode: string;   // e.g., 'AI_MODEL_NOT_FOUND'
  actionHint: string;   // e.g., 'pull_model_or_change_route'
  traceId: string;
  retryable: boolean;
  source: 'realm' | 'runtime' | 'sdk';
};
```

Never throw raw strings or unstructured errors from public API.

## AI Provider Pattern

`@nimiplatform/ai-provider` implements Vercel AI SDK v6 custom provider:

- `nimi('chat/default')` → `LanguageModelV3`
- `nimi.embedding('default')` → `EmbeddingModelV3`
- `nimi.image('default')` → `ImageModelV3`

Boundary: ai-provider handles single-model calls only. Multi-model DAG goes through `runtime.workflow.*`.

## Version Strategy

- **strict-only** — only current `1.x` line supported
- No cross-major/cross-minor version negotiation
- Experimental APIs in `@nimiplatform/sdk/experimental/*`, expire after 2 minor versions

## Error Handling Cross-Reference

All errors use `reasonCode` constants from `@nimiplatform/sdk/types`:

```ts
import { ReasonCode, isRetryableReasonCode } from '@nimiplatform/sdk/types';

// Use constants, not string literals
if (err.reasonCode === ReasonCode.AI_PROVIDER_TIMEOUT) { /* retry */ }

// Programmatic retryability check
if (isRetryableReasonCode(err.reasonCode)) { /* backoff */ }
```

Full error code dictionary: [`docs/error-codes.md`](../docs/error-codes.md).

## Request Validation Rules

SDK validates requests before sending to runtime:

| Rule | Where | Error |
|------|-------|-------|
| AI calls require explicit `routePolicy` | `runtime/src/core/client.ts` | `SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED` |
| Custom policy requires `ttlSeconds > 0` | `runtime/src/core/client.ts` | `SDK_RUNTIME_APP_AUTH_CUSTOM_TTL_REQUIRED` |
| Custom policy requires explicit `canDelegate` | `runtime/src/core/client.ts` | `SDK_RUNTIME_APP_AUTH_CUSTOM_DELEGATE_REQUIRED` |
| Protocol version must match (strict-only) | `sdk/src/client.ts` | `PROTOCOL_VERSION_MISMATCH` |
| `appId` is required | `sdk/src/client.ts` | Throws at creation time |

## Codegen

- `realm/` — Generated from OpenAPI spec (source in closed-source nimi-realm repo)
- `runtime/` — Generated from `.proto` files in `/proto/`
- After proto changes, regenerate and commit:
  ```bash
  buf generate
  ```
- CI runs regeneration and fails if diff is non-zero

### Proto Evolution Rules

- Never remove or renumber existing proto fields
- New fields must use the next available field number
- Use `reserved` to protect removed field numbers
- CI runs `buf breaking` against a committed baseline (`runtime/proto/runtime-v1.baseline.binpb`)
- Breaking changes require baseline update: `cd runtime && make proto-baseline`

## CI Gates

SDK code must pass these CI checks:

| Check | Command |
|-------|---------|
| Build all packages | `pnpm build:sdk` |
| Unit tests | `pnpm --filter @nimiplatform/sdk-runtime test` |
| Contract tests | `pnpm --filter @nimiplatform/sdk-runtime test:contract` |
| Facade tests | `pnpm --filter @nimiplatform/sdk test` |
| AI provider tests | `pnpm --filter @nimiplatform/ai-provider test` |
| Import boundary | `pnpm check:sdk-import-boundary` |
| Scope catalog drift | `pnpm check:scope-catalog-drift` |
| No legacy imports | `pnpm check:no-legacy-imports` |
| Runtime bridge drift | `pnpm check:runtime-bridge-method-drift` |

## Build & Test

```bash
cd sdk
pnpm install
pnpm build
pnpm test
```

## What NOT to Do

- Don't import across realm ↔ runtime boundary
- Don't put business logic in SDK — it's a client library
- Don't expose internal/generated paths in public exports
- Don't sign or validate tokens in SDK — that's runtime's job
- Don't use `Parameters<T>` or `ReturnType<T>` in public type signatures — declare types explicitly
- Don't add `console.log` for debugging — use `NimiError` with structured fields
- Don't bypass runtime client defaults for write calls without idempotency metadata
