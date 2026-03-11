# Changelog

All notable changes to this repository are documented in this file.

The format follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added

- `nimi-runtime` daemon and CLI command surface (`runtime ai/model/auth/grant/knowledge/app/audit/workflow/health/providers`)
- Runtime service implementations and gRPC wiring
- Runtime/user/developer docs (`docs/getting-started`, `docs/runtime`, `docs/sdk`, `docs/protocol`, `docs/dev/*`)
- Open source governance bootstrap docs (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `DCO`)
- npm author release set for `@nimiplatform/sdk` + `@nimiplatform/dev-tools`, including package-qualified one-shot author commands via `pnpm dlx @nimiplatform/dev-tools ...`

### Changed

- `README.md` quick start aligned with `cmd/nimi serve` + `cmd/nimi runtime ...`

### Removed

- obsolete runtime CLI examples (`serve`, `status` legacy form)
