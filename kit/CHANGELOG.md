# Changelog

All notable changes to `@nimiplatform/kit` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with the pre-1.0 discipline documented in `kit/AGENTS.md` §Semver
Discipline.

## [Unreleased]

### Added

- Added `@nimiplatform/kit/auth/shell` as a lightweight public auth entry
  that exports `ShellAuthPage` and its adapter/type contracts without the
  desktop shell particle background or Three.js dependencies.
- Added Electron host command policy types on `@nimiplatform/kit/shell/electron/main`
  so installed-app hosts can deny selected standard/app-domain commands before
  their handlers run while preserving structured fail-closed shell errors.
- Added `@nimiplatform/kit/features/agent-center` as the reusable Runtime
  Local Agent Center surface. Apps now consume typed Runtime/appearance
  adapters instead of passing arbitrary app panels into Agent Center; model
  readiness, autonomy, cognition, appearance, and advanced diagnostics are
  rendered from Runtime/SDK projections.
- Admitted five standard shell capabilities across `shell/capabilities`,
  `shell/renderer/bridge`, `shell/electron`, and `nimi_shell_tauri`:
  `file-dialog.open`, `file-reveal.reveal`, `export.saveFile`,
  `artifacts.write`, and the `floating-window.*` operation family
  (platform rule `P-KIT-041F`). Hosts without an implementation fail closed
  with `capability-unavailable`; the installed-app capability set forbids all
  of them by default.
- Finalized the `floating-window.*` three-layer contract (renderer bridge,
  Electron host hooks, and the new `nimi_shell_tauri::standard_floating_window`
  Tauri command module). Contract shapes: `setBounds` takes an integer,
  physical-pixel `{x?,y?,width?,height?}` patch (at least one field; `x`/`y`
  and `width`/`height` move together); `beginManualDrag` takes no payload and
  returns `{mode:'manual', originX, originY}` — `mode` is a
  `'system'|'manual'` union reserved for a future platform, but both hosts
  always report `'manual'` (system-level `start_dragging` is unreliable for
  transparent always-on-top windows) plus the window's current outer position
  as the drag origin; `moveManualDrag` takes
  `{originX, originY, totalDeltaX, totalDeltaY}` and sets the window position
  to `origin + totalDelta`; `constrainToVisibleArea` takes `{minVisibleRatio}`
  (clamped `0.05..=1.0`, default `0.2`) and returns `{constrained}` indicating
  whether the window actually moved. The renderer type exports changed from
  `FloatingWindowManualDragPoint` to `FloatingWindowBounds`,
  `FloatingWindowIgnoreCursorEventsOptions`,
  `FloatingWindowManualDragOrigin`, `FloatingWindowMoveDelta`, and
  `FloatingWindowConstrainResult`. Tauri exposes a standalone opt-in handler
  macro `nimi_shell_tauri_floating_window_commands!` (the eight
  `floating_window_*` commands only) that is deliberately excluded from the
  default runtime/auth/oauth handler families so window control is not granted
  to apps that do not opt in.
- Added `createElectronShellFileProtocolHost` (`shell/electron`): kit-owned
  `nimi-shell-file` protocol registration, path/root validation, and the
  readable-file registry for standard local-asset URL serving.
- Added Tauri standard shell-ui host hooks
  (`set_standard_shell_ui_host_hooks`): apps inject confirm-dialog, focus
  target, and window-drag policy instead of registering same-name app-local
  command forks.
- Added renderer-safe text storage helpers to `@nimiplatform/kit/core/storage-json`
  so apps can share browser storage access mechanics without moving schema
  ownership into Kit.
- Exported `emitRendererLog` from `@nimiplatform/kit/telemetry` so renderer
  bridge code can use the shared telemetry normalizer directly.
- Added `createRuntimeAccountDesktopBrowserAuth` to `@nimiplatform/kit/auth`
  so Electron/Tauri app shells can consume RuntimeAccountService browser login
  without app-owned token custody.

### Fixed

- Electron Runtime account metadata now pre-registers local first-party and
  developer account callers before account projection lookup, while preserving
  launch-bound installed app caller handling.
- Renderer telemetry now forwards through the installed Nimi shell runtime
  bridge/test hook when available, without importing Tauri bridge code from
  `kit/telemetry`.
- VRM emote blending (`kit/features/avatar` `createVrmEmoteState`) now
  accumulates elapsed time per blend and eases between the weight at blend
  start and the target, so a blend completes in `blendDurationSec` under
  real per-frame deltas. The previous per-frame incremental easing
  (`easeInOutCubic(dt / duration)` applied to the remaining gap) converged
  at roughly 1.7%/s at 60fps (~170s for a 0.4s blend), and its exact-float
  completion check kept finished blends in the update loop forever.

### Changed

- **Breaking (0.x):** Agent Center Shell preview resolution now returns
  `previewMaterialRef` only. Consumers must pass that material to an
  Avatar-owned `AgentCenterAvatarPreviewAdapter` and require its render
  artifact, same-origin surface, evidence ref, and pixel proof before showing
  appearance readiness; migrate off Shell `previewArtifactRef` and
  `previewImageRef` claims.
- **Breaking (0.x):** `AgentCenterAppearanceAdapter` no longer exposes
  account-wide `removeAccountResources`. Account teardown must use the
  low-level Shell bridge from an account-scoped orchestrator; per-agent Agent
  Center transactions may only remove their own resources.
- **Breaking (0.x)**: Agent presentation mutation now requires the caller's
  canonical uint64-string `expectedRevision` and returns
  `{ profile, committedRevision }`. Migration: retain and pass the revision
  returned by the preceding read or successful mutation. Kit consumers do not
  retry revision conflicts and must not substitute `"0"` or any other fallback.
- **Breaking (0.x)**: Agent Center shell custody payloads now use strict
  discriminated scope contracts. The nine local-agent operations require
  `hostScope: 'local-agent'` plus non-empty `accountId`, `ownerUserId`,
  `runtimeSourceRef`, and `localAgentRef`; account resource cleanup requires
  `hostScope: 'account'` plus `accountId`. Migration: pass the complete Runtime
  identity scope to every local-agent custody call and an explicit account
  scope to account cleanup. Missing fields no longer reach a host as partial
  payloads and fail closed as `invalid-payload`. Tauri-only `select` and
  `displayName` import inputs and `selected` results are removed; consumers
  must not send renderer-owned selection/display mutations or read local
  selection truth from custody results.
- **Breaking (0.x)**: Electron `standardShellHost` storage root input moved
  from a plain `dataRoot: string` to the Runtime-attested
  `standardDataRootBinding` (`runtime-get-app-storage` resolved lazily by the
  host through Runtime `GetAppStorage`, or `runtime-launch-projection` with
  attested roots plus `projectionRef`). Migration: dev/acceptance hosts pass
  `{ source: 'runtime-get-app-storage' }` (or a projection binding sourced
  from an acceptance fixture root), and the Desktop installed-app host passes
  the Runtime OpenApp launch-projection roots. There is no silent
  `userData` fallback for standard storage resolution. The legacy
  `dataRoot`/`cacheRoot`/`tempRoot` host fields and the app-provided
  `resolveLocalAssetUrl` host hook are fully removed (no transitional
  compatibility): a host missing `standardDataRootBinding` fails closed with
  `electron-standard-data-root-binding-missing`, and local-asset URL serving is
  owned solely by `localAssetProtocolHost` (missing → `capability-unavailable`).
- **Breaking (0.x)**: Tauri standard data/storage commands now read managed
  `StandardAppStorageRootSlot` state resolved from `StandardDataRootBinding`
  (`StandardAppStorageRoot` removed); an unmanaged or unresolved slot fails
  closed with `tauri-standard-storage-binding-missing`. Standard storage
  payloads reject renderer-supplied root fields
  (`path`/`root`/`storageRoot`/`absolutePath`/`dataRoot`/`cacheRoot`/`tempRoot`)
  on both hosts.
- Replaced the shared `DatePicker` popover with a three-column year / month /
  day wheel selector and removed the old monthly calendar-grid panel. This is
  a 0.x interaction break: consumers that relied on `DatePickerPanel`'s old
  `displayMonth` / `onDisplayMonthChange` panel props must update to the new
  wheel-panel contract.

## [0.1.3] - 2026-05-27

### Changed

- Hard-cut archived app-specific shell/auth affordances from the public kit
  surface: `ShellMode` now admits only `desktop` and `web`, and
  `ShellAuthTheme` no longer exposes the archived `relay-dark` palette.

## [0.1.2] - 2026-05-25

### Fixed

- Included nested auth CSS theme assets in the published `dist` package so
  `@nimiplatform/kit/auth/styles.css` resolves every relative `@import`.
- Extended the kit dist package guard to fail when a published CSS file
  references a missing relative CSS asset.

## [0.1.1] - 2026-05-24

### Fixed

- Hardened npm package publishing so public subpath exports resolve to
  compiled `dist` JavaScript and declaration files instead of raw
  `src/**/*.ts` / `src/**/*.tsx` source files.
- Added a dist package guard that fails when package exports point outside
  `dist`, leak source paths, or reference missing build outputs.

## [0.1.0] - 2026-05-23

Initial public publish for the ST-L1-2 standardization work.
`@nimiplatform/kit` becomes the single cross-app toolkit package
for Nimi apps with 58 public subpath exports while remaining in a
pre-1.0 iteration phase.

### Added

- **Public exports inventory** (58 entries): 11 UI entries (`./ui`,
  `./ui/glass`, `./ui/motion`, `./ui/a11y`, `./ui/styles.css`, and six
  `./ui/themes/*` files), 3 auth entries, 6 core entries (including
  `./core/sdk-contract`), 2 renderer-shell entries, 2 telemetry entries,
  and 34 feature entries across `chat`, `avatar`, `model-picker`,
  `model-config`, `generation`, `commerce`.
  Full inventory in
  `.nimi/topics/ongoing/2026-05-23-nimi-kit-component-library-standardization/kit-public-surface-inventory.yaml`.
- **SDK contract boundary admission** at `kit/core/src/sdk-contract.ts`:
  single audit surface for kit-to-SDK coupling. All static
  `@nimiplatform/sdk*` imports inside kit code (non-test) route through
  this file. Re-exports cover 5 admitted S-SURFACE-001 sub-paths
  (`/`, `/runtime`, `/realm`, `/types`, `/mod`).
- **a11y primitives module** (`./ui/a11y`): `FOCUS_RING_CLASS_NAME`
  applied to `Button` and `IconButton` for WCAG 2.1 AA keyboard focus
  visibility, visually hidden helper constants, focus-trap hook.
- **Motion primitives module** (`./ui/motion`): SSR-safe
  `usePrefersReducedMotion` hook and `MOTION_TIMING` tokens. Respects
  `prefers-reduced-motion: reduce`.
- **Glass primitives module** (`./ui/glass`): shared frosted-surface
  primitives extracted from prior duplicated implementations across
  feature modules.
- **Cross-feature edge documentation**: `chat → avatar` and
  `model-config → model-picker` admitted as documented one-way feature
  compositions. Documented at `kit/core/src/sdk-contract.ts` header and
  `kit/AGENTS.md` §Cross-Feature Edges.
- **Counting vocabulary** for SDK-coupling audits at `kit/AGENTS.md`
  §Counting Vocabulary: `importing-file count`, `import-statement count`,
  `export-statement count` kept distinct.
- **Semver discipline doc** at `kit/AGENTS.md` §Semver Discipline:
  pre-1.0 patch/minor/major classification rules, migration-note
  requirements for breaking 0.x minors, and directional alignment with
  `@nimiplatform/sdk`.

### Changed

- **`kit/features/chat/src/runtime/orchestration.ts`**: the dynamic
  SDK import for `getPlatformClient` now routes through
  `@nimiplatform/kit/core/sdk-contract` instead of
  `@nimiplatform/sdk` directly, eliminating the last bypass of the
  single-boundary contract.
- **`kit/README.md`**: rewritten as external-consumer documentation
  covering installation, version policy, import patterns by sub-module,
  theming integration, accessibility, motion, and the SDK contract
  boundary explanation.

### Versioning

This is the initial public publish in the 0.x line. Patch releases are
reserved for compatible fixes. Minor releases may add exports or carry
breaking changes during the pre-1.0 phase, but any breaking 0.x minor
requires a migration note. Alignment with `@nimiplatform/sdk` remains
directional until the SDK reaches 1.0.0, at which point kit must make
an explicit 1.0.0 readiness decision.

### Migration notes

None — initial release. Consumers previously building against
unpublished workspace paths should update to the npm package name
`@nimiplatform/kit` and keep `@nimiplatform/sdk` aligned with the
compatible pre-1.0 range selected by their app.

[0.1.3]: ./
[0.1.2]: ./
[0.1.1]: ./
[0.1.0]: ./
