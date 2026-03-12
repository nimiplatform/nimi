# Desktop Release Readiness Audit

Date: 2026-03-13

## 1. Overview

- Scope: `apps/desktop/**` against the current `spec/desktop/kernel/**` contract set.
- Kernel rule baseline in the current repo: `170` desktop rules in [`spec/desktop/kernel/tables/rule-evidence.yaml`](/Users/snwozy/nimi-realm/nimi/spec/desktop/kernel/tables/rule-evidence.yaml), all `170/170` marked `covered`.
- Gate outcome: all desktop acceptance gates and Rust checks passed on this run.
- Desktop test outcome: `711/711` TypeScript tests passed after splitting `i18n.test.ts` into a dedicated serial run; Rust tests passed `205/205`.
- Release verdict: `PASS` for desktop scope.

Resolved issues in this pass:

- Fixed `ChatMessage.parts` contract drift across `sdk -> desktop` by aligning SDK helper output to generated runtime message types and updating desktop text-generate request payloads.
- Fixed `D-BOOT-011` cleanup ordering in [`apps/desktop/src/shell/renderer/infra/bootstrap/exit-handler.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/infra/bootstrap/exit-handler.ts).
- Stabilized the desktop unit-test entrypoint by running [`apps/desktop/test/i18n.test.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/test/i18n.test.ts) separately with serial test concurrency.
- Added contract assertions for D-BOOT-005/006/007, D-BOOT-011, and broader D-TEL-003 fallback behavior.

## 2. Gate Results

| Gate | Command | Result | Duration |
| --- | --- | --- | --- |
| Kernel consistency | `pnpm check:desktop-spec-kernel-consistency` | PASS | 0.49s |
| TypeScript compile | `pnpm --filter @nimiplatform/desktop typecheck` | PASS | 5.41s |
| Desktop lint | `pnpm --filter @nimiplatform/desktop lint` | PASS | 10.98s |
| Desktop tests | `pnpm --filter @nimiplatform/desktop test` | PASS | 19.71s |
| Cloud runtime hard-cut | `pnpm check:desktop-cloud-runtime-only` | PASS | 0.51s |
| Runtime config path hard-cut | `pnpm check:desktop-no-legacy-runtime-config-path` | PASS | 0.42s |
| Local AI TS hard-cut | `pnpm check:no-local-ai-private-calls` | PASS | 0.42s |
| Local AI Tauri hard-cut | `pnpm check:no-local-ai-tauri-commands` | PASS | 0.39s |
| Runtime/mod hook hard-cut | `pnpm check:runtime-mod-hook-hardcut` | PASS | 0.47s |
| Mod capabilities hard-cut | `pnpm check:no-legacy-mod-permissions-field` | PASS | 0.38s |
| Desktop mods smoke | `pnpm check:desktop-mods-smoke --all` | PASS | 0.49s |
| Rust compile | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | 0.25s |
| Rust tests | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | 0.86s |

## 3. Contract Summary

| Domain | Rules | Status | Notes |
| --- | --- | --- | --- |
| D-AUTH | 11 | PASS | Existing auth session and trace propagation tests still green. |
| D-BOOT | 12 | PASS | Added ordering coverage for runtime mods, external agent bridge, auth bootstrap, and quit cleanup. |
| D-CODEGEN | 9 | PASS | No regressions detected; evidence coverage remains complete. |
| D-DSYNC | 14 | PASS | Existing flow coverage remained green, including direct upload wiring. |
| D-ERR | 12 | PASS | Existing error propagation and bridge normalization tests remained green. |
| D-HOOK | 11 | PASS | Hard-cut gate passed; no residual forbidden hook/mod surface found. |
| D-IPC | 13 | PASS | Existing mod developer IPC coverage remained green. |
| D-LLM | 9 | PASS | Fixed text-generate message contract drift to match current runtime protobuf surface. |
| D-MBAR | 5 | PASS | Quit-path coverage now explicitly checks cleanup order and managed daemon shutdown guard. |
| D-MOD | 19 | PASS | Existing developer mode, diagnostics, conflict, and catalog governance coverage remained green. |
| D-NET | 7 | PASS | No regressions detected. |
| D-OFFLINE | 5 | PASS | Existing bootstrap/offline reachability coverage remained green. |
| D-SEC | 10 | PASS | Existing local runtime validation and hash validation coverage remained green. |
| D-SHELL | 10 | PASS | Existing developer settings and shell observability coverage remained green. |
| D-STATE | 5 | PASS | Kernel consistency gate remained green. |
| D-STRM | 10 | PASS | Stabilized recovery-timeout test by waiting on the terminal condition instead of a fixed sleep. |
| D-TEL | 8 | PASS | Confirmed D-TEL-003 fallback console behavior remains spec-compliant; extended tests to warn/error paths. |

## 4. Legacy Hard-Cut Findings

| Legacy pattern | Expected action | Status | Evidence |
| --- | --- | --- | --- |
| `.nimi/runtime/config.json` fallback | Delete | Cleared | hard-cut gate passed; no hit under desktop TS/Rust sources |
| `credentialRefId` | Replace with `connectorId` | Cleared | no hit under `apps/desktop/src`, `apps/desktop/src-tauri/src`, `sdk/src` relevant desktop path |
| `permissions:` manifest/runtime field | Capabilities only | Cleared | hard-cut gate passed |
| `createAiClient` / `ModAiClient` | Delete | Cleared | no desktop hit |
| `hook.llm` capability key | Delete | Cleared | no desktop hit |
| `routeHint` / `routeOverride` | Delete | Cleared | no desktop hit |
| `createProviderAdapter()` direct call | Delete | Cleared | no desktop hit |
| `GenerateText` legacy RPC | Delete | Cleared | no desktop hit |
| raw `console.*` runtime logging | Review against D-TEL-003 | Allowed | [`spec/desktop/kernel/telemetry-contract.md`](/Users/snwozy/nimi-realm/nimi/spec/desktop/kernel/telemetry-contract.md) explicitly allows fallback `console.*` when no runtime logger is injected |

## 5. Test Coverage Matrix

| Area | Evidence | Assessment |
| --- | --- | --- |
| Bootstrap / quit path | `bootstrap-sequence-ordering.test.ts`, `menu-bar-shell-integration.test.ts` | Strong |
| Mod developer host | `d-ipc-013-mod-developer-host-commands.test.ts`, `d-shell-009-mod-developer-mode.test.ts`, `d-shell-010-mod-observability.test.ts` | Strong |
| Scenario job tracking | `scenario-job-controller.test.ts`, `scenario-job-shell-wiring.test.ts` | Strong |
| Telemetry | `telemetry-log-format.test.ts`, existing D-TEL-008 tests | Strong |
| Data Sync | existing D-DSYNC suite plus direct upload wiring in facade tests | Strong |
| Runtime bridge / daemon | existing runtime-config, invoke, daemon manager, and Rust bridge tests | Strong |
| Localization | dedicated serial `i18n.test.ts` plus existing `i18n:check` and `i18n:audit` | Strong |

Overall desktop test footprint on this run:

- TypeScript test files discovered: `101`
- TypeScript test cases passed: `711`
- Rust test cases passed: `205`

## 6. Blocking Items

None.

## 7. Warnings

- The user-provided baseline numbers were stale relative to the current repo. The current desktop rule-evidence table contains `170` covered rules, not `157`.
- The working tree still contains many unrelated dirty changes outside the desktop scope, including runtime, SDK, proto, dev-tools, and example packages. Release packaging should isolate the desktop-ready change set before tagging or merging.

## 8. Recommendation

Desktop is release-ready for the audited scope.

Before cutting a release artifact:

1. Isolate the desktop-ready diff from unrelated workspace changes.
2. Preserve the current split unit-test entrypoint so `i18n.test.ts` continues to run deterministically.
3. Keep the generated runtime message surface (`ChatMessage.parts`) as the single source of truth for future text-generate request builders.
