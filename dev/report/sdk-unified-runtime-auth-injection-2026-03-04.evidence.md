# SDK Unified Runtime Auth Injection Evidence

> Date: 2026-03-04  
> Branch: `codex/sdk-unified-runtime-auth-injection`  
> Scope: `spec/**`, `runtime/**`, `sdk/**`, `apps/desktop/**`

## 1. Objective

Implement single-path runtime authentication:

- SDK owns runtime bearer injection (`Authorization: Bearer <realm_access_token>`)
- App layer does not handcraft runtime auth metadata
- Runtime authn is fail-close for malformed `authorization` header
- Remove legacy `authContext` runtime option naming, keep only `subjectContext`

## 2. Delivered Commits

1. `d5ac01b` spec: align runtime auth injection contracts
2. `20e0c36` runtime: fail-close malformed authorization header
3. `90289ce` sdk: add per-call runtime auth provider and subject context
4. `f035c60` sdk/runtime-bridge: pass authorization through transport payloads
5. `32fc372` desktop: wire runtime auth token provider from latest auth state
6. `38d1598` desktop: add connector save auth injection regression coverage
7. `9007fd5` desktop: clear i18n audit blockers and mod policy gaps

## 3. Acceptance Evidence

### 3.1 Spec Gates

```text
pnpm generate:runtime-spec-kernel-docs
pnpm check:runtime-spec-kernel-consistency
pnpm check:runtime-spec-kernel-docs-drift
pnpm check:sdk-spec-kernel-consistency
pnpm check:sdk-spec-kernel-docs-drift
pnpm check:desktop-spec-kernel-consistency
pnpm check:desktop-spec-kernel-docs-drift
pnpm check:platform-spec-kernel-consistency
pnpm check:platform-spec-kernel-docs-drift
```

Result: all passed.

### 3.2 Runtime Code Gates

```text
cd runtime && go test ./internal/authn ./internal/grpcserver ./internal/services/connector
```

Result: all passed.

### 3.3 SDK Code Gates

```text
pnpm --filter @nimiplatform/sdk test
```

Result: passed (`103` tests).

### 3.4 Desktop Code Gates

```text
pnpm --filter @nimiplatform/desktop lint
pnpm --filter @nimiplatform/desktop test
```

Result: both passed (`362` unit tests in desktop suite; quality gates green).

## 4. Key Behavior Verification

- Malformed runtime `authorization` header now returns `UNAUTHENTICATED + AUTH_TOKEN_INVALID`.
- SDK node-grpc transport injects `authorization` metadata from runtime auth provider.
- SDK tauri-ipc transport includes top-level `authorization` payload in unary/stream-open.
- Tauri runtime bridge accepts top-level `authorization` and writes it to tonic metadata.
- Desktop runtime bootstrap provides dynamic token provider (reads latest auth store token).
- Connector create/save path now uses SDK transparent auth injection; no app-layer manual auth glue.

## 5. Residual Notes

- Desktop mod i18n policy inventory updated for `audio-book`, `textplay`, `videoplay` to keep quality gates deterministic.
- No legacy compatibility alias for `authContext` remains in runtime SDK surface.
