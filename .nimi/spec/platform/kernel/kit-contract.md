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
- Apps consume kit TypeScript surfaces through `@nimiplatform/nimi-kit/<subpath>`.
- `kit/shell/tauri/**` is an admitted non-npm Rust crate surface within the single kit authority. Apps consume it via Cargo path dependency, not npm import. It has no `package.json` exports and does not carry an independent workspace package manifest.

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

## P-KIT-041 — Tauri Shell Module

- `shell/tauri` is an infra module for shared Tauri host glue: runtime bridge, daemon lifecycle, session logging, auth/oauth commands, runtime defaults.
- Delivered as a Rust crate at `kit/shell/tauri/`, consumed by Tauri apps via Cargo path dependency.
- Must remain renderer-agnostic: pure Rust host/bridge logic, no JS/TS runtime code.
- Must not contain app-specific business logic, desktop-only menu bar/runtime-mod, or realm/runtime typed API truth.
- Shared `runtime_defaults` payload shape is owned here together with `shell/renderer`: canonical fields include `realmBaseUrl`, `jwksUrl`, `revocationUrl`, `jwtIssuer`, `jwtAudience`, and `connectorId`; retired `credentialRefId` must not remain emitted truth.
- Consumer Tauri apps that wire `nimi_kit_shell_tauri::runtime_defaults` must not retain an app-local `src-tauri/src/defaults.rs` duplicate for the same payload shape.
- D-IPC-* rules continue to govern IPC contract semantics; this module provides the shared implementation.
- App identity and session prefix must be parameterized; no hardcoded app branding in shared code.
- Generated runtime bridge method IDs must have a single source owner in this module.
- Build-time static assets (e.g., OAuth callback HTML template) may be consumed via admitted build inputs, not cross-layer `include_str!` from app paths.

## P-KIT-042 — Renderer Shell Module

- `shell/renderer` is an infra module for shared renderer shell glue: Tauri command wrappers, bridge primitives, and bootstrap skeleton.
- Delivered as subpath exports of the single `@nimiplatform/nimi-kit` package: `./shell/renderer/bridge` and `./shell/renderer/bootstrap`.
- Must not contain app-specific stores, navigation, UI rendering, or runtime readiness policy.
- Must not re-own auth session truth or telemetry normalization truth already owned by `kit/auth` (domain/auth) and `kit/telemetry` (domain/telemetry).
- Shared `parseRuntimeDefaults()` semantics are owned here: missing required realm defaults must fail closed instead of normalizing to empty strings, and consumer apps must not fork a parallel parser contract.
- Bootstrap skeleton provides shared orchestration hooks; app-local code retains runtime readiness, daemon policy, and local data bootstrap.
- Desktop and overtone retain local facade directories for app-specific bridge modules; shared core primitives come from this module.
- Web-specific UI adapter components (`.web.tsx`) must not be placed in this module.

## P-KIT-043 — Runtime Capabilities Module

- `core/runtime-capabilities` is a logic sub-surface for pure-logic capability normalization, wildcard matching, and codegen capability catalog truth.
- Must be runtime-safe and renderer-safe: zero UI, CSS, app code, or shell-specific imports.
- May be consumed by runtime-side code (Go consumers via shared contract) in addition to renderer consumers.
- Must not be stranded in any single app's runtime directory; this is the single shared truth for capability semantics.
- Replaces desktop-local `capabilities.ts` and `capability-catalog.ts` as the canonical owner.

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

## P-KIT-065 — Kit-First Reuse Protocol

- Before adding or refactoring app-local UI or interaction logic, implementers must inspect `kit/ui`, `kit/auth`, relevant `kit/features/*` READMEs, and `tables/nimi-kit-registry.yaml`.
- If an existing kit surface covers the baseline styling and baseline interaction behavior for most of the need, apps must extend or compose that kit surface instead of recreating a parallel app-local shell.
- App-local implementation is permitted only when no matching kit surface exists, or when the remaining requirement is clearly app-specific.
- New app-local shells that are likely reusable across at least two apps must be treated as future kit admission candidates and documented as such before they become entrenched app-local patterns.

## P-KIT-070 — Headless and Default UI Surfaces

- Every feature module must expose both a headless surface and a default opinionated UI surface.
- Stable feature modules should publish explicit `/headless` and `/ui` subpath exports in addition to any aggregate module entry.
- Runtime-aware feature modules may additionally publish `/runtime` subpaths only when the integration binds `getPlatformClient().runtime` or runtime control-plane domains without app-layer stores or platform bridges.
- Realm-aware feature modules may publish `/realm` subpaths only when the integration binds `getPlatformClient().realm` without app-layer stores or platform bridges.
- Headless exports own state, filtering, submit protocols, and interaction contracts.
- UI exports may compose `ui` primitives and themes, but must not bypass headless contracts with app-local assumptions.
- Default UI surfaces should cover baseline styling and baseline interaction behavior so consuming apps do not need to rebuild the same shell.
- Runtime and realm are distinct first-party seams and must not be treated as interchangeable labels.

## P-KIT-071 — Avatar Feature Module

- `kit/features/avatar` is the admitted reusable avatar surface for agent presentation in Nimi apps.
- It must publish aggregate, `/headless`, `/ui`, and `/runtime` surfaces on the single `@nimiplatform/nimi-kit` package.
- It may additionally publish backend-specific optional renderer surfaces such as `/vrm` and future `/live2d` surfaces when those surfaces preserve the same avatar semantic contracts and do not force heavyweight renderer/runtime assumptions into the default `ui` surface.
- `headless` owns normalized avatar presentation inputs, transient interaction-state contracts, and reusable controller logic.
- `ui` owns the default opinionated avatar stage shell that consuming apps may place without rebuilding a parallel baseline renderer shell.
- `runtime` may bind `getPlatformClient().runtime` only for runtime-owned persistent agent presentation projection; it must not absorb app stores, platform bridges, or renderer-local transient state ownership.
- Optional backend-specific renderer surfaces must remain renderer-implementation seams only; they must not re-own persistent presentation truth, transient interaction truth, or app-specific placement policy.
- `kit/features/chat` and app-local shells may consume `kit/features/avatar`, but they must not re-own avatar semantics or create a parallel chat-private avatar contract.

## P-KIT-072 — Avatar Ownership Hardcut

- `kit/features/avatar` consumes runtime-owned persistent `AgentPresentationProfile` truth and app-owned / desktop-owned transient `AvatarInteractionState`; it does not own either canonical layer.
- The module must not own canonical agent identity, canonical memory, voice workflow truth, voice asset truth, thread continuity truth, or app-specific permission policy.
- The module must not import app stores, Tauri/Electron bridges, or runtime internal code directly.
- Surface-specific placement, permissions, and orchestration remain app-owned; avatar renderer semantics remain reusable kit-owned.
- Runtime-aware avatar helpers must fail closed when required presentation profile fields are absent or unresolved; they must not invent fallback avatar assets, provider voices, or surface-local pseudo-success truth.

## P-KIT-073 — Desktop Local Avatar Binding Consumer Boundary

`kit/features/avatar` may consume desktop-local bound presentation results, but it does
not own desktop avatar import, storage, registry, or per-agent binding semantics.

Fixed rules:

- kit avatar surfaces may render a desktop-local override that has already been resolved
  by desktop-local authority, but they must not become the canonical home for how local
  VRM or Live2D files are imported, stored, or attached to an agent
- backend-specific optional surfaces such as `/vrm` remain renderer seams only; admitting
  future Live2D rendering does not by itself admit desktop-local storage or import truth
- kit must not require consumers to point directly at Downloads paths or arbitrary local
  files as persistent product truth; any local-file override must arrive as an already
  resolved consumer input

## P-KIT-073a — Live2D Backend Admission Posture

`kit/features/avatar` admits Live2D as part of the reusable avatar backend family, while
keeping the first shipped viewport implementation desktop-local.

Fixed rules:

- the admitted reusable kit truth is the backend seam and semantic consume boundary, not
  a requirement that the first concrete Live2D viewport ship from kit immediately
- a desktop app may ship the first concrete Live2D viewport locally while still consuming
  the same `kit/features/avatar` stage semantics and normalized presentation inputs
- Live2D backend admission here does not widen kit into owner of desktop-local fallback
  policy, local runtime packaging, or desktop-only viewport lifecycle
- a future exported `/live2d` surface must be registered and shipped explicitly before
  consumers may treat it as an available package export; this rule admits the backend
  family now without fabricating a shipped export
- first-wave Live2D admission is bounded to avatar-stage rendering semantics; pointer
  interaction parity, camera choreography, authoring flows, and backend-specific model
  inspection behavior remain deferred unless later admitted explicitly

## P-KIT-074 — Desktop Pointer Interaction Consumer Boundary

`kit/features/avatar` may consume desktop-resolved app-attention inputs for an active
avatar surface, but it does not own desktop-local attention intake or attention-truth
authority.

Fixed rules:

- kit avatar surfaces may consume already-resolved attention targets,
  continuous presence, and bounded app-attention-follow inputs, but they must
  not become the canonical home for DOM pointer capture, app viewport
  measurement, or desktop attention smoothing / clamp policy
- backend-specific optional surfaces such as `/vrm` remain renderer seams only;
  they must not become the semantic owner of attention interaction truth,
  speaking-vs-attention precedence, or surface stop-line policy
- reusable kit contracts may expose admitted interaction-state fields needed by
  consumers, but raw attention intake lifecycle ownership remains with the
  consuming desktop shell unless a later platform authority explicitly widens
  that boundary

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
  - a feature registry row omits `reuse_entrypoints`, or a listed reuse entrypoint does not exist in `kit/package.json`
  - a module-level `README.md` is missing
  - a feature `README.md` omits the kit-first reuse guidance section for local implementation decisions
  - a kit sub-module imports from `apps/**`
  - the core sub-module contains UI/CSS imports
  - the telemetry sub-module contains Tauri/Node.js imports
  - the `shell/renderer` sub-module contains app-specific stores, navigation, or UI rendering
  - the `shell/renderer` sub-module re-owns auth session truth or telemetry normalization truth
  - the `core/runtime-capabilities` sub-module contains UI, CSS, or shell-specific imports
  - the auth sub-module defines CSS custom properties outside the `--nimi-*` namespace (except scoped overrides within `data-shell-auth-theme`)
  - a feature module omits required registry metadata for `surface_level`, `adapter_contract`, `headless_exports`, `ui_exports`, or `planned_consumers`
  - a feature module claims `runtime` or `realm` capability but does not publish the matching surface
  - a feature module publishes `runtime` while binding `getPlatformClient().realm`, or publishes `realm` while binding `getPlatformClient().runtime`
  - a feature module imports app aliases, SDK client packages, or platform bridge implementations directly

## Fact Sources

- `tables/nimi-kit-registry.yaml`
- `tables/rule-evidence.yaml`
