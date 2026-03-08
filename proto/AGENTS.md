# Proto AGENTS.md

## Scope
- Applies to `proto/**`.
- Proto is the runtime gRPC contract source; generated Go and TypeScript stubs are derived outputs.

## Hard Boundaries
- Keep sources under `proto/runtime/v1/**`.
- Do not edit generated outputs in `runtime/gen/**` or `sdk/src/runtime/generated/**`.
- Preserve field numbers, reserve removals, and keep service / RPC names stable unless the task explicitly changes the wire contract.

## Retrieval Defaults
- Start in the affected file under `proto/runtime/v1/**`, then inspect `buf.yaml`, `buf.gen.yaml`, and the nearest runtime/spec consumer.
- Skip generated stubs unless validating drift or regeneration output.

## Verification Commands
- `pnpm proto:lint`
- `pnpm proto:breaking`
- `pnpm proto:generate`
- `pnpm proto:drift-check`
