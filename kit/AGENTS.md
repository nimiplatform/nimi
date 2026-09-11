# AGENTS.md - nimi-kit
## Scope
- Applies to `kit/**`; `@nimiplatform/kit` is the single cross-app toolkit package.
- Active modules plus admitted implementation-pending native boundary: `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/shell/protected-local`, `kit/shell/tauri`, `kit/shell/renderer`, `kit/shell/electron`, and `kit/features`.
## Hard Boundaries
- Kit UI is a reusable projection of `.nimi/spec/platform/ui-design-system.authority.yaml`; do not create app-local design truth in `kit/auth` or `kit/features`.
- Read `kit/README.md` and the target module README when choosing a public entrypoint or reusable owner; use the direct owner contract for the behavior being changed.
- `kit/core` must stay pure logic: no React, CSS, app code, or presentation imports.
- `kit/telemetry` must stay renderer-safe: no Node.js, Electron, or Tauri bridge imports.
- `kit/shell/tauri` is shared Rust host glue; do not import JS/TS runtime code or app-local Rust.
- `kit/shell/protected-local` is the single native protected Runtime carrier boundary. It carries typed calls but never owns OS service lifecycle, credentials, origin, listeners, config truth, binary selection, or app-child admission; do not expose it to renderer code.
- `kit/shell/renderer` is host-neutral renderer glue only; it must not own app stores, navigation, UI rendering, auth truth, telemetry truth, or host-specific Electron/Tauri implementation details.
- `kit/shell/electron` is Node/Electron main/preload host glue only. It may bind `@grpc/grpc-js` for public/binding-only Runtime proxying and consume `kit/shell/protected-local` for exact typed protected calls, but it must not be imported by renderer code, expose raw Electron/Node/protected material, proxy protected methods generically, or own Runtime lifecycle/config/custody.
- `kit/features/*` must not import `apps/**`, `runtime/internal/**`, app aliases, `dataSync`, app stores, or navigation directly.
- `kit/features/avatar` is the admitted reusable avatar surface. Backend-specific renderer seams such as VRM and Live2D own reusable renderer semantics only; launched Avatar product authority stays in `.nimi/spec/avatar/embodiment-surface.authority.yaml`, and app-specific placement/orchestration stays app-owned.
- SDK typed services may only bind from explicit `runtime` or `realm` feature surfaces; runtime integrations must not bind realm clients, realm integrations must not bind runtime clients, and apps consume toolkit functionality through `@nimiplatform/kit/*` once it exists.
- `kit/auth` keeps Web Account Auth and Desktop Browser Auth Gate as separate public contracts: the Web adapter may expose Realm credential interactions through the Realm-owned browser session, while the Desktop gate accepts only the OAuth code bridge and Runtime account browser broker and must not require credential methods or token persistence.
## Retrieval Defaults
- Start in the affected Kit module and its direct consumer or contract. Read canonical authority when semantics or ownership are unresolved; inspect the relevant checker when its failure or the changed projection requires it. Skip unrelated modules and generated output except when checking drift.
## Verification Commands
- For implementation changes, run the directly affected test and `pnpm --filter @nimiplatform/kit build`; `kit/ui/AGENTS.md` adds the checks for UI generator inputs.
- Run `pnpm --filter @nimiplatform/kit test` for shared behavior changes spanning multiple components. Run `pnpm check:nimi-kit` for public exports, package/import boundaries, shared projections, or Kit-wide changes.
- `pnpm check:nimi-kit` already includes `pnpm check:nimi-design-artifacts`; do not run the included check again while its result remains valid.
## Semver Discipline
- Public exports are governed by `kit/package.json`; classify every public export change before merge.
- Patch: compatible fixes only. Minor: new export, widening, or 0.x breaking change. Major: explicit 1.0.0 or post-1.0 breaking change.
- Every breaking 0.x minor needs a migration note in `kit/CHANGELOG.md`; experimental exports still need documented changes.
- `@nimiplatform/kit` tracks `@nimiplatform/sdk` compatibility during 0.x, but kit 1.0.0 requires an explicit readiness decision.
## Cross-Feature And SDK Edges
- Cross-feature imports require a concrete shared owner contract; keep feature composition app-local unless the reusable boundary is already established.
- Static `@nimiplatform/sdk*` imports in kit non-test code route through `kit/core/src/sdk-contract.ts`; exception: `kit/shell/electron/**` host glue may import SDK Runtime wire surfaces or dynamic `@grpc/grpc-js` for IPC-to-gRPC.
- The admitted dynamic SDK boundary is the chat app-AI runtime adapter importing `@nimiplatform/kit/core/sdk-contract`; new SDK consumption adds a re-export to `kit/core/src/sdk-contract.ts`.
