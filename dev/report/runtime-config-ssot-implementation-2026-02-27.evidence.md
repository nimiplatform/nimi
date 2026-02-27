# Runtime Config SSOT Implementation Evidence (2026-02-27)

## Scope

Evidence for Runtime Config SSOT rollout covering:

1. runtime config loader + migration + secret policy
2. `nimi config` CLI command group
3. desktop tauri bridge (`runtime_bridge_config_get/set`)
4. docs + ssot linkage updates

## Verification Commands

```bash
cd runtime
go test ./internal/config -count=1
go test ./cmd/nimi -count=1

cd apps/desktop/src-tauri
cargo test runtime_bridge::daemon_manager::tests

cd ../..
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec tsx --test test/runtime-bridge-config.test.ts test/runtime-daemon-state.test.ts test/runtime-route-resolver-v11.test.ts
```

## Results

1. `go test ./internal/config -count=1` passed.
2. `go test ./cmd/nimi -count=1` passed.
3. `cargo test runtime_bridge::daemon_manager::tests` passed.
4. `pnpm -C apps/desktop exec tsc --noEmit` passed.
5. `pnpm -C apps/desktop exec tsx --test test/runtime-bridge-config.test.ts test/runtime-daemon-state.test.ts test/runtime-route-resolver-v11.test.ts` passed.

## Delivered Contracts

1. Runtime Config SSOT added: `ssot/runtime/config-contract.md`.
2. Traceability matrix registration added: `ssot/_meta/traceability-matrix.md`.
3. Runtime service SSOT references config contract: `ssot/runtime/service-contract.md`.
4. SSOT map includes runtime config contract: `docs/architecture/ssot.md`.

## Delivered Implementation

1. Runtime default config path switched to `~/.nimi/config.json`.
2. Legacy path migration (`~/.nimi/runtime/config.json`) implemented with hard switch.
3. `schemaVersion=1` + secret policy (`apiKey` forbidden, `apiKeyEnv` required) enforced.
4. `nimi config init|get|set|validate|migrate` implemented.
5. CLI write lock and atomic write path added for config writes.
6. Desktop bridge now proxies config read/write via CLI (`runtime_bridge_config_get/set`).
7. Runtime Config panel now reads bridge config on hydrate and persists runtime config projection back through bridge CLI write path.
8. Added desktop tests for runtime config projection/mapping (`test/runtime-bridge-config.test.ts`).
9. Token API route resolution no longer hard-requires plaintext connector token; runtime env/config path can drive cloud provider auth (`test/runtime-route-resolver-v11.test.ts`).
10. Runtime Config projection now includes connector `apiKeyEnv` refs and supports desktop-side env-ref editing without violating secret policy.
