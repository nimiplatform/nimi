# Runtime Refactor Audit

Generated: 2026-03-13
Scope: `nimi/runtime`
Method: spec hard-cut against `spec/runtime/kernel/**`, runtime-only implementation and verification

## 1. Baseline Metrics

| Metric | Result |
| --- | --- |
| Implementation LOC | `56,693` |
| Test LOC | `34,886` |
| Test / Impl Ratio | `0.62` |
| Runtime services implemented | `10 / 10` |
| Compliance after refactor | `63 / 63` passing |

Notes:

- LOC excludes generated code under `runtime/gen/**`.
- Compliance expanded from `58` items to `63` items with no regression.
- Runtime verification passed: `go build ./...`, `go vet ./...`, `go test ./... -count=1`, `go run ./cmd/runtime-compliance --gate`.

## 2. Kernel Rule Compliance Matrix

| Domain | Rules | Status | Notes |
| --- | ---: | --- | --- |
| `app-messaging-contract.md` | 8 | PASS | `K-APP-002` optional fields aligned; `K-APP-005` payload size, session auth, rate limit, loop detection hard-cut implemented. |
| `audit-contract.md` | 21 | PASS | `K-AUDIT-009` sequence now starts from `0`; streaming subscriptions now enforce bounded backpressure closure. |
| `auth-service.md` | 13 | PASS | Existing coverage retained; app session validation added without widening contract surface. |
| `authn-token-validation.md` | 9 | PASS | Existing session and token validation rules remain green. |
| `authz-ownership.md` | 7 | PASS | No gap introduced in this refactor. |
| `cli-onboarding-contract.md` | 16 | PASS | `nimi app send` now carries app session metadata and accepts optional `subject_user_id` / `message_type`. |
| `config-contract.md` | 17 | PASS | Static/runtime baseline unchanged. |
| `connector-contract.md` | 15 | PASS | Static/runtime baseline unchanged. |
| `daemon-lifecycle.md` | 10 | PASS | Static/runtime baseline unchanged. |
| `delivery-gates-contract.md` | 10 | PASS | Static governance rules; enforced by gate scripts rather than service-specific code changes. |
| `device-profile-contract.md` | 9 | PASS | Static/runtime baseline unchanged. |
| `endpoint-security.md` | 5 | PASS | App messaging auth path tightened through dedicated session metadata validation. |
| `error-model.md` | 10 | PASS | New reason codes added and mapped; knowledge/app error semantics now align with gRPC status behavior. |
| `grant-service.md` | 13 | PASS | Static/runtime baseline unchanged. |
| `key-source-routing.md` | 11 | PASS | Static/runtime baseline unchanged. |
| `knowledge-contract.md` | 7 | PASS | Existing-index build now returns `ALREADY_EXISTS`; missing-index search now returns empty results per `K-KNOW-005`. |
| `local-category-capability.md` | 30 | PASS | Static/runtime baseline unchanged. |
| `local-engine-contract.md` | 11 | PASS | Static/runtime baseline unchanged. |
| `model-catalog-contract.md` | 27 | PASS | Static/runtime baseline unchanged. |
| `model-service-contract.md` | 8 | PASS | `K-MODEL-008` state machine enforced: `PULLING -> INSTALLED`, legal transitions only, guarded removal. |
| `multimodal-provider-contract.md` | 30 | PASS | Static/runtime baseline unchanged. |
| `nimillm-contract.md` | 10 | PASS | Static/runtime baseline unchanged. |
| `pagination-filtering.md` | 6 | PASS | Static/runtime baseline unchanged. |
| `proto-governance-contract.md` | 10 | PASS | Proto chain passed after enum extension and regeneration. |
| `provider-health-contract.md` | 6 | PASS | Audit provider-health stream now uses explicit backpressure budgeting. |
| `rpc-surface.md` | 14 | PASS | Generated RPC surface remains aligned after proto regeneration. |
| `scenario-job-lifecycle.md` | 6 | PASS | Existing baseline unchanged. |
| `streaming-contract.md` | 13 | PASS | `K-STREAM-011/012/013` now have explicit queue budgets, deterministic slow-consumer shutdown, and terminal-event retention. |
| `voice-contract.md` | 13 | PASS | Static/runtime baseline unchanged. |
| `workflow-contract.md` | 12 | PASS | Workflow streaming now preserves terminal events under pressure and closes deterministically on sustained overload. |

Matrix summary:

- Critical refactor targets are now PASS: `K-APP-002`, `K-APP-005`, `K-AUDIT-009`, `K-MODEL-008`, `K-KNOW-002`, `K-KNOW-003`, `K-KNOW-005`, `K-STREAM-011`, `K-STREAM-012`, `K-STREAM-013`.
- Governance-only domains such as delivery gates, proto governance, and parts of RPC surface remain enforced primarily by static gates; they are still PASS for this runtime release candidate.
- No targeted runtime rule in this refactor remains in `gap` state.

## 3. Gap Analysis Summary

### Critical gaps fixed

| Fix | Result |
| --- | --- |
| Fix-0 | Added `APP_MESSAGE_PAYLOAD_TOO_LARGE=550`, `APP_MESSAGE_RATE_LIMITED=551`, `APP_MESSAGE_LOOP_DETECTED=552`; regenerated runtime and SDK artifacts. |
| Fix-1 | Hard-cut `RuntimeAppService` security baseline: optional field alignment, dedicated app session metadata, payload limit, rate limiting, pair loop breaker, and deterministic slow-consumer stream shutdown. |
| Fix-2 | `ExportAuditEvents.Sequence` now starts at `0`, matching `K-AUDIT-009`. |
| Fix-3 | `RuntimeModelService` now enforces spec transitions and observable `PULLING` intermediate state before `INSTALLED`. |
| Fix-4 | `RuntimeKnowledgeService` now uses spec-aligned gRPC semantics for duplicate build and missing-index search. |
| Fix-5 | Added shared `streamutil.Relay` and moved app, audit, and workflow server-streaming paths to explicit backpressure budgets and deterministic close behavior. |

### Phase 2 deferred items

- No item from the targeted Fix-0 through Fix-5 set remains deferred.
- Broader non-runtime evidence, such as desktop context-budget hygiene or release-environment live smoke proof, remains outside this runtime hard-cut and is tracked separately.

### Not applicable in this pass

- No legacy compatibility shim was added for old app auth or stream behavior.
- Governance-only rules do not require additional runtime behavior code beyond the static gates already executed.

## 4. Legacy Code Audit

Removed or hard-cut:

- Removed `subject_user_id` / `message_type` from `SendAppMessage` required-field validation.
- Removed security-failure fallback that returned `accepted=false`; these paths now return explicit gRPC status errors.
- Replaced blocking or silent-drop-only server-stream fan-out paths with bounded relay queues and deterministic close behavior.

Retained with reason:

- Draft services already in the runtime surface (`App`, `Knowledge`, `Model`, `Workflow`) were retained because they are part of the published kernel contract.
- Generated files under runtime and SDK were refreshed through the proto generation chain rather than manually edited.

Legacy verdict:

- No new compatibility shell, shim, or downstream workaround was introduced.
- This refactor is a hard cut, not a compatibility layer.

## 5. Test Coverage Delta

| Area | Delta |
| --- | --- |
| New targeted regression tests | `16` |
| Compliance checklist size | `58 -> 63` |
| Compliance pass rate | `100% -> 100%` |
| Runtime gate status | `go build`, `go vet`, `go test`, compliance gate all PASS |

Representative new tests:

- `TestSendAppMessageOptionalFields`
- `TestSendAppMessageRejectsOversizedPayload`
- `TestSendAppMessageRateLimitEnforced`
- `TestSendAppMessageLoopDetected`
- `TestSendAppMessageRequiresRegisteredAppSession`
- `TestSubscribeAppMessagesSlowConsumerClosed`
- `TestExportAuditEventsSequenceStartsFromZero`
- `TestSubscribeAIProviderHealthEventsSlowConsumerClosed`
- `TestSubscribeRuntimeHealthEventsSlowConsumerClosed`
- `TestPullModelTransitionsThroughPullingState`
- `TestModelStatusTransitionsMatchSpec`
- `TestRemoveModelRejectsIllegalSourceState`
- `TestBuildIndexExistingNoOverwriteReasonCode`
- `TestSearchIndexNotFoundReturnsEmpty`
- `TestStreamBackpressureCloses`
- `TestSubscribeWorkflowEventsTerminalEventPriority`

## 6. Release Readiness Verdict

### G0-G7 gate results

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 `ssot_freeze` | PASS | `pnpm generate:runtime-spec-kernel-docs`, `pnpm check:runtime-spec-kernel-consistency`, `pnpm check:runtime-spec-kernel-docs-drift` |
| G1 `proto_chain` | PASS | `pnpm proto:lint`, `pnpm proto:generate`, `pnpm proto:breaking`, `pnpm proto:drift-check` |
| G2 `runtime_build` | PASS | `cd runtime && go build ./...`, `cd runtime && go vet ./...` |
| G3 `runtime_tests` | PASS | `cd runtime && go test ./... -count=1`, `pnpm check:runtime-go-coverage`, `pnpm check:runtime-ai-scenario-coverage` |
| G4 `compliance` | PASS | `cd runtime && go run ./cmd/runtime-compliance --gate` -> `63/63` |
| G5 `legacy_hardcut` | PASS | No compatibility shim added; app auth and streaming behavior were hard-cut to spec semantics. |
| G6 `stream_safety` | PASS | App, audit, workflow, and shared relay tests cover bounded backpressure and terminal delivery semantics. |
| G7 `monorepo_guardrails` | BLOCKED | `pnpm check:ai-context-budget` fails on unrelated desktop file `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts`. Other repo guardrails passed. |

### Blocking items

- Monorepo release proof is still blocked by the unrelated desktop context-budget violation above.
- No runtime-layer blocker remains for the targeted spec alignment scope.

### Final recommendation

Runtime verdict: READY FOR RUNTIME MERGE.

Monorepo verdict: NOT READY FOR FULL RELEASE until the unrelated desktop `ai-context-budget` failure is cleared.
