# Commit `7c64b31` Finding Closure Report

Date: 2026-03-11

## Summary

This report closes the four audit findings raised against local commit `7c64b3106b5ed76f5ccaabbd53b49d0a44339a45`.

Result:

- `Finding 1 / SDK semver`: closed
- `Finding 2 / live-smoke gate blind spot`: closed
- `Finding 3 / D-OFFLINE evidence overstated`: closed
- `Finding 4 / D-TEL evidence overstated`: closed

Current release posture:

- `B / 准发布`
- Release-only live gates were not re-run in this iteration, so this change is not marked `A / 发布就绪`.
- A subsequent `pnpm check:live-smoke-gate --require-release` run confirms the repository remains below `A` with the current live coverage report.

## Closure Matrix

### Finding 1

- Finding: patch bump hid breaking public SDK runtime type removals.
- Closure:
  - bumped [`sdk/package.json`](/Users/snwozy/nimi-realm/nimi/sdk/package.json) from `0.1.15` to `0.2.0`
  - added a conservative runtime public-surface guard in [`scripts/check-sdk-version-matrix.mjs`](/Users/snwozy/nimi-realm/nimi/scripts/check-sdk-version-matrix.mjs)
- Result:
  - breaking runtime surface edits now require a `major.minor` bump
  - no compatibility shim was reintroduced

### Finding 2

- Finding: `live-smoke gate` could miss provider-only edits in runtime/SDK smoke files.
- Closure:
  - removed the changed-line inference exclusion in [`scripts/check-live-smoke-gate.mjs`](/Users/snwozy/nimi-realm/nimi/scripts/check-live-smoke-gate.mjs)
  - added fail-close behavior for smoke-file edits that cannot infer a provider
  - added regression coverage in [`scripts/check-live-smoke-gate.test.mjs`](/Users/snwozy/nimi-realm/nimi/scripts/check-live-smoke-gate.test.mjs)
  - added command [`package.json`](/Users/snwozy/nimi-realm/nimi/package.json) `check:live-smoke-gate-regression`
- Result:
  - provider-targeted smoke edits are now detected from changed lines
  - provider-ambiguous smoke edits now block instead of silently passing

### Finding 3

- Finding: `D-OFFLINE-004/005` evidence was stronger than the tests behind it.
- Closure:
  - made `OfflineCoordinator` timer scheduling injectable in [`apps/desktop/src/runtime/offline/coordinator.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/runtime/offline/coordinator.ts)
  - extracted reconnect side-effect binding helper in [`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-offline.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-offline.ts)
  - wired production bootstrap through that helper in [`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts)
  - replaced scan-only reconnect tests with behavioral tests in [`apps/desktop/test/offline-reconnect-strategy.test.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/test/offline-reconnect-strategy.test.ts)
  - replaced cache-limit/source-scan checks with behavioral cache coverage in [`apps/desktop/test/offline-outbox-manager.test.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/test/offline-outbox-manager.test.ts)
  - added LWW conflict coverage in [`apps/desktop/test/chat-realtime-cache.test.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/test/chat-realtime-cache.test.ts) and tightened the merge/update logic in [`apps/desktop/src/shell/renderer/features/realtime/chat-realtime-cache.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/features/realtime/chat-realtime-cache.ts)
- Result:
  - `D-OFFLINE-004` now has direct behavioral proof for reconnect backoff, reconnect side effects, and stale replay rejection
  - `D-OFFLINE-005` now has direct behavioral proof for memory fallback cache limits and metadata cache round-trips

### Finding 4

- Finding: `D-TEL-004/005` evidence relied on source scans and inline replicas.
- Closure:
  - enabled test-time renderer env override in [`apps/desktop/src/shell/renderer/bridge/runtime-bridge/env.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/bridge/runtime-bridge/env.ts)
  - added renderer telemetry test hooks in [`apps/desktop/src/shell/renderer/bridge/runtime-bridge/logging.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/bridge/runtime-bridge/logging.ts)
  - aligned `invoke-start` log level with the telemetry contract in [`apps/desktop/src/shell/renderer/bridge/runtime-bridge/invoke.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/bridge/runtime-bridge/invoke.ts)
  - replaced scan-only telemetry tests with behavioral tests in [`apps/desktop/test/telemetry-log-format.test.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/test/telemetry-log-format.test.ts)
- Result:
  - `D-TEL-004` now executes the real `createRendererFlowId()` implementation
  - `D-TEL-005` now executes the real `invoke()` path and asserts start/success/fail traces, stable `invokeId`, `sessionTraceId`, and structured failure fields

## Verification

Executed and passing:

- `pnpm check:live-smoke-gate-regression`
- `pnpm check:sdk-version-matrix`
- `pnpm check:sdk-consumer-smoke`
- `pnpm check:sdk-coverage`
- `pnpm --filter @nimiplatform/sdk test`
- `pnpm --filter @nimiplatform/desktop test`
- `pnpm check:sdk-spec-kernel-consistency`
- `pnpm check:sdk-spec-kernel-docs-drift`
- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`

Not executed in this iteration:

- `node scripts/run-live-test-matrix.mjs`

Executed later and failing as expected for release-hard-block:

- `pnpm check:live-smoke-gate --require-release`

Release-hard-block result summary:

- live report still contains broad `skipped` coverage across runtime/sdk providers
- provider failures remain in the current live report for `stepfun`, `elevenlabs`, and `dashscope`
- gold-path release evidence is still missing: `gold_path:dashscope:missing_fixture_records`

## Notes

- [`spec/desktop/kernel/tables/rule-evidence.yaml`](/Users/snwozy/nimi-realm/nimi/spec/desktop/kernel/tables/rule-evidence.yaml) was left semantically unchanged because the rules remain `covered`; the gap was in proof quality, which is now addressed by real behavioral tests.
- Pre-existing unrelated worktree change in [`apps/desktop/src-tauri/src/runtime_bridge/generated/nimi.runtime.v1.rs`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src-tauri/src/runtime_bridge/generated/nimi.runtime.v1.rs) was not modified by this closure work.
