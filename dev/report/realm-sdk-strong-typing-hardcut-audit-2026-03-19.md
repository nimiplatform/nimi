# Realm SDK Strong Typing Hardcut Audit (2026-03-19)

## Status
- Completed.
- Scope: `sdk` first, then affected app consumers in `apps/desktop`, `apps/forge`, `apps/overtone`, `apps/realm-drift`, and `apps/relay`.
- Runtime/auth transport semantics were kept unchanged. The refactor only changed code generation, type projection, public surface, typed adapter boundaries, and consuming code.

## Initial Findings
- The generated Realm SDK contained hundreds of DTO/model definitions under `sdk/src/realm/generated/models`, but `realm.services.*` did not expose their request/response types.
- The direct root cause was a destructive generator post-processing step that replaced the OpenAPI `operations` interface with `[key: string]: unknown`.
- The top-level `@nimiplatform/sdk/realm` facade also re-exported a very large flat DTO surface, which made the public API unstable and encouraged direct schema-name coupling.
- App consumers compensated with `as Record<string, unknown>` and endpoint-specific incorrect DTO assertions.
- One backend OpenAPI source issue also existed: duplicate `operationId` values, which made a direct `operations[operationId]` typing strategy unsafe without normalization.

## Final Architecture

### 1. Strong type source of truth
- `sdk/src/realm/generated/schema.ts` remains the type authority.
- `operations` is preserved with concrete operation entries.
- Service request/response typing now binds through normalized unique `operationId` values instead of path/method backtracking.

### 2. Stable public type helpers
- Added generated helpers:
  - `RealmModels`
  - `RealmModelName`
  - `RealmModel<Name>`
  - `RealmOperations`
  - `RealmOperationName`
  - `RealmOperation<Name>`
  - `RealmServiceName`
  - `RealmServiceMethod<S>`
  - `RealmServiceArgs<S, M>`
  - `RealmServiceResult<S, M>`
- These helpers are the intended public type entrypoints instead of flat DTO exports.

### 3. Facade hardcut
- `@nimiplatform/sdk/realm` top-level surface now exports:
  - `Realm`
  - client/auth/public types from `client-types`
  - runtime value enums
  - selected typed adapters only
  - generated type helpers above
- Flat DTO type exports were removed from the public facade.

### 4. Typed adapter boundary cleanup
- `agent-memory` remains a public typed adapter because it covers a real OpenAPI/query gap.
- `account-data` remains a public typed adapter because it exposes normalized task semantics not yet covered by the OpenAPI contract.
- `sendAgentChannelMessage` was removed from the public SDK surface and relocated to the relay app as a local explicit spec-gap adapter.

## Implemented Changes

### Generator and codegen
- Removed the destructive `operations` normalization from the Realm SDK generation path.
- Added pre-codegen OpenAPI normalization for duplicate `operationId` values.
- Preserved original operation names for generated service method names while using normalized unique operation IDs for type binding.
- Added generation for:
  - `sdk/src/realm/generated/type-helpers.ts`
  - `sdk/src/realm/generated/model-map.ts`
- Updated service registry typing so 2xx success responses are inferred correctly from operation definitions.

### Public facade
- Regenerated `sdk/src/realm/index.ts` to export only the reduced, intentional public surface.
- Removed the dead SDK-local extension file `sdk/src/realm/extensions/agent-channel-chat.ts`.

### Consumer migration
- Replaced app-side `realm.services.*(...) as Record<string, unknown>` patterns on the main Realm integration paths.
- Replaced top-level DTO imports from `@nimiplatform/sdk/realm` with:
  - `RealmServiceResult<...>` / `RealmServiceArgs<...>` for endpoint-bound shapes
  - `RealmModel<'...'>` for shared schema shapes
- Corrected `getMe()` consumers to use the actual `UserPrivateDto`-backed type path instead of `UserProfileDto`.
- Moved relay agent-channel posting to `apps/relay/src/main/realm-agent-channel.ts`.

## Key Files
- `scripts/generate-realm-sdk.mjs`
- `scripts/realm-sdk/spec-normalization.mjs`
- `scripts/realm-sdk/render-service-registry-types.mjs`
- `scripts/realm-sdk/render-type-helpers-file.mjs`
- `scripts/realm-sdk/generate-models.mjs`
- `scripts/realm-sdk/generate-realm-facade.mjs`
- `sdk/src/realm/generated/service-registry.ts`
- `sdk/src/realm/generated/type-helpers.ts`
- `sdk/src/realm/generated/model-map.ts`
- `sdk/src/realm/index.ts`
- `apps/relay/src/main/realm-agent-channel.ts`

## Validation Evidence
- `pnpm exec node scripts/generate-realm-sdk.mjs`
- `pnpm --filter @nimiplatform/sdk test`
- `pnpm check:sdk-coverage`
- `pnpm check:sdk-consumer-smoke`
- `pnpm check:sdk-import-boundary`
- `pnpm check:sdk-public-naming`
- `pnpm check:sdk-single-package-layout`
- `pnpm check:no-app-realm-rest-bypass`
- `pnpm --filter @nimiplatform/desktop typecheck`
- `pnpm --filter @nimiplatform/desktop run test:unit:rest`
- `pnpm --filter @nimiplatform/desktop test`

## Post-Refactor Assertions
- `realm.services.*` now carries concrete request/response types from the OpenAPI operation graph.
- Top-level `@nimiplatform/sdk/realm` no longer exposes DTO-name sprawl.
- Relay-only raw REST usage is isolated behind an explicit local adapter and allowlisted in the bypass check.
- The repository no longer contains top-level `@nimiplatform/sdk/realm` imports of named `*Dto` types.
- The repository no longer relies on the public SDK export `sendAgentChannelMessage`.

## Residual Risk
- The OpenAPI source still contains duplicate operation IDs upstream. The SDK generator now normalizes them safely, but the upstream spec should still be cleaned to remove the normalization requirement.
- Generated per-model files still exist as build artifacts because runtime enums are sourced from them, but they are no longer the intended public type surface.

## Maintenance Rule
- Future Realm SDK work should preserve this rule: runtime values may be exported by generated model files, but TypeScript schema truth must flow from `schema.ts` through generated helpers and service registry typing, not through facade-level flat DTO exports.
