# Nimi Examples

Runnable examples for external developers building on Nimi.

## Layout

- `sdk/` — runtime and realm SDK recipes
- `sdk/providers/` — provider-focused runtime examples
- `mods/` — mod SDK sample
- `runtime/` — CLI quick path

## Prerequisites

- Runtime daemon running (`cd runtime && go run ./cmd/nimi serve`)
- Node.js `24+`
- `pnpm install` completed in repository root

## Run

```bash
npx tsx examples/sdk/sdk-quickstart.ts
```

Provider sample:

```bash
npx tsx examples/sdk/providers/localai.ts
```

## Compile gate

```bash
pnpm --filter @nimiplatform/examples run check
```
