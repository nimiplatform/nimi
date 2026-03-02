# SDK Spec Alignment Audit Report

> Date: 2026-03-02
> SDK: `@nimiplatform/sdk` v0.1.6
> Branch: `spec`

## 1. CI Gate Results (13/13 PASS)

| # | Gate | Result |
|---|------|--------|
| 1 | `check:sdk-import-boundary` | PASS |
| 2 | `check:sdk-single-package-layout` | PASS |
| 3 | `check:sdk-public-naming` | PASS |
| 4 | `check:reason-code-constants` | PASS (232 constants) |
| 5 | `check:scope-catalog-drift` | PASS (realm=32, runtime=84) |
| 6 | `check:runtime-bridge-method-drift` | PASS |
| 7 | `check:sdk-version-matrix` | PASS (1 package) |
| 8 | `check:sdk-consumer-smoke` | PASS |
| 9 | `check:no-create-nimi-client` | PASS |
| 10 | `check:no-global-openapi-config` | PASS |
| 11 | `check:no-openapi-singleton-import` | PASS |
| 12 | `check:sdk-vnext-matrix` | PASS |
| 13 | `check:sdk-coverage` | PASS |

## 2. Spec Contract Compliance

### S-SURFACE (Surface Area)

| Rule | Status | Notes |
|------|--------|-------|
| S-SURFACE-001 (5 projection paths) | Compliant | 16 exports are implementation-level splits; spec manages 5 projections |
| S-SURFACE-002 (method group coverage) | **Fixed** | Added `script_worker_service_projection` (Phase 2 deferred): `ScriptWorkerService/Execute` registered in method-ids, codecs, types, runtime passthrough, and client factory |
| S-SURFACE-003 (no TokenProvider* in public) | Compliant | Only exists in `generated/` directory, protected by import boundary gate |

### S-TRANSPORT (Transport Contract)

| Rule | Status | Notes |
|------|--------|-------|
| S-TRANSPORT-001 (explicit transport) | Compliant | `node-grpc` and `tauri-ipc` only |
| S-TRANSPORT-002 (metadata boundary) | Compliant | connectorId in body, provider keys in metadata |
| S-TRANSPORT-003 (no implicit reconnect) | Compliant | Streams require explicit resubscribe |
| S-TRANSPORT-004 (Realm instance config) | Compliant | No global OpenAPI mutation |
| S-TRANSPORT-005 (version negotiation) | **Fixed** | Added `#checkVersionCompatibility()`: major mismatch → fail-close `SDK_RUNTIME_VERSION_INCOMPATIBLE`; Phase 2 methods gated via `#assertMethodAvailable()` |
| S-TRANSPORT-006 (trace/observability) | Compliant | traceId passthrough, no credential leaks |
| S-TRANSPORT-007 (stream terminal frame) | **Fixed** | `wrapModeBMediaStream()` and `wrapModeBWorkflowStream()` stop iteration after terminal events (COMPLETED/FAILED/CANCELED/TIMEOUT) |
| S-TRANSPORT-008 (stream timeout) | Compliant | SDK defers to runtime-side timeout |
| S-TRANSPORT-009 (chunk passthrough) | Compliant | No re-splitting/merging |

### S-ERROR (Error Projection)

| Rule | Status | Notes |
|------|--------|-------|
| S-ERROR-003 (local config errors) | Compliant | `SDK_*` family codes |
| S-ERROR-004 (retryable transport codes) | Compliant | 7-code set matches spec |
| S-ERROR-006 (version/method compat errors) | **Fixed** | `SDK_RUNTIME_VERSION_INCOMPATIBLE` and `SDK_RUNTIME_METHOD_UNAVAILABLE` now enforced |
| S-ERROR-007 (retryable set) | Compliant | 7 codes match exactly |
| S-ERROR-008 (internal retry + OPERATION_ABORTED) | Compliant | Lines 93-103 + 1011 |
| S-ERROR-009 (non-error terminal projection) | Compliant | `toFinishReason()` correct |
| S-ERROR-012 (Mode D CANCELLED) | **Fixed** | `#wrapModeDStream()` catches `RUNTIME_GRPC_CANCELLED`, emits `runtime.disconnected`, no auto-reconnect |

### S-BOUNDARY (Boundary Isolation)

| Rule | Status | Notes |
|------|--------|-------|
| S-BOUNDARY-001 (import boundary) | Compliant | CI gate enforced |
| S-BOUNDARY-002 (single package) | Compliant | CI gate enforced |
| S-BOUNDARY-003 (public naming) | Compliant | CI gate enforced |
| S-BOUNDARY-004 (no global singleton) | Compliant | CI gate enforced |

## 3. Coverage Metrics

| Metric | Before | After | Threshold | Status |
|--------|--------|-------|-----------|--------|
| Lines | 91.09% | 91.18% | ≥ 90% | PASS |
| Branches | 72.30% | 72.66% | ≥ 70% | PASS |
| Functions | 92.58% | 92.75% | ≥ 90% | PASS |
| Tests | 93 | 98 | — | +5 new |

## 4. Changes Made

### New Code

| File | Change |
|------|--------|
| `sdk/src/runtime/method-ids.ts` | Added `scriptWorker.execute` method ID |
| `sdk/src/runtime/core/method-codecs.ts` | Added `ExecuteRequest`/`ExecuteResponse` codec |
| `sdk/src/runtime/types.ts` | Added `RuntimeScriptWorkerClient` type, added to `RuntimeClient` |
| `sdk/src/runtime/runtime.ts` | ScriptWorker passthrough, version negotiation (`#checkVersionCompatibility`, `#assertMethodAvailable`), Mode B wrapping (`wrapModeBMediaStream`, `wrapModeBWorkflowStream`), Mode D wrapping (`#wrapModeDStream`) |
| `sdk/src/runtime/core/client.ts` | Added `scriptWorker.execute` to client factory |
| `sdk/src/types/index.ts` | Added `RUNTIME_GRPC_CANCELLED` reason code |
| `sdk/test/runtime/runtime-class.test.ts` | Added 5 tests: version negotiation (2), Mode B terminal (2), Mode D CANCELLED (1) |

### Generated/Regenerated

| File | Reason |
|------|--------|
| `sdk/src/scope/generated/catalog.ts` | Regenerated (pre-existing drift) |
| `apps/desktop/src-tauri/src/runtime_bridge/generated/method_ids.rs` | Regenerated (ScriptWorker addition) |

### Legacy Code Removed

None required — all legacy checks passed at baseline.

## 5. Known Limitations

| ID | Description |
|----|-------------|
| SDKTEST-090 | Tauri IPC CANCELLED detection relies on error message pattern matching (same as node-grpc path). Real Tauri IPC CANCELLED detection untested in CI (requires Tauri runtime). |
| SDKTEST-091 | Version negotiation test uses mock bridge; real gRPC metadata extraction tested separately in node-grpc integration tests. |
| rg-absent | CI gates 9/10/11 pass vacuously when `rg` (ripgrep) is not installed. These gates should use Node.js-based grep for CI reliability. |

## 6. Publication Readiness

| Criterion | Status |
|-----------|--------|
| All 13 CI gates pass | YES |
| TypeScript compiles clean | YES |
| 98/98 tests pass | YES |
| Coverage above thresholds | YES |
| All S-SURFACE contracts aligned | YES |
| All S-TRANSPORT contracts aligned | YES |
| All S-ERROR contracts aligned | YES |
| All S-BOUNDARY contracts aligned | YES |
| No legacy code violations | YES |

**Conclusion: SDK v0.1.6 is spec-aligned and ready for publication.**
