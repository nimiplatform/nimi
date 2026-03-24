# Kit Contract — P-KIT-*

> Cross-app shared platform toolkit: foundation UI, feature modules, logic modules, and infra modules.

## P-KIT-001 — Kit Package Authority

- `@nimiplatform/nimi-kit` is the single authoritative package for cross-app shared platform infrastructure.
- Sub-modules are published through subpath exports on the single package: `/ui`, `/auth`, `/core/*`, `/telemetry/*`, and `/features/*`.
- Apps must not duplicate capabilities already covered by a kit sub-module in app-local code.

## P-KIT-002 — Kit Sub-Module Registry

- Every kit sub-module must be explicitly registered in `tables/nimi-kit-registry.yaml`.
- Registry rows must declare `subpath`, `kind` (`foundation`, `feature`, `logic`, `infra`), `dependencies`, `peer_dependencies`, `exports`, `admission_status`, and `owner`.
- New sub-modules must be registered before their first consumer import.

## P-KIT-003 — Kit Location and Boundary

- Kit source lives at `kit/` in the repository root, peer to `apps/`, `sdk/`, and `runtime/`.
- `kit/` is a single workspace package rooted at `kit/package.json`; sub-modules do not carry independent workspace package manifests.
- Kit sub-modules must not import app-layer code (`apps/**`).
- Kit sub-modules must not import runtime internal code (`runtime/internal/**`).
- Apps consume kit through `@nimiplatform/nimi-kit/<subpath>`.

## P-KIT-010 — UI Sub-Module (nimi-ui)

- `ui` is the foundation module for shared design tokens, primitives, themes, and generated visual contracts.
- All existing `P-DESIGN-*` rules remain in force for the UI sub-module.
- The token → primitive → generation → gate pipeline is unchanged.
- Consumer import path: `@nimiplatform/nimi-kit/ui`.
- Generation pipeline output: `kit/ui/src/generated/`.

## P-KIT-020 — Auth Sub-Module

- `auth` is a feature module and may contain components, hooks, logic, adapters, storage, and CSS within one bounded public surface.
- Auth components must consume `--nimi-*` CSS custom properties; no independent token system is permitted.
- Platform-specific logic must be injected through `AuthPlatformAdapter`; no direct Tauri/Electron imports.
- Scoped presentation themes (`data-shell-auth-theme`) may override `--nimi-*` variable values within `.nimi-shell-auth-root` but must not create a parallel global namespace.

## P-KIT-030 — Core Sub-Module

- `core` is a logic module for shared env, capability detection, and OAuth helpers.
- Core is a pure-logic utility library: zero UI dependencies, zero CSS imports, zero runtime rendering code.
- OAuth helpers must be parameterized on `TauriOAuthBridge`; no Tauri-specific imports.
- Shell mode detection must read injected environment values (`VITE_NIMI_SHELL_MODE`); no hardcoded app names.
- Zero runtime dependencies (TypeScript types and logic only).

## P-KIT-040 — Telemetry Sub-Module

- `telemetry` is an infra module for renderer-side telemetry and reusable error boundaries.
- Must be renderer-safe: no Tauri, Node.js, or Electron direct imports.
- Telemetry emitters must be structureless (accept caller-supplied payloads without imposing schema).
- Error boundary must be React-only and must not assume a specific app context.
- Only peer dependency on React is permitted.

## P-KIT-050 — Future Module Admission

- New shared capability modules are admitted to `nimi-kit` only when they are already reused by, or explicitly planned for, at least two apps.
- New modules must register their public surface before implementation lands.
- Registry entries must declare dependency direction against existing kit modules and external packages.
- New modules must add a dedicated hard gate or extend an existing gate before broad adoption.

## P-KIT-060 — Feature Module Topology

- `kit/features/*` is the product-capability layer for reusable Nimi AI surfaces.
- Feature modules are not restricted to pure UI components; they may contain `components`, `hooks`, headless logic, adapters, and styles inside one bounded module.
- Feature modules must not import app-layer code, app state stores, `dataSync`, or platform bridge implementations directly.
- Feature modules must remain portable across apps by consuming injected adapters only.

## P-KIT-070 — Headless and Default UI Surfaces

- Every feature module must expose both a headless surface and a default opinionated UI surface.
- Stable feature modules should publish explicit `/headless` and `/ui` subpath exports in addition to any aggregate module entry.
- Runtime-aware feature modules may additionally publish `/runtime` subpaths only when the integration binds `getPlatformClient().runtime` or runtime control-plane domains without app-layer stores or platform bridges.
- Realm-aware feature modules may publish `/realm` subpaths only when the integration binds `getPlatformClient().realm` without app-layer stores or platform bridges.
- Headless exports own state, filtering, submit protocols, and interaction contracts.
- UI exports may compose `ui` primitives and themes, but must not bypass headless contracts with app-local assumptions.
- Default UI surfaces should cover baseline styling and baseline interaction behavior so consuming apps do not need to rebuild the same shell.
- Runtime and realm are distinct first-party seams and must not be treated as interchangeable labels.

## P-KIT-080 — Adapter Injection Contract

- Every feature module must publish its adapter contract in the registry before adoption.
- Adapter contracts are the only allowed seam for app-specific data sources, mutations, and platform capabilities.
- First-party runtime-aware integrations may bind SDK typed services only from explicit `kit/features/*/runtime` subpaths.
- First-party realm-aware integrations may bind SDK typed services only from explicit `kit/features/*/realm` subpaths.
- `runtime` must not be used as a generic label for all first-party integrations. Local AI/runtime engine and realm business services are distinct seams.
- Feature modules must not import Tauri/Electron bridges, runtime internals, or SDK typed services directly when the same behavior can be injected through adapters.
- Feature module exports must make the adapter seam obvious through typed public interfaces.
- Registry metadata, package exports, and on-disk surface files must agree on whether a feature publishes `headless`, `ui`, `runtime`, and `realm`.

## P-KIT-090 — Kit Hard Gate

- `pnpm check:nimi-kit` is the hard gate for kit sub-module compliance.
- The gate must fail when:
  - a registered sub-module is missing from disk or an on-disk sub-module is unregistered
  - a package export is unregistered or a registered export is missing from `kit/package.json`
  - a registry row omits required governance metadata or declares unsupported `kind`
  - a module-level `README.md` is missing
  - a kit sub-module imports from `apps/**`
  - the core sub-module contains UI/CSS imports
  - the telemetry sub-module contains Tauri/Node.js imports
  - the auth sub-module defines CSS custom properties outside the `--nimi-*` namespace (except scoped overrides within `data-shell-auth-theme`)
  - a feature module omits required registry metadata for `surface_level`, `adapter_contract`, `headless_exports`, `ui_exports`, or `planned_consumers`
  - a feature module claims `runtime` or `realm` capability but does not publish the matching surface
  - a feature module publishes `runtime` while binding `getPlatformClient().realm`, or publishes `realm` while binding `getPlatformClient().runtime`
  - a feature module imports app aliases, SDK client packages, or platform bridge implementations directly

## Fact Sources

- `tables/nimi-kit-registry.yaml`
- `tables/rule-evidence.yaml`
