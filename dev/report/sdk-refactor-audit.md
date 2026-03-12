# SDK Refactor Audit

Date: 2026-03-13
Workspace baseline: current dirty worktree
Package: `@nimiplatform/sdk`
Effective version at end of audit: `0.4.4`

## Summary

- The initial Claude-style conclusion was not accepted as source of truth. At the start of this audit, `pnpm build:sdk` failed because the in-flight `ChatMessage.parts` migration was only partially landed in SDK handwritten layers.
- The SDK text request path is now closed end-to-end: runtime high-level text helpers and ai-provider text helpers both dual-write `content` and `parts`, support multimodal image/video parts, and fail closed when a text-generation request contains no non-system text.
- All local SDK gates in the spec execution path are green after remediation.
- `pnpm check:live-provider-invariants` passes.
- Live smoke / release parity were not certified in this session because no `NIMI_LIVE_*` environment was present and `run-live-test-matrix.mjs` stalled inside the live smoke child process. Those gates are recorded as `BLOCKED_BY_ENV`, not `PASS`.

## Spec Contract Alignment Matrix

| Domain | Status | Evidence |
| --- | --- | --- |
| `S-SURFACE` | PASS | public subpaths intact; consumer smoke passed |
| `S-RUNTIME` | PASS | SDK tests passed; runtime bridge drift gate passed; multimodal text request projection fixed |
| `S-REALM` | PASS | realm tests passed; `sdk-realm-legacy-clean` gate passed |
| `S-ERROR` | PASS | `reason-code-constants` gate passed; fail-close text-input behavior covered by tests |
| `S-TRANSPORT` | PASS | SDK tests and transport coverage passed |
| `S-BOUNDARY` | PASS | import boundary / naming / no-create / no-global-openapi-config gates passed |
| `S-AIP` | PASS | ai-provider multimodal request projection covered by tests |
| `S-SCOPE` | PASS | scope tests passed; consumer smoke passed |
| `S-MOD` | PASS | `mods-no-runtime-sdk` and `runtime-mod-hook-hardcut` passed; consumer smoke verified removed legacy mod subpaths |

No contract gaps or excess surface were observed in the locally verifiable SDK scope after remediation.

## Legacy Cleanup Confirmation

- `createNimiClient`: forbidden by gate and verified green via `pnpm check:no-create-nimi-client`.
- Global `OpenAPI.BASE` / `OpenAPI.TOKEN`: forbidden by gate and verified green via `pnpm check:no-global-openapi-config`.
- Legacy mod subpaths: 11 removed paths remained absent under consumer smoke verification:
  - `@nimiplatform/sdk/mod/hook`
  - `@nimiplatform/sdk/mod/runtime`
  - `@nimiplatform/sdk/mod/types`
  - `@nimiplatform/sdk/mod/logging`
  - `@nimiplatform/sdk/mod/i18n`
  - `@nimiplatform/sdk/mod/settings`
  - `@nimiplatform/sdk/mod/utils`
  - `@nimiplatform/sdk/mod/model-options`
  - `@nimiplatform/sdk/mod/runtime-route`
  - `@nimiplatform/sdk/mod/host`
  - `@nimiplatform/sdk/mod/ai`
- Legacy `TokenProvider*` public SDK naming: no runtime-facing SDK source violations found; remaining mentions are confined to guardrail/spec scripts rather than exported SDK surface.

## Gate Results

### SSOT Gate Groups

| Gate group | Rule | Status | Notes |
| --- | --- | --- | --- |
| `unit_module` | `S-GATE-010` | PASS | `pnpm --filter @nimiplatform/sdk test` passed |
| `consumer_smoke` | `S-GATE-010` | PASS | `pnpm check:sdk-consumer-smoke` passed |
| `boundary_checks` | `S-GATE-020` | PASS | all boundary hard-cut commands passed |
| `vnext_matrix` | `S-GATE-030` | PASS | `pnpm check:sdk-vnext-matrix` passed |
| `mod_scope` | `S-GATE-040` | PASS | both mod/hook hard-cut commands passed |
| `runtime_projection` | `S-GATE-050` | PASS | `pnpm check:runtime-bridge-method-drift` passed |
| `coverage` | `S-GATE-060` | PASS | thresholds exceeded |
| `provider_alignment` | `S-GATE-070` | PASS | static invariant check passed |
| `live_smoke` | `S-GATE-080` | BLOCKED_BY_ENV | no `NIMI_LIVE_*` env; matrix run did not complete |
| `version_matrix` | `S-GATE-090` | PASS | version references aligned to `0.4.4` |
| `release_parity` | `S-GATE-090` | BLOCKED_BY_ENV | depends on completed live smoke matrix |
| `spec_consistency` | `S-GATE-091` | PASS | consistency script passed |
| `docs_drift` | `S-GATE-091` | PASS | docs drift check passed |

### Executed Commands

| Command | Status | Started (UTC) | Duration |
| --- | --- | --- | --- |
| `pnpm proto:generate` | PASS | `2026-03-12T17:59:59Z` | `5s` |
| `pnpm build:sdk` | PASS | `2026-03-12T18:00:04Z` | `3s` |
| `pnpm check:sdk-import-boundary` | PASS | `2026-03-12T18:00:07Z` | `1s` |
| `pnpm check:sdk-single-package-layout` | PASS | `2026-03-12T18:00:08Z` | `0s` |
| `pnpm check:sdk-public-naming` | PASS | `2026-03-12T18:00:08Z` | `1s` |
| `pnpm check:no-create-nimi-client` | PASS | `2026-03-12T18:00:09Z` | `0s` |
| `pnpm check:no-global-openapi-config` | PASS | `2026-03-12T18:00:09Z` | `1s` |
| `pnpm check:sdk-realm-legacy-clean` | PASS | `2026-03-12T18:00:10Z` | `1s` |
| `pnpm check:reason-code-constants` | PASS | `2026-03-12T18:01:20Z` | `0s` |
| `pnpm --filter @nimiplatform/sdk test` | PASS | `2026-03-12T18:11:05Z` | `2s` |
| `pnpm check:sdk-vnext-matrix` | PASS | `2026-03-12T18:02:23Z` | `2s` |
| `pnpm check:runtime-bridge-method-drift` | PASS | `2026-03-12T18:02:25Z` | `1s` |
| `pnpm check:mods-no-runtime-sdk` | PASS | `2026-03-12T18:02:26Z` | `1s` |
| `pnpm check:runtime-mod-hook-hardcut` | PASS | `2026-03-12T18:02:27Z` | `1s` |
| `pnpm check:sdk-coverage` | PASS | `2026-03-12T18:02:28Z` | `4s` |
| `pnpm check:sdk-spec-kernel-consistency` | PASS | `2026-03-12T18:02:32Z` | `0s` |
| `pnpm check:sdk-spec-kernel-docs-drift` | PASS | `2026-03-12T18:02:32Z` | `1s` |
| `pnpm check:sdk-version-matrix` | PASS | `2026-03-12T18:09:32Z` | `1s` |
| `pnpm check:sdk-consumer-smoke` | PASS | `2026-03-12T18:09:33Z` | `29s` |
| `pnpm check:live-provider-invariants` | PASS | `2026-03-12T18:10:25Z` | `0s` |
| `node scripts/run-live-test-matrix.mjs` | BLOCKED_BY_ENV | `2026-03-12` session | no `NIMI_LIVE_*` env; child live smoke stalled and was terminated |
| `pnpm check:live-smoke-gate` | NOT_RUN | n/a | skipped because no fresh successful live matrix existed |
| `pnpm check:live-smoke-gate --require-release` | NOT_RUN | n/a | skipped because no fresh successful live matrix existed |

## Test and Coverage

- SDK test files at end of audit: `37`
  - original baseline count `35`
  - added in this audit:
    - `sdk/test/ai-provider/provider-multimodal.test.ts`
    - `sdk/test/runtime/runtime-multimodal-helpers.test.ts`
- Full SDK test run: `396 pass / 0 fail / 0 skipped`
- Coverage from `pnpm check:sdk-coverage`:
  - lines: `94.99%`
  - branches: `84.86%`
  - functions: `95.71%`

## Dependency Hygiene

Current SDK runtime dependencies and observed usage:

| Dependency | Status | Observed usage |
| --- | --- | --- |
| `@ai-sdk/provider` | OK | ai-provider facade and model factories |
| `@grpc/grpc-js` | OK | node gRPC transport + integration tests |
| `@protobuf-ts/runtime` | OK | generated runtime bindings |
| `@protobuf-ts/runtime-rpc` | OK | generated RPC bindings |
| `openapi-fetch` | OK | realm client transport |
| `i18next` | OK | mod i18n surface |
| `react-i18next` | OK | mod i18n surface |

Note: `i18next` / `react-i18next` remain mod-surface dependencies; this is acceptable within the current single-package layout.

## Release Readiness

Verdict: `NOT RELEASE READY (ENV-BLOCKED)`

Rationale:

- All local SDK gates required for source, contract, coverage, version, and consumer validation are green.
- The original build regression caused by partial `ChatMessage.parts` migration has been fixed.
- Static live-provider invariants are green.
- Full release certification is still blocked because live smoke / release parity were not completed in this session:
  - `NO_NIMI_LIVE_ENV`
  - `run-live-test-matrix.mjs` did not converge and was terminated

If live environment variables and a stable runtime daemon are provided, the remaining release blocker is to rerun:

1. `node scripts/run-live-test-matrix.mjs`
2. `pnpm check:live-smoke-gate`
3. `pnpm check:live-smoke-gate --require-release`
