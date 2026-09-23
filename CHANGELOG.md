# Changelog

All notable changes to this repository are documented in this file.

The format follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Fixed

- Component npm release workflows treat a missing registry version as
  unpublished without mistaking npm's JSON error output for a published digest.
- Nimi Lab and scaffolded AI Studio media parameter fields (music generation,
  recording transcription, voice conversion, audio separation) and their
  recovery panels refresh AIConfig readiness when the in-app AI config drawer
  closes, instead of waiting for window focus or a reload. Closing the drawer
  dispatches the app-local `nimi://ai-studio-ai-config-changed` event that
  `subscribeStudioAIConfigRefresh` handles alongside focus and visibility, and
  the run-target gate uses the same event instead of re-reading on drawer
  state. `@nimiplatform/app-tools` packs this AI Studio core into
  `--features studio-media` scaffolds as App-owned
  `src/capabilities/ai-studio-core/**`, which `nimi-app sync` never rewrites:
  existing scaffolds must port `ai-config.ts`, `index.ts`,
  `section-ai-testing.tsx`, and `section-ai-testing-run.ts` by hand, together.
  Generated host glue and the `studio-media` files are unchanged.

## [0.2.0] - 2026-08-31

### Added

- `nimi` Runtime daemon and current CLI surface: foreground/background lifecycle,
  diagnostics, configuration, inter-App messaging, and audit operations.
- Runtime service implementations and gRPC wiring
- Runtime/user/developer docs (`docs/getting-started`, `docs/runtime`, `docs/sdk`, `docs/protocol`, `docs/dev/*`)
- Open source governance bootstrap docs (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `DCO`)
- npm author release set for `@nimiplatform/sdk` + `@nimiplatform/app-tools`, including package-qualified one-shot author commands via `pnpm dlx @nimiplatform/app-tools ...`

### Changed

- **Breaking (`@nimiplatform/sdk` 0.x):** Caller-local ScenarioJob abort now reports `OPERATION_ABORTED` without fabricating a Runtime `CANCELED` terminal status; applications may present it as a stopped operation while preserving the distinct reason.
- Runtime local catalog and install-plan SDK projections now treat an unspecified engine runtime mode as engine-neutral acquisition metadata while continuing to reject unknown declared modes.
- **Breaking (`@nimiplatform/sdk` 0.x):** AIProfile machine projections now use exact Machine Loadout names (`loadouts`, `loadoutId`, and `NimiAIProfileAuthoringMachineLoadoutProjection`), including the bounded Local App Model Config selection projection. Portable local implementation-configuration intent remains unchanged.
- **Breaking (`@nimiplatform/sdk` 0.x):** The public Runtime local environment plane is now exposed by `NimiRuntimeLocalEnvironmentClient` and `createNimiRuntimeLocalEnvironmentClient`; the narrower `LocalAssetAdmin` client, types, source modules, and exports were removed without aliases.
- **Breaking (`@nimiplatform/sdk` 0.x):** ScenarioJob error diagnostics now expose `NimiRuntimeScenarioJobErrorTerminalStatus` and `getNimiRuntimeScenarioJobTerminalStatusFromError`, preserving the existing FAILED/CANCELED/TIMEOUT values without treating the helper as a complete terminal-state projection.
- `README.md` source-checkout quick start aligned with `nimi init` and foreground
  `nimi serve`; connector custody and model selection remain on the Desktop
  protected Runtime surface.
- Runtime AI scenario outputs and stream deltas now use typed `ScenarioOutput` / discriminated delta wrappers instead of generic `google.protobuf.Struct`-style payload decoding.
- `realm.raw` and `runtime.raw` were renamed to `realm.unsafeRaw` and `runtime.unsafeRaw` to make raw transport boundaries explicit.
- High-level SDK AI surfaces no longer expose fallback controls; public scenario execution paths now normalize to fail-close / `DENY`.
- SDK AI provider image file inputs now require an explicit `mediaType`; image payloads fail closed instead of inferring or defaulting MIME type.
- `@nimiplatform/sdk/realm` no longer re-exports DTO types directly; migrate external `import type { SomeDto }` usage to `RealmModel<'SomeDto'>`.

### Removed

- **Breaking (Runtime/SDK 0.x):** Retired public Local ExecutionHost lifecycle RPCs and generated clients were removed; ExecutionHost supervision remains Runtime-private.
- Retired Desktop `LOCAL_AI_*` projection codes and unused Runtime voice-job/descriptor reasons were removed without compatibility aliases.
- Retired public generation, auth, grant, knowledge, model/provider, and
  workflow CLI groups; protected product configuration is not exposed through
  replacement command aliases.
