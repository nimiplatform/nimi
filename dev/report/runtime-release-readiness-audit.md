# Runtime Release Readiness Audit

Generated: 2026-03-12

## 1. Gate Status

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 `ssot_freeze` | PASS | `pnpm check:ai-scenario-hardcut-drift`, `pnpm check:runtime-spec-kernel-consistency`, `pnpm check:runtime-spec-kernel-docs-drift` |
| G1 `proto_chain` | PASS | `pnpm proto:lint`, `pnpm proto:breaking`, `pnpm proto:generate`, `pnpm proto:drift-check`, `pnpm check:runtime-proto-spec-linkage` |
| G2 `sdk_alignment` | FAIL | `pnpm check:runtime-mod-hook-hardcut` failed on pre-existing cross-layer hard-cut drift in `spec/sdk/kernel/mod-contract.md`, `spec/desktop/kernel/codegen-contract.md`, `spec/desktop/kernel/tables/codegen-import-allowlist.yaml`, `apps/desktop/src/runtime/mod/codegen/preflight.ts` |
| G3 `provider_coverage` | PASS | `pnpm check:runtime-go-coverage`, `pnpm check:runtime-ai-scenario-coverage`, `pnpm check:live-provider-invariants`, `pnpm check:runtime-catalog-drift`, `pnpm check:runtime-provider-activation-alignment`, `pnpm check:runtime-provider-alias-hardcut`, `pnpm check:runtime-provider-capability-token-canonicalization`, `pnpm check:runtime-provider-endpoint-ssot`, `pnpm check:runtime-provider-yaml-first-hardcut`, `pnpm check:runtime-video-capability-block-enforcement`, `pnpm check:no-legacy-cloud-provider-keys` |
| G4 `workflow_async` | PASS | `cd runtime && go test ./internal/services/ai/ -run Test.*ScenarioJob -count=1` |
| G5 `matrix_tests` | NOT_MET | `node scripts/run-live-test-matrix.mjs` did not complete within the local timeout window after entering runtime live smoke execution, so no passing evidence was produced |
| G6 `observability` | PASS | `cd runtime && go run ./cmd/runtime-compliance --gate` -> `48/48` passed |
| G7 `release_candidate` | FAIL | `pnpm check:live-smoke-gate --require-release` failed because required release providers were skipped in the current environment |

Supplemental runtime checks all passed:

- `cd runtime && go build ./...`
- `cd runtime && go vet ./...`
- `cd runtime && go test ./...`

## 2. Rule Coverage

Coverage summary for `spec/runtime/kernel/tables/rule-evidence.yaml`:

- `runtime_test_gate`: `317/376`
- static-only META rules: `34/376`
- remaining non-test gaps: `25/376`

Static-only META rules retained by design:

- `K-GATE-001/010/020/030/040/050/060/070/080/090`: delivery gate definitions and evidence routing
- `K-PROTO-001..010`: proto governance
- `K-RPC-001..014`: RPC surface and mapping authority

Remaining non-test gaps and rationale:

- `K-APP-005/006/006a/007`: Phase 2 or deferred app messaging rules, intentionally outside this Phase 1 runtime hard-cut
- `K-AUDIT-019/020`: cross-layer correlation query and propagation boundaries require SDK/Desktop evidence, not runtime-only tests
- `K-AUTH-006`: ScenarioJob owner semantics are not explicitly mapped by a dedicated runtime test in this pass
- `K-AUTHN-006`: current Realm JWT validator has no session-domain revocation hook; proving this rule would require new architecture, not a narrow test addition
- `K-AUTHSVC-001/002/003/005/008/009`: service responsibility, method authority, revoke idempotence, AuthN coupling, and app-mode domain/scope semantics remain structural or cross-module
- `K-CFG-014/016/017`: migration framework, backup/drift boundary, and field-authority rules are structural/spec-governance rules
- `K-GRANT-001/002`: service responsibility and method set are structural authority rules
- `K-STREAM-005/008/010`: stream close-mode taxonomy and long-lived subscription classification remain static/proto-backed
- `K-STREAM-011/012/013`: architecture-level backpressure and resume rules remain non-Phase-1 behavior gates

## 3. Service Coverage

`pnpm check:runtime-go-coverage` result:

| Service | Statements |
| --- | --- |
| `internal/services/ai` | `71.6%` |
| `internal/services/app` | `86.1%` |
| `internal/services/audit` | `78.5%` |
| `internal/services/auth` | `78.0%` |
| `internal/services/connector` | `74.6%` |
| `internal/services/grant` | `73.9%` |
| `internal/services/knowledge` | `70.5%` |
| `internal/services/localservice` | `69.2%` |
| `internal/services/model` | `88.9%` |
| `internal/services/workflow` | `70.4%` |
| Total | `71.5%` |

`pnpm check:runtime-ai-scenario-coverage` result:

- AI statements coverage: `71.6%`
- `SubmitScenarioJob`: `87.5%`
- `GetScenarioJob`: `100.0%`
- `CancelScenarioJob`: `83.3%`
- `SubscribeScenarioJobEvents`: `81.6%`
- `GetScenarioArtifacts`: `88.9%`

## 4. Legacy Code Status

- `proto/runtime/v1/local_runtime.proto`
  - `SearchCatalogModelsRequest.limit` removed and reserved
  - `ListLocalAuditsRequest.limit` removed and reserved
- `runtime/internal/services/localservice/service_audit_state.go`
  - legacy `GetLimit()` fallback removed
- `runtime/internal/services/localservice/service_model_list.go`
  - all `GetLimit()` fallback logic removed; `page_size` is the only supported pagination input
- `runtime/proto/runtime-v1.baseline.binpb`
  - refreshed so `proto:breaking` now validates the new hard-cut contract as the active baseline

## 5. Risk Assessment

- Critical: none in the runtime layer after this refactor
- High: G2 is still blocked by unrelated runtime-mod-hook hard-cut drift outside `runtime/**`
- High: G7 release smoke gate fails because required release live-provider evidence is missing in the current environment
- Medium: G5 live matrix has no passing evidence in this run; release gate remains incomplete
- Medium: the `limit` -> `page_size` hard-cut is a deliberate wire break and requires downstream generated client updates
- Medium: `K-AUTHN-006` remains an acknowledged architectural gap rather than a runtime regression
- Low: remaining no-test rules are deferred, structural, or cross-layer by design

## 6. Release Readiness Verdict

**NOT READY**

Runtime code convergence is complete for this pass:

- legacy proto fields were hard-cut and reserved
- `GetLimit()` compatibility code was removed
- grant scope-prefix and revoked-scope behavior now matches the runtime kernel contract
- speech streaming now enforces first-packet timeout behavior
- runtime/spec/provider/coverage/compliance gates in the runtime layer are green

Release readiness is still blocked by gate status outside the narrowed runtime code path:

- G2 failed on unrelated cross-layer hard-cut drift
- G5 produced no passing live-matrix evidence
- G7 failed because release live-smoke coverage is skipped for required providers in the current environment
