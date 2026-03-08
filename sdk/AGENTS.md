# SDK AGENTS.md

## Scope
- Applies to `sdk/**`.
- SDK work starts only after runtime gates are green.

## Hard Boundaries
- Public surface is the single package `@nimiplatform/sdk` with stable subpaths such as `@nimiplatform/sdk/runtime`, `@nimiplatform/sdk/realm`, and `@nimiplatform/sdk/mod/*`.
- Do not add legacy split packages, private deep imports, or public `Parameters<T>` / `ReturnType<T>` facade signatures.
- Do not cross private `realm` and `runtime` boundaries.
- Generated code is read-only: `sdk/src/runtime/generated/**`, `sdk/src/realm/generated/**`.
- Preserve TypeScript rules: ESM with `.js` suffixes, strict typing, `zod.safeParse`, no production `console.log`.

## Retrieval Defaults
- Start in `sdk/src/runtime`, `sdk/src/realm`, `sdk/src/mod`, `sdk/src/ai-provider`, and matching `sdk/test/**`.
- Skip generated clients and packed artifacts unless the task is codegen or drift.

## Verification Commands
- Contract gates: `pnpm check:sdk-import-boundary`, `pnpm check:sdk-single-package-layout`, `pnpm check:sdk-public-naming`, `pnpm check:reason-code-constants`.
- Runtime alignment: `pnpm check:runtime-bridge-method-drift`, `pnpm check:live-provider-invariants`.
- Quality: `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`, `pnpm check:sdk-version-matrix`.
