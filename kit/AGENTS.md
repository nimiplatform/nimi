# AGENTS.md — nimi-kit
## Scope
- Applies to `kit/**`.
- `@nimiplatform/kit` is the single cross-app toolkit package.
- Modules: `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/shell/tauri` (Rust crate), `kit/shell/renderer`, `kit/features/chat`, `kit/features/avatar`, `kit/features/model-picker`, `kit/features/model-config`, `kit/features/generation`, `kit/features/commerce`.
## Hard Boundaries
- `ui` is the reusable kit projection of platform design authority; canonical design semantics remain under `.nimi/spec/platform/kernel/**`. `auth` and `kit/features/*` must not bypass admitted kit primitives or create parallel app-local design truth.
- Before building new app UI or interaction logic, inspect `kit/README.md`, the target module README, and `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml` to confirm whether a reusable kit surface already exists.
- `kit/core` must not import React, CSS, app code, or presentation modules.
- `kit/telemetry` must remain renderer-safe and must not import Node.js, Electron, or Tauri bridges.
- `kit/shell/tauri` is a Rust crate for shared Tauri host glue; it must not import JS/TS runtime code or app-local Rust.
- `kit/shell/renderer` is renderer shell glue; it must not contain app stores, navigation, UI rendering, or re-own auth/telemetry truth.
- `kit/core` runtime-capabilities sub-surface must be pure logic (runtime-safe + renderer-safe); no UI, CSS, or shell imports.
- `kit/features/*` must not import `apps/**`, `runtime/internal/**`, app aliases, `dataSync`, app stores, or navigation directly.
- `kit/features/avatar` is admitted only as the Desktop chat preview/viewport stage/media utility and reusable renderer helper surface. It is not the launched `apps/avatar` carrier surface, package activation surface, or backend authority. Launched Avatar backend authority remains `.nimi/spec/avatar/kernel/backend-branch-contract.md` with `live2d | vrm`; do not reintroduce `sprite2d`, `canvas2d`, or `video` into `AvatarBackendKind`.
- SDK typed services may only be bound from explicit `runtime` or `realm` feature surfaces.
- Runtime integrations must not bind realm clients; realm integrations must not bind runtime clients.
- Apps must consume shared kit functionality through `@nimiplatform/kit/*` and must not recreate the same baseline shell locally once the kit surface exists.
## Retrieval Defaults
- Start in `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/features/*`, `.nimi/spec/platform/kernel`, and `scripts/check-nimi-kit.mjs`.
- Skip generated output except for token/theme drift and generated platform docs.
## Verification Commands
- `pnpm --filter @nimiplatform/kit build && pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit && pnpm exec nimicoding validate-spec-governance --profile nimi --scope platform-consistency && pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope platform --check`
## Semver Discipline
- v0.1.0 is the initial public publish; the public surface is the 58 entries in `kit/package.json#exports` (54 wave-a inventory + 4 wave-b additions: `./ui/glass`, `./ui/motion`, `./ui/a11y`, `./core/sdk-contract`).
- The kit remains in a pre-1.0 iteration phase until an explicit 1.0.0 readiness decision is made.
- Every change to a public export MUST be classified before merge.
  - **Patch**: compatible fix only; no public API change and no observable behavior change for valid inputs.
  - **Minor**: new public export, type-signature widening (e.g. new optional prop, union-arm addition on input), new optional generic parameter, or breaking change during 0.x.
  - **Major**: reserved for an explicit 1.0.0 readiness decision, or for post-1.0 breaking changes such as export removal, export rename, type-signature narrowing, breaking behavior change, or observable re-exported SDK shape change.
- Every breaking 0.x minor MUST ship with a migration note in `kit/CHANGELOG.md` describing the before/after import or call shape.
- **Directional SDK alignment**: `@nimiplatform/kit` tracks `@nimiplatform/sdk` compatibility during the 0.x phase, but a kit 1.0.0 release is not automatic. When SDK reaches 1.0.0, kit must make an explicit 1.0.0 readiness decision.
- Experimental exports may break in a 0.x minor bump but MUST still document the change in `CHANGELOG.md`.
## Counting Vocabulary
When auditing SDK consumption or any cross-module coupling, keep three distinct counts:
- **importing-file count**: number of consumer files that contain at least one matching import. Counts files, not statements.
- **import-statement count**: number of `from '<target>'` statements across the codebase. Two imports from one file count as two.
- **export-statement count**: number of `export` declarations in a single re-export boundary file (e.g. `kit/core/src/sdk-contract.ts`).
Each count answers a different question. Do not conflate them: a wave-a inventory line saying "28 unique import sites" is import-statement count, not importing-file count.
## Cross-Feature Edges
Admitted one-way feature compositions for the v0.1.0 initial public surface:
- `chat → avatar`: chat consumes avatar headless surface from 2 importing files.
  - `kit/features/chat/src/types.ts:2` imports `AvatarPresentationProfile` from `@nimiplatform/kit/features/avatar/headless`.
  - `kit/features/chat/src/components/canonical-character-rail.tsx:8` imports `AvatarStage` and helpers from `@nimiplatform/kit/features/avatar`.
- `model-config → model-picker`: documented one-way composition for catalog binding reuse.
New cross-feature edges require explicit admission here; reverse edges (avatar → chat, model-picker → model-config) are forbidden.
## SDK Single-Boundary
All static imports from `@nimiplatform/sdk*` inside kit non-test code route through `kit/core/src/sdk-contract.ts`. The single admitted dynamic-import path (`kit/features/chat/src/runtime/orchestration.ts:199`) targets `@nimiplatform/kit/core/sdk-contract`. New SDK consumption inside kit MUST add a re-export to `sdk-contract.ts` rather than importing `@nimiplatform/sdk*` directly. App consumers remain free to import `@nimiplatform/sdk` directly.
