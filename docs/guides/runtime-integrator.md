# Runtime Integrator Guide

Use this guide if you are integrating `nimi-runtime` into a host application, launcher, or managed environment.

## Core integration points

- Process lifecycle: start/stop/health
- Endpoint wiring: gRPC + HTTP health
- Route policy and provider key provisioning
- Audit and error observability

## Minimal host checks

1. Runtime process is reachable on gRPC endpoint.
2. `/v1/runtime/health` is healthy.
3. `nimi doctor --json` reports healthy daemon, provider, and model state.
4. First AI call succeeds through `nimi run "<prompt>"` or an equivalent SDK call.

## Recommended operations

- Use pinned runtime versions per deployment ring.
- Keep model/provider configuration declarative.
- Prefer `nimi provider set` or env-backed credentials over app-local secret sprawl.
- Aggregate logs with `traceId` propagation.

If you are integrating from a source checkout instead of an installed binary, run the same commands through `go run ./cmd/nimi ...` from `runtime/`.

See [Runtime Reference](../reference/runtime.md) and [Provider Matrix](../reference/provider-matrix.md).
