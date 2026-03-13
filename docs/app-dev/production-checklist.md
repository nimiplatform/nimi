# Production Checklist

Use this checklist before shipping an application that depends on the Nimi runtime.

## Timeout and Fallback Policy

Set explicit timeouts on every AI call. Define fallback behavior (cached response, graceful degradation, user-facing message) for when a provider is unreachable or the local runtime is not running.

## Error Handling

- Branch on `reasonCode`, not on message text. Reason codes are stable across versions; messages are not.
- Persist `traceId` in your logs and support channels so issues can be correlated end-to-end.
- Respect the `retryable` flag returned in error responses. Only retry automatically when the runtime indicates the error is transient.

## Token Lifecycle

Handle runtime and realm token refresh and expiration gracefully. Avoid hardcoding token values. Use the SDK's built-in token management and listen for refresh events rather than polling.

## Version Compatibility

- Keep the SDK and runtime within the same `major.minor` release train. Mismatched versions may produce undefined behavior.
- Pin workspace release sets in CI.
- Run the version matrix check before deploying:

```bash
pnpm check:sdk-version-matrix
```

## Health Check Integration

- Monitor `/v1/runtime/health` in your deployment environment.
- Use `nimi doctor --json` for structured environment validation during CI or startup probes.

## Provider Key Management

Keep provider API keys in the runtime process configuration, not spread across individual applications. Use `nimi provider set` or environment-backed credential files. This ensures keys are rotated in one place and never leak into client bundles.

## Logging and Telemetry

- Aggregate logs with `traceId` propagation so that a single user request can be traced from the application through the runtime to the provider.
- Surface `reasonCode` and `actionHint` in your error reporting dashboards. These fields are designed for programmatic triage.

## Verification Commands

Run these checks in CI to catch drift early:

```bash
pnpm check:sdk-version-matrix
pnpm check:runtime-bridge-method-drift
pnpm check:scope-catalog-drift
```

## Related Resources

- [Compatibility Matrix](../reference/compatibility-matrix.md)
- [Error Codes](../reference/error-codes.md)
- [Runtime Reference](../reference/runtime.md)
