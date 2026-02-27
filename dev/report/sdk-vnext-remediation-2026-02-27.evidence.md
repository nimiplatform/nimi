# SDK vNext Remediation Evidence (2026-02-27)

## Scope

This report records implementation and verification evidence for the P0 remediation set:

1. Realm generation stack migration to `openapi-typescript + openapi-fetch` and singleton removal.
2. Runtime retry/reconnect semantics and `AUTH_CONTEXT_MISSING` alignment.
3. Repository-wide OpenAPI singleton governance gates.
4. Desktop migration off `OpenAPI` singleton and `openApiRequest`.
5. Reproducible `desktop-mods-smoke` hard gate.

## Key implementation outcomes

### 1) Realm generation/runtime client

- `scripts/generate-realm-sdk.mjs` now generates:
  - `sdk/src/realm/generated/schema.ts` (openapi-typescript)
  - `sdk/src/realm/generated/operation-map.ts`
  - `sdk/src/realm/generated/service-registry.ts`
- Runtime Realm client migrated to instance-based `openapi-fetch`:
  - `sdk/src/realm/client.ts`
  - `sdk/src/realm/client-types.ts`
- Legacy generated core/services files removed from active path; no global `OpenAPI` runtime dependency.

### 2) Runtime retry/auth context

- `ReasonCode.AUTH_CONTEXT_MISSING` is present and used for missing auth context in runtime path.
- Runtime class retry behavior verified by SDK tests (auto retry success, non-retryable no retry, manual mode no implicit reconnect).

### 3) OpenAPI singleton governance

- Added/enforced root checks:
  - `check:no-openapi-base-assignment`
  - `check:no-openapi-token-assignment`
  - `check:no-openapi-singleton-import`
- These checks scan `sdk apps docs/examples scripts`.

### 4) Desktop singleton removal

- Removed OpenAPI singleton usage from bootstrap data capability pipeline:
  - `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/core-capabilities.ts`
  - `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/creator-capabilities.ts`
  - `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/world-capabilities.ts`
  - `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/shared.ts`
- Context execution now provides instance `Realm` to task callbacks:
  - `apps/desktop/src/runtime/context/openapi-context.ts`
- DataSync and related flows updated to realm-instance call shape.

### 5) Desktop smoke reproducibility

- `scripts/check-desktop-mods-smoke.mjs` supports local reproducible defaults:
  - auto-detects `${repo}/nimi-mods`
  - auto-sets `NIMI_MODS_ROOT` and `NIMI_RUNTIME_MODS_DIR`
  - default hard gate: `local-chat`
  - optional `--all` for full mods smoke

## Verification commands and results

All commands below completed successfully in this run:

1. `pnpm --filter @nimiplatform/sdk lint`
2. `pnpm --filter @nimiplatform/sdk test`
3. `pnpm check:sdk-coverage`
4. `pnpm check:sdk-consumer-smoke`
5. `pnpm check:no-create-nimi-client`
6. `pnpm check:no-openapi-base-assignment`
7. `pnpm check:no-openapi-token-assignment`
8. `pnpm check:no-openapi-singleton-import`
9. `pnpm check:desktop-mods-smoke`
10. `pnpm lint`

Additional confirmations:

- `pnpm --filter @nimiplatform/desktop lint` passed.
- `pnpm check:reason-code-constants` passed.
- `pnpm check:scope-catalog-drift` passed.

## Notes

- `sdk/src/realm/index.ts` facade now avoids legacy public symbol exports (`Auth2faVerifyDto`, `Me2faVerifyDto`, `Me2faPrepareResponseDto`) while retaining normalized aliases (`AuthTwoFactorVerifyInput`, `MeTwoFactorVerifyInput`, `MeTwoFactorPrepareOutput`) and required normalized service symbols.
- `docs/error-codes.md` now includes `AUTH_CONTEXT_MISSING`.

## Follow-up sync (same day)

- `scripts/generate-realm-sdk.mjs` and `sdk/src/realm/generated/service-registry.ts` were synchronized so generated template and generated output use the same typed service-registry model.
- `RealmOperationParameterIn` import was aligned in generated registry typing path.
- `realm.services` method typing now uses operation-aware argument tuples (required path first; optional query tail), removing permissive `...args: any[]` from public method signatures.
- operation parameter metadata now includes `valueType`, and generated tuple inference maps argument positions to string/number/boolean (and array variants) for compile-time validation.
- added compile-time guards for representative mixed path/query operations (`listMessages`, `syncChatEvents`, `worldControllerGetWorldLevelAudits`) to prevent path/query ordering regressions.
- `sdk/src/realm/index.ts` naming-normalized service exports now use concrete service aliases (`MeTwoFactorService`, `SocialDefaultVisibilityService`, `SocialAttributesService`) instead of broad `RealmServiceHandle`.
- realm schema post-process changed from direct `operations["..."] -> unknown` replacement to normalized `operations` index-signature interface, preventing duplicate operationId compile errors while preserving stable generated output.
- realm model generation moved to script-owned deterministic generation from `components.schemas` (clean + regenerate), replacing prior “keep existing models and header-normalize only” behavior.
- realm timeout/abort semantics aligned:
  - timeout now maps to `REALM_UNAVAILABLE` with `actionHint=retry_after_backoff` and `details.timeoutMs`.
  - external abort signal maps to `OPERATION_ABORTED`.
- added `ReasonCode.CONFIG_INVALID` and mapped Realm default HTTP `400/422 -> CONFIG_INVALID` when no server reasonCode is provided.
- desktop compatibility updates completed for stricter generated DTOs:
  - chat payload casts for `Record<string, never>` payload fields.
  - oauth login-state checks switched to generated enum constants (`OAuthLoginState.BLOCKED`, `OAuthLoginState.NEEDS_2FA`, `OAuthLoginState.NEEDS_ONBOARDING`).
  - notification gifts payload now provides required fields (`acceptedRejected`, `paymentFailed`, `refunds`).
- new realm tests added:
  - `422 -> CONFIG_INVALID`
  - timeout -> `REALM_UNAVAILABLE`
  - external abort -> `OPERATION_ABORTED`
- Re-validated after sync:
  1. `pnpm --filter @nimiplatform/sdk lint`
  2. `pnpm --filter @nimiplatform/sdk test`
  3. `pnpm check:sdk-coverage`
  4. `pnpm check:sdk-consumer-smoke`
  5. `pnpm check:desktop-mods-smoke`
  6. `pnpm lint`

## vNext closure updates (plan completion)

### CI and release hard gates

- CI `core-static` now enforces:
  - `pnpm check:no-create-nimi-client`
  - `pnpm check:no-global-openapi-config`
  - `pnpm check:no-openapi-singleton-import`
- CI `sdk-quality` now enforces:
  - `pnpm check:sdk-vnext-matrix`
- Release `release-sdk` now enforces the same sdk-vNext closure gates before publish:
  - no legacy entry (`createNimiClient`)
  - no global OpenAPI singleton config/import
  - `sdk-vnext` matrix verification

### New vNext matrix script

- Added `scripts/check-sdk-vnext-matrix.mjs` and `package.json` script:
  - `pnpm check:sdk-vnext-matrix`
- The gate runs fixed suites:
  1. `sdk/test/runtime/runtime-bridge-method-parity.test.ts`
  2. `sdk/test/realm/realm-client.test.ts`
  3. `sdk/test/scope/module.test.ts`
  4. `sdk/test/ai-provider/provider.test.ts`
  5. `sdk/test/mod/mod-runtime-context.test.ts`
  6. `sdk/test/integration/runtime-realm-orchestration.test.ts`

### Added test evidence

- Added orchestration integration coverage:
  - `sdk/test/integration/runtime-realm-orchestration.test.ts`
  - covers fixed paradigms A/B/C/D (`Realm -> Runtime`, `Runtime -> Realm`, dual preflight, lifecycle-independent bridge).
- Added AI stream explicit resubscribe regression:
  - `sdk/test/ai-provider/provider.test.ts`
  - verifies interrupted stream is not implicitly resumed; second explicit subscription succeeds.
- Added Realm default 4xx mapping regression:
  - `sdk/test/realm/realm-client.test.ts`
  - verifies fallback mapping without server reasonCode:
    - `404 -> REALM_NOT_FOUND`
    - `409 -> REALM_CONFLICT`
    - `429 -> REALM_RATE_LIMITED`

## Follow-up audit sync (2026-02-27, round 2)

- Re-audited SDK implementation against:
  - `dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md`
  - `dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md`
- Confirmed no legacy client entry and no global OpenAPI singleton path in active SDK/app code paths.
- Corrected one docs/implementation mismatch in `docs/sdk/README.md`:
  - replaced stale `realm.social/economy/realtime` examples with current `Realm` facade + `realm.services.*` + `realm.raw.request` usage.

Verification rerun (all green):

1. `pnpm --filter @nimiplatform/sdk lint`
2. `pnpm --filter @nimiplatform/sdk test`
3. `pnpm check:sdk-vnext-matrix`
4. `pnpm check:sdk-coverage`
5. `pnpm check:sdk-consumer-smoke`
6. `pnpm check:no-create-nimi-client`
7. `pnpm check:no-global-openapi-config`
8. `pnpm check:no-openapi-singleton-import`
9. `pnpm check:desktop-mods-smoke`
10. `pnpm check:sdk-import-boundary`
11. `pnpm check:sdk-single-package-layout`
12. `pnpm check:sdk-public-naming`
13. `pnpm check:markdown`
14. `pnpm check:no-legacy-doc-contracts`
15. `pnpm check:examples`
16. `pnpm lint`
