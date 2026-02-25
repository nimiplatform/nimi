# Nimi Platform Release Audit (Current State)

- Date: 2026-02-26
- Scope: `@nimiplatform/nimi` + external `@nimiplatform/nimi-mods` integration contract
- Perspective: no-legacy hard cut, AI-native runtime/developer platform, open-source release readiness
- Decision: `GO` (no P0/P1 release blockers found in repository state)

## 1. Executive Summary

Current repository state is consistent with the target architecture:

1. Desktop x external `nimi-mods` local joint-debug is env-driven and fail-fast.
2. SDK publishing contract is dist-first (`dist/*.js` + `dist/*.d.ts`) with consumer smoke gate.
3. CI/release pipeline includes pinned external mods checkout, coverage gates, SBOM/signing/verify.
4. No-legacy policy is enforced in docs/contracts and runtime path resolution.

No open blocker was found that should prevent `v0.x` open-source release from an engineering-contract perspective.

## 2. Validation Baseline

Validated locally in this round:

```bash
pnpm -C /Users/snwozy/nimi-realm/nimi lint
pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run typecheck
pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run test:unit
cargo test --manifest-path /Users/snwozy/nimi-realm/nimi/desktop/src-tauri/Cargo.toml
pnpm -C /Users/snwozy/nimi-realm/nimi/nimi-mods run verify
cd /Users/snwozy/nimi-realm/nimi/runtime && go test ./...
```

All commands passed.

## 3. Hard-Gate Status

| Domain | Status | Evidence |
|---|---|---|
| Desktop x mods env contract | PASS | `desktop/scripts/dev-env-check.mjs`, `NIMI_MODS_ROOT` + `NIMI_RUNTIME_MODS_DIR` fail-fast |
| No legacy path fallback | PASS | Desktop scripts/Vite/runtime use explicit env contract; docs gate blocks old aliases |
| SDK publish artifact contract | PASS | `sdk/packages/*/package.json` exports -> `dist`, build -> `build-typescript-package.mjs` |
| SDK consumer smoke | PASS | `scripts/check-sdk-consumer-smoke.mjs`, CI `sdk-quality` job |
| External mods CI pinning | PASS | `.github/workflows/ci.yml` explicit checkout `nimiplatform/nimi-mods` with pinned `ref` |
| License matrix consistency | PASS | `scripts/check-package-license-matrix.mjs`, `nimi-mods/package.json` = MIT |
| Proto SSOT single source | PASS | runtime README points to `ssot/runtime/proto-contract.md`, legacy runtime contract file removed |
| Runtime mods-dir safety | PASS | `runtime/cmd/nimi/mod_commands.go` requires `--mods-dir` or `NIMI_RUNTIME_MODS_DIR` |
| Supply chain release gate | PASS | `release.yml` + `release-runtime.yml` include SBOM + keyless sign + verify + upload |
| CI topology and coverage gate | PASS | parallel jobs + path-aware changes + sdk/runtime coverage checks |
| Governance toolchain baseline | PASS | pre-commit, markdownlint, actionlint, env example, funding/issue config, vision/governance docs |

## 4. No-Legacy Hardening Completed

### 4.1 Runtime/desktop hard cuts

1. Speech `providerId` no longer accepts route-source encoded aliases; source mismatch is rejected.
2. `runtime_mod` SQLite schema migration fallback removed; strict schema check + fail-fast reset hint.
3. Runtime-config defaults normalized to current contract (`local-model`, `http://127.0.0.1:1234/v1`).
4. Legacy naming removed from LLM adapter/runtime-config/world-studio/local-chat code paths.

### 4.2 Docs/SSOT hard cuts

1. `ai.modelPacks` legacy compatibility narrative removed from SSOT runtime/mod contracts.
2. Docs legacy pattern gate expanded (`check-no-legacy-doc-contracts.mjs`).
3. Root and desktop docs aligned with current desktop x external mods workflow.

## 5. Remaining Gaps (Non-Blocking)

### [P2] Brand/Distribution Operations

Status: pending (does not block engineering release).

Missing/partial:

1. GitHub topics and social preview operational baseline.
2. Optional automation for community onboarding/reply flow (baseline已完成：`first-interaction.yml`).

Recommendation: close in community-growth phase, not as release blocker.

## 6. Release Recommendation

`GO` for open-source `v0.x` from contract and engineering readiness perspective, with the following operational sequence:

1. Run one staging tag dry-run across `runtime/sdk/proto/desktop` release workflows.
2. Enable branch protection to require `ci`, `security`, `actionlint`, `markdownlint`.
3. Track P2 brand/distribution items as post-release operations backlog.
