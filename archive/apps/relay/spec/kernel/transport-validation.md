# Relay Transport Validation

> Rule namespace: RL-TRANS-*
> Reference: spec/sdk/kernel/transport-contract.md

## RL-TRANS-001 — node-grpc Connectivity Validation

Relay app's primary test target:

Validate `@grpc/grpc-js` through SDK `node-grpc` transport connecting to the runtime daemon.
The complete path: Electron main process → SDK Runtime → node-grpc transport → gRPC → runtime daemon.

**Validation method**: smoke test that calls `runtime.health()` and asserts a structured response.

Reference: S-TRANSPORT-001, `sdk/src/runtime/transports/node-grpc.ts`

## RL-TRANS-002 — Streaming Validation

Validate node-grpc server-streaming behavior in Electron main process:

- Async iterator correctly consumed
- IPC forwarding has no data loss
- Cancel/abort correctly closes the gRPC stream
- Back-pressure handled when renderer consumption is slow

**Validation method**: smoke test that opens a text stream, collects N chunks via IPC, and verifies completeness.

Reference: S-TRANSPORT-003, S-TRANSPORT-007

## RL-TRANS-003 — Auth Injection Validation

Validate node-grpc transport bearer token injection:

- `accessToken` is configured as a provider function `() => Promise<string>`, not a static string
- Provider re-evaluates on each SDK call
- gRPC metadata correctly carries `authorization` and `x-nimi-*` headers

**Validation method**: test with a token provider that returns different values on successive calls;
verify metadata changes in gRPC request headers.

Reference: S-TRANSPORT-010

## RL-TRANS-004 — Version Compatibility Validation

Validate SDK/Runtime version negotiation:

- Response metadata `x-nimi-runtime-version` correctly extracted from gRPC response headers
- Major version mismatch triggers fail-close
- Minor/patch mismatch allows graceful degradation

**Validation method**: after any successful RPC (e.g. `runtime.health()`), call
`runtime.runtimeVersion()` and `runtime.versionCompatibility()` to assert that:
1. Version string is non-null and semver-parseable
2. Compatibility status is readable

Version is extracted from the first successful RPC's response metadata header
`x-nimi-runtime-version` by the SDK's `_responseMetadataObserver` — not from the
health response body. The smoke test must assert on `runtime.runtimeVersion()`,
not on any field in the health payload.

Reference: S-TRANSPORT-005

## RL-TRANS-005 — Error Projection Validation

Validate gRPC error → NimiError conversion:

- `UNAVAILABLE` → `retryable: true`
- Structured JSON details correctly parsed
- `reasonCode`, `actionHint`, `traceId` fields populated
- H2 transport errors detected for retry logic

**Validation method**: deliberately trigger errors (invalid model, missing auth) and assert
NimiError fields are populated correctly through the IPC bridge.

Reference: `sdk/src/runtime/transports/node-grpc.ts` `normalizeServiceError`
