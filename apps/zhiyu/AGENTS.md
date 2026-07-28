# Zhiyu App Instructions

## Scope
- `apps/zhiyu/**` is implementation, not product authority.
- Current Zhiyu product authority lives only in `.nimi/spec/zhiyu/local-partner-surface.authority.yaml`.

## Hard Boundaries
- Product-shape work derives from the Zhiyu authority, admitted config, and referenced upstream owners; local plans, code, tests, screenshots, closeouts, and evidence are not product authority.
- Zhiyu is the first-party bundled developer-only incubated local partner center. It is not the agent itself, not an AI model consumer, not a tester UI, and not a Runtime dashboard.
- Zhiyu must not create Realm character/persona or local partner authority. If no partner exists, product flow points users to Desktop/Realm-owned creation or management.
- Zhiyu consumes public Runtime/SDK/Kit/Realm/Cognition/Avatar projections and facades only. Do not add app-local auth, token custody, model routing, prompt assembly, agent loop, memory store, avatar carrier truth, or Runtime/private imports.
- Main product UI must remain user-facing and partner-centered. Diagnostics/dev mode may show technical truth, but it must not define the first screen.

## Retrieval Defaults
- Start with the affected Zhiyu route, its direct facade or projection, and the exact authority unit when semantics are involved.
- Do not load `.nimi/local/plans/zhiyu/**`, historical evidence, or unrelated platform owners unless the observed failure points there.

## Verification Commands
- Run the affected test and `pnpm --filter @nimiplatform/zhiyu typecheck`.
- Run `pnpm --filter @nimiplatform/zhiyu test` for app-wide behavior changes and `build` only when packaging or integration changes.
