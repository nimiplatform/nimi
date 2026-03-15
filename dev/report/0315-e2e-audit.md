# 0315 Desktop E2E Audit

Date: 2026-03-15
Plan: `dev/plan/0315-e2e.md`
Scope: `apps/desktop`, `apps/desktop/src-tauri`, `spec/desktop`, desktop CI workflows

## implemented

- Desktop E2E runner is hard-cut to fixture-driven execution through `tauri-driver + WebDriverIO`.
- `run-e2e` now separates `smoke` and `journeys` as distinct scenario sets instead of accidentally running all scenarios for `journeys`.
- Desktop E2E profiles and fixture data are declared under `apps/desktop/e2e/fixtures/profiles/**`.
- Renderer-side bypass paths were removed from production flows. The desktop app no longer relies on `window.__NIMI_E2E__` or renderer-only store mutation shortcuts for official E2E coverage.
- Tauri-side fixture injection is wired through `NIMI_E2E_FIXTURE_PATH` and command-level adapters for desktop runtime defaults, bridge status, and release info.
- Stable `E2E_IDS` and `data-testid` selectors are present for login, shell, navigation, offline, release strip, runtime config, explore, world, chats, and key panels.
- `desktop-feature-coverage.yaml` and desktop spec consistency checks enforce coverage metadata for core tabs, bootstrap phases, and critical IPC mappings.
- CI and release workflows explicitly run `check:desktop-e2e-smoke` before `check:desktop-e2e-journeys`.
- Linux and Windows workflows install desktop E2E prerequisites and upload desktop E2E evidence artifacts.
- macOS is explicitly treated as a non-blocking manual smoke platform, not as a blocking automated desktop WebDriver target.

## hard_cut_closed

- Removed renderer-side E2E fixture dependence from runtime bridge and data sync production paths.
- Removed reliance on `window.__NIMI_E2E__` as a supported test mutation surface.
- Added `pnpm check:desktop-no-e2e-bypass` to block reintroduction of renderer-side E2E shortcuts.
- Replaced implicit or fake journey parity with explicit smoke and journey workflow steps in CI and release automation.
- Replaced missing workflow dependency `env:check:mods-root` with a concrete script used by desktop release workflows.

## remaining_non_blocking

- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` passes but still emits existing warnings. These are recorded as non-blocking for the current gate and should be handled in a separate cleanup track if the project later raises the bar to warning-free clippy.
- macOS still requires manual smoke validation for desktop-specific behavior such as menu-bar hide versus quit. This is intentional because the official desktop WebDriver route is not treated as blocking on macOS.

## remaining_blocking

- Release parity is not complete until Linux and Windows each produce at least one real desktop E2E evidence record from CI for:
  - `pnpm check:desktop-e2e-smoke`
  - `pnpm check:desktop-e2e-journeys`
- Local macOS runs cannot satisfy this requirement. The blocking evidence must come from CI artifacts produced by the Linux and Windows workflow jobs.

## gate_freeze

- `D-GATE-020`: backed by `cargo test` and `cargo clippy --all-targets`; warnings remain non-blocking.
- `D-GATE-030`: backed by the smoke suite and its scenario manifests/artifacts.
- `D-GATE-040`: backed by the journeys suite and its scenario manifests/artifacts.
- `D-GATE-060`: backed by the explicit Linux/Windows blocking policy and macOS manual smoke policy.
- `D-GATE-070`: release parity requires actual CI evidence from Linux and Windows, not just the presence of scripts or workflows.

## local_verification

- `pnpm check:desktop-no-e2e-bypass`
- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm --filter @nimiplatform/desktop test`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets`

## evidence_status

- Local static, TypeScript, and Rust gates are green.
- CI evidence generation is implemented, but this workstation cannot produce blocking Linux/Windows desktop WebDriver evidence because it is a macOS environment.
- The authoritative pass/fail record for desktop release parity must be attached through CI artifact output described in `dev/report/desktop-e2e-ci-acceptance.md`.
