# Spec Full Doc Audit And Closure (2026-03-06)

## Scope And Boundary

- Scope: `spec/**`, `spec/**/kernel/tables/*.yaml`, generated spec docs, `spec/generated/nimi-spec.md`, `dev/report/*`
- Layered audit policy:
  - `runtime/sdk/desktop`: implementation-facing acceptance gates, hard-cut alignment, test closure
  - `platform/realm/future`: semantic consistency, reading-path alignment, architecture blind spots
- Boundary: docs-first audit, later expanded to targeted implementation remediation in `apps/desktop/**` and `sdk/**` to clear newly exposed red guards
- Not changed:
  - `scripts/*`
  - existing runtime/sdk/desktop public interfaces

## Completed Remediation

### 1. Spec Metadata Hard Cut

- Removed source-spec execution metadata `> Status:` and `> Date:` across `spec/**` source Markdown.
- Kept non-execution positioning metadata such as owner/scope markers.
- Refreshed `spec/generated/nimi-spec.md` after the final Markdown edits.
- Verified no source-spec file reintroduced `Status/Date`.

### 2. Runtime Gate And Contract Closure

- `proto-governance` now explicitly owns:
  - `pnpm proto:lint`
  - `pnpm proto:generate`
  - `pnpm proto:drift-check`
  - `pnpm check:runtime-proto-spec-linkage`
- `delivery-gates` now explicitly carries contract-affecting runtime hard-cut checks for:
  - proto/spec linkage
  - runtime mod/hook hard cut
  - catalog drift
  - provider activation alignment
  - provider alias hard cut
  - provider endpoint SSOT
  - provider YAML-first hard cut
  - capability token canonicalization
  - video capability block enforcement
- `model-catalog-contract` and `provider-health-contract` now expose verification anchors instead of leaving these checks orphaned from the normative layer.

### 3. SDK Gate And Contract Closure

- `boundary-contract` now owns:
  - `pnpm check:no-create-nimi-client`
  - `pnpm check:no-global-openapi-config`
- `surface-contract` now owns:
  - `pnpm check:sdk-realm-legacy-clean`
  - `pnpm check:sdk-single-package-layout`
- `error-projection` now owns:
  - `pnpm check:reason-code-constants`
- `mod-contract` now hard-cuts legacy runtime-aligned mod/hook surfaces and binds them to `pnpm check:runtime-mod-hook-hardcut`.
- `testing-gates` and `sdk-testing-gates.yaml` now enumerate the real boundary/public-surface/mod-scope checks that already existed in the repo.

### 4. Desktop Evidence Closure

- `bootstrap-contract`, `bridge-ipc-contract`, `llm-adapter-contract`, `mod-governance-contract`, and `codegen-contract` now bind existing hard-cut guards to owning rules.
- `rule-evidence.yaml` now carries evidence catalog entries for:
  - runtime-mod-hook hard cut
  - token-api runtime-only
  - canonical runtime config path only
  - local-ai private command bans
  - legacy mod `permissions` field ban
- `testing-gates.md` now documents the supplementary hard-cut gates instead of leaving them outside the domain reading path.

### 5. Platform / Realm / Future Cross-Domain Alignment

- `spec/platform/protocol.md` now points to downstream implementation anchors in `runtime/sdk/realm` and clarifies that Platform owns the compliance source, not every downstream execution gate.
- `spec/realm/realm-interop-mapping.md` now explicitly reuses Platform primitives and states that downstream layers own executable gates.
- `spec/future/index.md` and `spec/future/kernel/graduation-contract.md` now require reuse/import of Platform or Realm kernels when backlog graduation depends on those semantics.

### 6. Targeted Implementation Follow-Up

- `sdk/src/types/index.ts` now exposes the missing public `ReasonCode` entries that were already used as runtime/Desktop reason semantics:
  - `CONFIG_APPLIED`
  - `CONFIG_RESTART_REQUIRED`
  - `LOCAL_AI_HF_DOWNLOAD_PAUSED`
  - `MOD_STATE_INVALID_KEY`
  - `MOD_STATE_INVALID_OP`
  - `MOD_STATE_STORAGE_ERROR`
  - `MOD_STATE_UNAVAILABLE`
  - `MOD_STATE_VALUE_TOO_LARGE`
  - `RUNTIME_ROUTE_UNAVAILABLE`
- Remaining failing `reasonCode` literals in Desktop and SDK source/tests were replaced with `ReasonCode.*` or test-local constants where no public reason code exists.
- Desktop local runtime command literals were renamed from `local_ai_*` to `runtime_local_*` in `apps/desktop/src/runtime/local-ai-runtime/commands.ts`.
- Desktop Tauri module/handler surface was renamed from `local_ai_runtime` / `local_ai_*` to `local_runtime` / `runtime_local_*`, including:
  - `apps/desktop/src-tauri/src/main.rs`
  - `apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs`
  - `apps/desktop/src-tauri/src/local_runtime/**`

## Verification Results

### Manual Source Scan

| Command | Result | Notes |
|---|---|---|
| `rg -n '^> (Status|Date):' spec --glob '!spec/generated/**' --glob '!spec/**/kernel/generated/**'` | PASS | No matches. `rg` exited `1`, which is the expected "not found" result. |

### Generation

| Command | Result | Notes |
|---|---|---|
| `pnpm generate:runtime-spec-kernel-docs` | PASS | Runtime generated kernel docs refreshed after YAML changes. |
| `pnpm generate:sdk-spec-kernel-docs` | PASS | SDK generated kernel docs refreshed after YAML changes. |
| `pnpm generate:desktop-spec-kernel-docs` | PASS | Desktop generated kernel docs refreshed after YAML changes. |
| `pnpm generate:spec-human-doc` | PASS | Re-run after the final Markdown edits; `spec/generated/nimi-spec.md` is current. |

### Spec Baseline And Drift Gates

| Command | Result | Notes |
|---|---|---|
| `pnpm check:no-legacy-doc-contracts` | PASS | Legacy doc contract scan passed. |
| `pnpm check:spec-semantic-completeness` | PASS | `688 rules`, `283 spec files`, `4 companion docs`. |
| `pnpm check:spec-human-doc-drift` | PASS | Human doc is up-to-date. |
| `pnpm check:runtime-spec-kernel-consistency` | PASS | Runtime kernel consistency passed. |
| `pnpm check:runtime-spec-kernel-docs-drift` | PASS | Runtime generated kernel docs are up-to-date (`33 files`). |
| `pnpm check:sdk-spec-kernel-consistency` | PASS | SDK kernel consistency passed. |
| `pnpm check:sdk-spec-kernel-docs-drift` | PASS | SDK generated kernel docs are up-to-date (`8 files`). |
| `pnpm check:desktop-spec-kernel-consistency` | PASS | Desktop kernel consistency passed. |
| `pnpm check:desktop-spec-kernel-docs-drift` | PASS | Desktop generated kernel docs are up-to-date (`23 files`). |
| `pnpm check:platform-spec-kernel-consistency` | PASS | Platform kernel consistency passed. |
| `pnpm check:platform-spec-kernel-docs-drift` | PASS | Platform generated kernel docs are up-to-date (`7 files`). |
| `pnpm check:realm-spec-kernel-consistency` | PASS | Realm kernel consistency passed. |
| `pnpm check:realm-spec-kernel-docs-drift` | PASS | Realm generated kernel docs are up-to-date (`6 files`). |
| `pnpm check:future-spec-kernel-consistency` | PASS | Future kernel consistency passed. |
| `pnpm check:future-spec-kernel-docs-drift` | PASS | Future generated kernel docs are up-to-date (`4 files`). |

### Newly Documented Runtime Guards

| Command | Result | Notes |
|---|---|---|
| `pnpm check:runtime-proto-spec-linkage` | PASS | `runtime-proto-spec-linkage: OK` |
| `pnpm check:runtime-catalog-drift` | PASS | Active source snapshots are up-to-date (`39 providers`). |
| `pnpm check:runtime-mod-hook-hardcut` | PASS | Passed after rewriting spec text to semantic descriptions instead of banned legacy literals. |
| `pnpm check:runtime-provider-activation-alignment` | PASS | `runtime-provider-activation-alignment: OK` |
| `pnpm check:runtime-provider-alias-hardcut` | PASS | `runtime-provider-alias-hardcut: OK` |
| `pnpm check:runtime-provider-capability-token-canonicalization` | PASS | Canonical capability token mapping is aligned. |
| `pnpm check:runtime-provider-endpoint-ssot` | PASS | Endpoint SSOT check passed. |
| `pnpm check:runtime-provider-yaml-first-hardcut` | PASS | YAML-first hard cut passed. |
| `pnpm check:runtime-video-capability-block-enforcement` | PASS | Video capability block enforcement passed. |

### Newly Documented SDK Guards

| Command | Result | Notes |
|---|---|---|
| `pnpm check:no-create-nimi-client` | PASS | `createNimiClient` usage check passed. |
| `pnpm check:no-global-openapi-config` | PASS | Nested `no-openapi-base-assignment` and `no-openapi-token-assignment` both passed. |
| `pnpm check:sdk-realm-legacy-clean` | PASS | Realm legacy symbol clean check passed. |
| `pnpm check:reason-code-constants` | PASS | Final rerun passed after replacing source/test literals and adding the missing public `ReasonCode` entries. |
| `pnpm check:sdk-single-package-layout` | PASS | Single-package layout check passed. |

### Newly Documented Desktop Guards

| Command | Result | Notes |
|---|---|---|
| `pnpm check:desktop-token-api-runtime-only` | PASS | Passed (`22 files scanned`). |
| `pnpm check:desktop-no-legacy-runtime-config-path` | PASS | No legacy `.nimi/runtime/config.json` fallback remains in scanned Desktop code. |
| `pnpm check:no-local-ai-private-calls` | PASS | Final rerun passed after renaming Desktop TS command literals to `runtime_local_*`. |
| `pnpm check:no-local-ai-tauri-commands` | PASS | Final rerun passed after renaming the Tauri module and handler surface to `local_runtime` / `runtime_local_*`. |
| `pnpm check:no-legacy-mod-permissions-field` | PASS | No legacy mod `permissions` field remains in the scanned locations. |

### Targeted Implementation Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm --dir apps/desktop exec tsx --test test/audit-view-model.test.ts test/local-ai-download-parser.test.ts test/runtime-ai-bridge-reason-map.test.ts test/runtime-bootstrap-jwt-sync.test.ts` | PASS | `49` tests passed. |
| `pnpm --dir sdk exec tsx --test test/mod/mod-runtime-context.test.ts` | PASS | `4` tests passed. |
| `cargo check` (`apps/desktop/src-tauri`) | PASS | Rust module/handler rename compiles successfully. |

## Residual Notes

- No red guard remains within the audited `runtime/sdk/desktop` acceptance scope.
- The post-audit implementation follow-up was intentionally narrow: targeted guard remediation, targeted TS tests, and one Rust `cargo check`.
- This report does not claim a full desktop or full workspace test-suite rerun beyond the commands listed above.

## Conclusion

- `spec/**` source documents no longer contain `Status/Date` execution metadata.
- `runtime/sdk/desktop` contract-affecting existing hard-cut and guard commands now have explicit owning positions in `spec/**`.
- `platform/realm/future` now align reading paths and semantic ownership without creating fake downstream gate models.
- The spec baseline is green.
- The three implementation guards that were red during the docs-only pass are now green after targeted source remediation.
