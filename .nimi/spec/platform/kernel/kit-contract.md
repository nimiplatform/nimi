# Kit Contract — P-KIT-*

> Cross-app shared platform toolkit: foundation UI, feature modules, logic modules, and infra modules.

## P-KIT-001 — Kit Package Authority

- `@nimiplatform/kit` is the single authoritative package for cross-app shared platform infrastructure.
- Sub-modules are published through subpath exports on the single package: `/ui`, `/auth`, `/core/*`, `/telemetry/*`, `/features/*`, `/shell/capabilities`, `/shell/renderer/*`, and `/shell/electron/*`.
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
- Apps consume kit TypeScript surfaces through `@nimiplatform/kit/<subpath>`.
- `kit/shell/capabilities/**` is the admitted standard shell contract surface within the single kit authority. Tauri, Electron, renderer bridge code, and acceptance gates consume capability ids, command names, and standard errors from this surface.
- `kit/shell/tauri/**` is an admitted non-npm Rust crate surface within the single kit authority. Apps consume it via Cargo path dependency, not npm import. It has no `package.json` exports and does not carry an independent workspace package manifest.
- `kit/shell/electron/**` is an admitted npm TypeScript surface within the single kit authority. Apps consume it through `@nimiplatform/kit/shell/electron/*` subpath exports from Electron main/preload code, not from renderer application code.

## P-KIT-010 — UI Sub-Module (nimi-ui)

- `ui` is the foundation module for shared design tokens, primitives, themes, and generated visual contracts.
- All existing `P-DESIGN-*` rules remain in force for the UI sub-module.
- The token → primitive → generation → gate pipeline is unchanged.
- Consumer import path: `@nimiplatform/kit/ui`.
- Generation pipeline output: `kit/ui/src/generated/`.
- `ui` owns reusable primitive families and default visual behavior only. It
  must not absorb app product composition, information architecture, route
  placement, data schemas, or app-local consumption inventories.
- UI reference-card taxonomy may identify missing primitive families, but a
  missing family is only a gap-audit item until `tables/nimi-ui-primitives.yaml`,
  `kit/ui` implementation, tests, and generated docs are updated together.

## P-KIT-020 — Auth Sub-Module

- `auth` is a feature module and may contain components, hooks, logic, adapters, storage, and CSS within one bounded public surface.
- Auth components must consume `--nimi-*` CSS custom properties; no independent token system is permitted.
- Platform-specific logic must be injected through `AuthPlatformAdapter`; no direct Tauri/Electron imports.
- Scoped presentation themes (`data-shell-auth-theme`) may override `--nimi-*` variable values within `.nimi-shell-auth-root` but must not create a parallel global namespace.

## P-KIT-030 — Core Sub-Module

- `core` is a logic module for shared env, capability detection, OAuth helpers, and Desktop Open Intent pure helpers.
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

## P-KIT-041 — Native Protected Carrier And Tauri Shell Modules

- `shell/protected-local` is the single shared native host contract for
  protected Runtime mutual endpoint/process/executable verification, the empty
  `OpenDesktopSession` bootstrap, and typed fixed-service
  `status/start/restart`. Kit carries typed calls only; Runtime/OS own endpoint,
  origin, custody, service lifecycle and security truth. Product stop, binary /
  service/path selection, generic config JSON and bearer privilege are absent.
  The A.1 Windows child carrier is host-only and cannot be exported to renderer
  or npm surfaces.
- `shell/tauri` is an infra module that consumes `shell/protected-local` and
  implements app-agnostic Tauri shell capabilities. It must not implement a
  parallel daemon manager, stage/execute Runtime, own credentials, exchange
  OAuth tokens, inject Realm endpoints, or expose protected generic gRPC IPC.
- Authority id and source location are `kit.shell.tauri` at `kit/shell/tauri/`.
- Public standalone delivery crate name is `nimi-shell-tauri`; standalone
  generated apps depend on the published crate only after scaffolding shell
  package API and publication mechanics are admitted.
- `platform_catalog` modules under this crate are generated read-only projections of Platform catalog tables. They are consumer surfaces, not canonical catalog truth, and must not write app-local admission rows.
- Workspace generated apps consume the same crate surface by Cargo path dependency.
- The crate must expose standard capability modules through `nimi_shell_tauri::capabilities::*`; consumer apps must not import shared capability implementations through old top-level Tauri module paths.
- Must remain renderer-agnostic: pure Rust host/bridge logic, no JS/TS runtime code.
- Must not contain app-specific business logic, single-consumer menu bar logic,
  or realm/runtime typed API truth.
- Shared `runtime_defaults` payload shape is owned by `shell/capabilities` and
  contains only non-security shell hints. Realm/JWKS/revocation endpoints,
  tokens, account/subject, provider/model/connector/local endpoint truth,
  service/listener identity, executable selector and config paths are forbidden.
- Consumer Tauri apps that wire `nimi_shell_tauri::runtime_defaults` must not retain an app-local src-tauri defaults module duplicate for the same payload shape.
- D-IPC-* rules continue to govern IPC contract semantics; this module provides the shared implementation.
- App identity and session prefix must be parameterized; no hardcoded app branding in shared code.
- Generated runtime bridge method IDs must have a single source owner in the standard shell capability catalog or Runtime/SDK generated bridge tables; Tauri must not define parallel command truth.
- Build-time static assets (e.g., OAuth callback HTML template) may be consumed via admitted build inputs, not cross-layer `include_str!` from app paths.

## P-KIT-041C - Standard Shell Capabilities Module

- `shell/capabilities` is the standard contract surface for Nimi shell hosts. It owns standard capability ids, operation ids, command names, operation-level negative states, and the standard shell error envelope.
- Active machine authority is `tables/standard-shell-capabilities.yaml`. Topic documents, acceptance matrices, and gates may consume or validate this table but must not become parallel truth.
- Delivered as the `@nimiplatform/kit/shell/capabilities` package export for TypeScript consumers and mirrored into Rust host adapters through `nimi_shell_tauri::capabilities`.
- Nimi ecosystem capabilities are standard, not optional: binding-only/runtime
  ordinary transport, typed Runtime service status/start/restart, non-security
  runtime defaults, native browser/callback observation, shell UI, diagnostics, data, storage,
  config, local assets, local agent, AI Profile, AI Config, avatar,
  agent-center, platform projection, file dialog, file reveal, export,
  artifacts, and floating window must be represented in this catalog. Shared
  auth is carried by `runtime.unary` / `runtime.streamOpen` to
  RuntimeAccountService; app-readable/app-writable `auth.session*` is not an
  active product capability and must not appear in the standard catalog.
- Standard `data.pathResolve` and `storage.*` operations resolve under a
  host-owned app data root. Renderer payloads must not carry absolute storage
  roots; they may carry only `{ relativePath }` or `{ relativePath, value }`.
  Hosts obtain the root from Runtime `GetAppStorage(app_id)` or a
  Runtime-attested launch projection.
- `storage.removeJson` is an idempotent app-storage lifecycle primitive. If
  the file exists the host removes it; if it is already absent the operation
  still succeeds. The result shape is `{ path, removed }`.
- Standard host failures must use the envelope fields `code`, `reasonCode`, `actionHint`, `source`, and optional `details`. Browser/no-host fallbacks, raw `file://` conversion escape hatches, and silent no-op behavior are not standard shell behavior.
- Standard `agent-center.*` operations own host-local Agent Center asset byte custody only: avatar/background import, validation, preview material resolution, Live2D adapter sidecar association, and scoped resource removal. They must not expose `configGet` or `configSet`, persist selection truth, decide Avatar readiness, return raw filesystem paths, or materialize runtime launch payload truth.
- `renderer_entry_probe` is a diagnostics capability. Generic `runtime_account_caller`/trusted caller metadata belongs to the local-agent standard capability; Desktop-specific caller policy remains product-owned and must not be promoted into the standard catalog.
- Tauri and Electron host adapters must implement the same capability ids and shared error envelope. Gaps must fail closed with catalogued standard error codes instead of returning pseudo-success.
- `runtime-lifecycle.stop` does not exist. Lifecycle payloads cannot contain a
  service name, binary path, argv, endpoint, config path or trust-record path.
  Generic runtime unary/stream commands reject every protected method; those
  require `shell/protected-local`.

## P-KIT-041F - Standard Shell File & Window Capabilities

- The standard catalog additionally owns file-dialog (OS open dialogs),
  file-reveal (reveal a host-validated path in the OS file manager), export
  (user-facing file export writes), artifacts (binary artifact writes under the
  app data root), and floating-window (companion-window control for
  transparent floating embodiment surfaces). Apps must consume these standard
  operations instead of registering parallel app-local shell commands for the
  same semantics.
- `file-dialog.open` returns host-selected absolute paths; the host validates
  and registers returned paths for subsequent read access. Renderer-supplied
  absolute paths remain forbidden inputs.
- `file-reveal.reveal` accepts only paths inside the host-owned app data root,
  admitted local asset roots, or paths previously returned by host file
  selection; anything else fails closed as `invalid-path`.
- `export.saveFile` writes renderer-supplied `dataBase64` bytes into the
  host-owned export directory with sanitized, collision-free naming. Empty or
  undecodable payloads fail closed as `invalid-payload`.
- `artifacts.write` writes binary artifacts only under the `artifacts/`
  subtree of the host-owned app data root with
  `{ relativePath, mimeType?, dataBase64 }`; subtree escape fails closed as
  `invalid-path`. Written artifact paths are eligible inputs to
  `local-assets.resolveUrl`.
- `floating-window.*` operations act on the invoking window only.
  `beginManualDrag` is manual-only: it returns the current window origin with
  `mode: "manual"` so renderers can apply pointer-driven moves through
  `moveManualDrag`. System-level window dragging remains owned by
  `shell-ui.startWindowDrag`, not by floating-window manual drag. Hosts that
  cannot support an operation must fail closed with `capability-unavailable`,
  never simulate success.
- Installed-app capability sets forbid all P-KIT-041F operations by default;
  granting any of them to installed apps requires a separate capability-set
  admission.

## P-KIT-042 — Renderer Shell Module

- `shell/renderer` is an infra module for shared renderer shell glue: host-neutral command wrappers, bridge primitives, and bootstrap skeleton for Tauri and Electron hosts.
- Delivered as subpath exports of the single `@nimiplatform/kit` package: `./shell/renderer/bridge` and `./shell/renderer/bootstrap`.
- Must not contain app-specific stores, navigation, UI rendering, or runtime readiness policy.
- Must not re-own auth session truth or telemetry normalization truth already owned by `kit/auth` (domain/auth) and `kit/telemetry` (domain/telemetry).
- Shared `parseRuntimeDefaults()` semantics consume the `shell/capabilities` runtime-defaults contract: missing required realm defaults must fail closed instead of normalizing to empty strings, and consumer apps must not fork a parallel parser contract.
- Renderer bridge code must source standard command names and standard error handling from `@nimiplatform/kit/shell/capabilities`.
- Renderer bridge code must fail closed when no standard host is installed. Browser/no-host fallbacks, renderer-owned Tauri truth, raw `@tauri-apps/api` imports, raw Tauri global probing as capability truth, raw `file://` fallback conversion, and silent UI no-ops are forbidden in standard shell mode.
- Bootstrap skeleton provides shared orchestration hooks; app-local code retains runtime readiness, daemon policy, and local data bootstrap.
- Consumer apps may retain app-local facade directories for app-specific bridge
  modules only when their own spec owns that boundary; shared core primitives
  come from this module.
- Consumer-specific UI adapter components must not be placed in this module.

## P-KIT-041E - Electron Shell Module

- `shell/electron` is shared Electron main/preload host glue that consumes
  `shell/protected-local` for exact typed protected calls and fixed-service
  status/start/restart while keeping preload IPC narrowed. There is no
  production external-daemon mode.
- Authority id and source location are `kit.shell.electron` at `kit/shell/electron/`.
- Delivered as subpath exports of the single `@nimiplatform/kit` package: `./shell/electron/main` and `./shell/electron/preload`.
- This module is Node/Electron-host only. Renderer application code must consume host-neutral renderer APIs from `shell/renderer` and standard command/error contracts from `shell/capabilities`, not import `shell/electron` directly.
- Must not contain app-specific stores, routes, product UI, business logic, Runtime/Realm typed API truth, or app-local command semantics.
- Generic Runtime bridge forwarding may preserve the public/binding-only wire
  shape, but must reject protected method ids and authorization-bearing
  renderer payloads. Protected session/origin material stays inside the native
  carrier and is neither injected by Electron main providers nor exposed to
  preload/renderer.
- Public/binding-only Runtime gRPC calls may use raw identity byte
  serialization/deserialization through `@grpc/grpc-js`; generated Runtime
  truth remains owned by Runtime proto/SDK. This path cannot carry protected
  account/lifecycle/Realm/Grant methods.
- Electron never owns Runtime lifecycle. It may carry exact typed fixed-service
  `status/start/restart` through `shell/protected-local`; stop, external-daemon
  mode, executable/config selection and generic mutation are forbidden.
  Unavailable/untrusted service status is a typed failure, never offline
  pseudo-success.
- Preload must expose only the narrowed Nimi bridge API needed by renderer code. It must not expose raw `ipcRenderer`, `electron`, `fs`, `child_process`, arbitrary channel senders, or unrestricted event listeners.
- Main-process IPC must enforce catalog-sourced command namespaces, app identity, and an explicit renderer origin allowlist. A missing app id or disallowed origin is a fail-closed host error.
- Standard Electron acceptance windows must enable `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- Local artifact URLs must be served through a registered protocol or same-origin host handler with path/root validation. The protocol registration, path/root validation, and readable-file registry are owned by `shell/electron`; consumer apps must not register parallel per-app file protocols or app-local URL resolvers for standard local-asset serving. Electron renderer code must not receive raw `file://` escape hatches for artifact inspection.

## P-KIT-044 - Installed App Standard Shell Capability Sets

**Owner-only authority allocation.** Kit owns typed shell APIs and trusted carrier implementation only. A Kit host adapter may carry opaque Runtime/Platform/Desktop attestations across a trusted shell boundary, but it cannot create account, catalog, release, grant, launch, unary, realtime, or media truth. A host or renderer MUST NOT supply or retain authenticated Realm credentials, signed upload credentials, refresh material, or self-certified privilege evidence.

The A.1 Windows installed-app child carrier consumes only the Runtime-created
launch correlation defined by K-PLOCAL-008, starts the Runtime-resolved exact
executable suspended, and submits its PID over retained protected Desktop
control before resuming it. The child opens the fixed installed pipe itself;
Kit never inherits or forwards a pre-connected pipe handle and cannot create
launch, process, release, account/session or capability truth.
`tables/standard-shell-capabilities.yaml` records the Windows launch/session
carrier as `a1_windows_admitted_implementation_pending`, while keeping its
`allowed_operations` list empty. The A.1 carrier admits only exact process
launch binding and opaque installed-session establishment; its planned
standard-shell operation list remains deny-only until A4 carrier and operation
admission. No Electron/Tauri metadata, Runtime unary proxy, host provider, app
id, or standard-shell operation may upgrade that narrow native carrier.
macOS/Linux remain fail-closed and cannot claim A.1 completion.

## P-KIT-045 - Desktop Open Intent Kit Surfaces

- `core/desktop-open` is a pure-logic Kit surface that wraps SDK
  `NimiDesktopOpenIntent` parser/types and provides normalized result helpers.
  SDK owns TypeScript semantic parsing; Kit must not fork a second parser truth.
- `shell/capabilities` owns the standard operation id
  `desktop-open.openIntent` and command name
  `nimi.shell.desktopOpen.openIntent`.
- `shell/renderer` exposes a host-neutral renderer bridge whose payload may
  include only `intent` and optional `requestId`. Renderer payloads must not
  include `sourceApp`, `sourceHost`, Desktop endpoint, Desktop token, raw URL,
  or OS scheme.
- `shell/electron` and `shell/tauri` implement host clients that resolve the
  running Desktop presence descriptor and POST to Desktop's exact-loopback
  bridge. They must not start Desktop.
- Domain-level Desktop Open rejections return as successful command values
  shaped as `NimiDesktopOpenResult`. The standard shell error envelope remains
  reserved for missing capability, forbidden renderer access, malformed command
  payload, serialization failure, and host internal errors before a domain
  result can be produced.

## P-KIT-043 — Runtime Capabilities Module

- `core/runtime-capabilities` is a logic sub-surface for pure-logic capability normalization, wildcard matching, and codegen capability catalog truth.
- Must be runtime-safe and renderer-safe: zero UI, CSS, app code, or shell-specific imports.
- May be consumed by runtime-side code (Go consumers via shared contract) in addition to renderer consumers.
- Must not be stranded in any single app's runtime directory; this is the single shared truth for capability semantics.
- Replaces any app-local capability catalog as the canonical owner.

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

## P-KIT-061 — Chat Host Composition Adapter Boundary

`kit/features/chat` remains the shared conversation-shell parity owner across
apps and exposes adapter slots for host-provided layout or presentation inputs.
Those adapter inputs are caller-supplied data, not kit-owned product truth.

Fixed rules:

- host-local layout or presentation inputs do not by themselves reopen shared
  canonical shell ownership for `kit/features/chat`
- adapter callers may pass geometry, placement, or flow taxonomy into the
  canonical adapter path, but kit must not fork a private transcript shell,
  private scroll-root truth, or private grouping / virtualization truth
- `kit/features/chat` remains the shared parity owner outside explicit adapter
  inputs
- any future widening of a host-local flow into shared kit ownership requires
  an explicit separate authority cut

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
- It must publish aggregate, `/headless`, `/ui`, and `/runtime` surfaces on the single `@nimiplatform/kit` package.
- It may additionally publish backend-specific optional renderer surfaces such as `/vrm` and future `/live2d` surfaces when those surfaces preserve the same avatar semantic contracts and do not force heavyweight renderer/runtime assumptions into the default `ui` surface.
- `headless` owns normalized avatar presentation inputs, transient interaction-state contracts, and reusable controller logic.
- `ui` owns the default opinionated avatar stage shell that consuming apps may place without rebuilding a parallel baseline renderer shell.
- `runtime` may bind `getPlatformClient().runtime` only for runtime-owned persistent agent presentation projection; it must not absorb app stores, platform bridges, or renderer-local transient state ownership.
- Optional backend-specific renderer surfaces must remain renderer-implementation seams only; they must not re-own persistent presentation truth, transient interaction truth, or app-specific placement policy.
- `kit/features/chat` and app-local shells may consume `kit/features/avatar`, but they must not re-own avatar semantics or create a parallel chat-private avatar contract.

## P-KIT-072 — Avatar Ownership Hardcut

- `kit/features/avatar` consumes runtime-owned persistent `AgentPresentationProfile` truth and app-owned transient `AvatarInteractionState`; it does not own either canonical layer.
- The module must not own canonical agent identity, canonical memory, voice workflow truth, voice asset truth, thread continuity truth, or app-specific permission policy.
- The module must not import app stores, Tauri/Electron bridges, or runtime internal code directly.
- Surface-specific placement, permissions, and orchestration remain app-owned; avatar renderer semantics remain reusable kit-owned.
- Runtime-aware avatar helpers must fail closed when required presentation profile fields are absent or unresolved; they must not invent fallback avatar assets, provider voices, or surface-local pseudo-success truth.

## P-KIT-073 — Avatar Backend Renderer Seam

Fixed rules:

- backend-specific optional exports such as `/vrm` and `/live2d` are renderer
  seams only
- backend renderer seams must preserve the normalized avatar presentation
  contract from `/headless` and must not re-own persistent presentation truth
- backend renderer seams must not own avatar asset import, storage, registry,
  per-agent binding, fallback policy, local runtime packaging, or viewport
  lifecycle truth
- backend renderer framing intent vocabulary is `auto`, `full-body`,
  `bottom-companion`, and `head-shoulders`; app/product synonyms such as
  `chat-focus`, `scene-presence`, or `showcase` must be mapped by the app before
  crossing into kit
- a backend renderer export must be registered and shipped explicitly before it
  is available package surface; registry prose must not fabricate a shipped
  export
- backend admission is bounded to avatar-stage rendering semantics; pointer
  interaction parity, camera choreography, authoring flows, and model inspection
  behavior require separate authority if promoted to reusable kit surface

## P-KIT-074 — Avatar Interaction Adapter Boundary

`kit/features/avatar` may expose typed interaction adapter fields for active
avatar surfaces. These fields are renderer inputs and do not make kit the owner
of raw attention intake.

Fixed rules:

- interaction adapter fields may include resolved attention targets, continuous
  presence state, and bounded follow intent when admitted by the feature module
  type surface
- kit must not own DOM pointer capture, viewport measurement, attention
  smoothing, clamp policy, speaking-vs-attention precedence, or surface
  stop-line policy
- backend-specific optional surfaces such as `/vrm` and `/live2d` remain
  renderer seams and must not become semantic owners of interaction truth
- widening raw interaction lifecycle ownership into kit requires a separate
  platform authority cut

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
  - the telemetry sub-module contains Tauri or Node.js imports
  - the `shell/renderer` sub-module contains app-specific stores, navigation, or UI rendering
  - the `shell/renderer` sub-module re-owns auth session truth or telemetry normalization truth
  - the `shell/capabilities` sub-module is missing from the package export map, diverges from `tables/standard-shell-capabilities.yaml`, or omits any required standard Nimi ecosystem capability
  - the `shell/renderer` sub-module uses browser/no-host fallbacks, renderer-owned Tauri truth, raw Tauri globals as capability truth, raw `file://` conversion fallback paths, or command names not sourced from `shell/capabilities`
  - the `shell/protected-local` boundary is absent, renderer-visible, or claims
    Runtime/OS lifecycle, custody, origin, listener, configuration or executable
    selection authority
  - the `shell/electron` sub-module is imported by renderer application code,
    exposes raw Electron/Node/protected primitives through preload, omits origin
    allowlist enforcement, uses non-sandboxed standard acceptance windows,
    generically proxies protected methods, or claims Runtime lifecycle ownership
  - the `core/runtime-capabilities` sub-module contains UI, CSS, or shell-specific imports
  - the auth sub-module defines CSS custom properties outside the `--nimi-*` namespace (except scoped overrides within `data-shell-auth-theme`)
  - a feature module omits required registry metadata for `surface_level`, `adapter_contract`, `headless_exports`, or `ui_exports`
  - a feature module claims `runtime` or `realm` capability but does not publish the matching surface
  - a feature module publishes `runtime` while binding `getPlatformClient().realm`, or publishes `realm` while binding `getPlatformClient().runtime`
  - a feature module imports app aliases, SDK client packages, or platform bridge implementations directly

## Fact Sources

- `tables/nimi-kit-registry.yaml`
- `tables/rule-evidence.yaml`
