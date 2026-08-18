# Changelog

All notable changes to this repository are documented in this file.

The format follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added

- `nimi-runtime` daemon and CLI command surface (`runtime ai/model/auth/grant/knowledge/app/audit/workflow/health/providers`)
- Runtime service implementations and gRPC wiring
- Runtime/user/developer docs (`docs/getting-started`, `docs/runtime`, `docs/sdk`, `docs/protocol`, `docs/dev/*`)
- Open source governance bootstrap docs (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `DCO`)
- npm author release set for `@nimiplatform/sdk` + `@nimiplatform/app-tools`, including package-qualified one-shot author commands via `pnpm dlx @nimiplatform/app-tools ...`

### Changed

- **Breaking (`@nimiplatform/sdk` 0.x):** AIProfile machine projections now use exact Machine Loadout names (`loadouts`, `loadoutId`, and `NimiAIProfileAuthoringMachineLoadoutProjection`), including the bounded Local App Model Config selection projection. Portable local implementation-configuration intent remains unchanged.
- **Breaking (`@nimiplatform/sdk` 0.x):** The public Runtime local environment plane is now exposed by `NimiRuntimeLocalEnvironmentClient` and `createNimiRuntimeLocalEnvironmentClient`; the narrower `LocalAssetAdmin` client, types, source modules, and exports were removed without aliases.
- **Breaking (`@nimiplatform/sdk` 0.x):** ScenarioJob error diagnostics now expose `NimiRuntimeScenarioJobErrorTerminalStatus` and `getNimiRuntimeScenarioJobTerminalStatusFromError`, preserving the existing FAILED/CANCELED/TIMEOUT values without treating the helper as a complete terminal-state projection.
- `README.md` quick start aligned with `cmd/nimi serve` + `cmd/nimi runtime ...`
- Runtime AI scenario outputs and stream deltas now use typed `ScenarioOutput` / discriminated delta wrappers instead of generic `google.protobuf.Struct`-style payload decoding.
- `realm.raw` and `runtime.raw` were renamed to `realm.unsafeRaw` and `runtime.unsafeRaw` to make raw transport boundaries explicit.
- High-level SDK AI surfaces no longer expose fallback controls; public scenario execution paths now normalize to fail-close / `DENY`.
- SDK AI provider image file inputs now require an explicit `mediaType`; image payloads fail closed instead of inferring or defaulting MIME type.
- `@nimiplatform/sdk/realm` no longer re-exports DTO types directly; migrate external `import type { SomeDto }` usage to `RealmModel<'SomeDto'>`.

### Removed

- obsolete runtime CLI examples (`serve`, `status` legacy form)
