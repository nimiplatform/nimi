# Nimi Examples

Runnable examples for external developers building on Nimi.

## Choose Your Goal

### Just See It

Run one script that keeps the same app code and only switches `routePolicy` from `local-runtime` to `token-api`:

```bash
npx tsx examples/sdk/last-mile-route-switch.ts
```

Expected output:

- shows two runs (`[local-runtime]` and `[token-api]`)
- prints either generated text or explicit reason code + action hint
- prints elapsed time for both routes

If it fails:

- `AI_LOCAL_MODEL_UNAVAILABLE`: pull or configure a local model first
- `AI_REQUEST_CREDENTIAL_INVALID`: configure cloud provider credentials on the runtime process

### Build With It

Use these when integrating Nimi into your own app code:

```bash
npx tsx examples/sdk/sdk-quickstart.ts
npx tsx examples/sdk/ai-provider.ts
npx tsx examples/sdk/ai-streaming.ts
```

Expected output:

- runtime health and model inventory
- text generation and streaming chunks
- trace/usage fields that can be wired into app telemetry

If it fails:

- ensure runtime is running (`pnpm runtime:serve`)
- verify endpoint (`NIMI_RUNTIME_GRPC_ENDPOINT`)
- check provider/model availability with `pnpm runtime:providers`

### Advanced Governance

For app authorization lifecycle and workflow DAG orchestration:

```bash
npx tsx examples/sdk/app-auth.ts
npx tsx examples/sdk/workflow-dag.ts
```

Expected output:

- app/external principal registration, token chain, revoke/validate loop
- workflow submit, event stream, and terminal node statuses

If it fails:

- inspect runtime reason codes in output
- verify required scopes/capabilities are enabled for your test app

## Prerequisites

- Runtime daemon running (`pnpm runtime:serve`)
- Node.js `24+`
- `pnpm install` completed in repository root

## Compile Gate

```bash
pnpm --filter @nimiplatform/examples run check
```

## Layout

- `sdk/` - runtime and realm SDK recipes
- `sdk/providers/` - provider-focused runtime examples
- `mods/` - mod SDK sample
- `runtime/` - CLI quick path
