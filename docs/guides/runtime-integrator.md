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
3. `go run ./cmd/nimi providers --source grpc` returns available providers.
4. First AI call succeeds with explicit route policy.

## Recommended operations

- Use pinned runtime versions per deployment ring.
- Keep model/provider configuration declarative.
- Aggregate logs with `traceId` propagation.

See [Runtime Reference](../reference/runtime.md) and [Provider Matrix](../reference/provider-matrix.md).
