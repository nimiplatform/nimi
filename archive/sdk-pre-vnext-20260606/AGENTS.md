# SDK AGENTS.md

## Scope
- Applies to `sdk/**`.
- SDK work starts only after runtime gates are green.

## Hard Boundaries
- Public surface is the single package `@nimiplatform/sdk`. Stable subpaths must be admitted in `.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml`; current package subpaths include `@nimiplatform/sdk/runtime`, `@nimiplatform/sdk/runtime/browser`, `@nimiplatform/sdk/runtime/agent-identity`, `@nimiplatform/sdk/realm`, `@nimiplatform/sdk/world`, `@nimiplatform/sdk/scope`, `@nimiplatform/sdk/scope/permission`, `@nimiplatform/sdk/app`, `@nimiplatform/sdk/platform-catalog`, `@nimiplatform/sdk/ai-provider`, `@nimiplatform/sdk/ai`, `@nimiplatform/sdk/ai-app`, and `@nimiplatform/sdk/types`.
- Do not add legacy split packages, private deep imports, or public `Parameters<T>` / `ReturnType<T>` facade signatures.
- Do not cross private `realm` and `runtime` boundaries.
- Generated code is read-only: `sdk/src/runtime/generated/**`, `sdk/src/realm/generated/**`.
- Preserve TypeScript rules: ESM with `.js` suffixes, strict typing, `zod.safeParse`, no production `console.log`.

## Retrieval Defaults
- Start in `sdk/src/runtime`, `sdk/src/realm`, `sdk/src/ai`, `sdk/src/ai-provider`, and matching `sdk/test/**`.
- Skip generated clients and packed artifacts unless the task is codegen or drift.

## Verification Commands
- Contract gates: `pnpm check:sdk-import-boundary`, `pnpm check:sdk-single-package-layout`, `pnpm check:sdk-public-naming`, `pnpm check:reason-code-constants`.
- Runtime alignment: `pnpm check:runtime-bridge-method-drift`, `pnpm check:live-provider-invariants`.
- Quality: `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`, `pnpm check:sdk-version-matrix`.
