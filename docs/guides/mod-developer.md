# Mod Developer Guide

Use this guide when building desktop mods in the external `nimi-mods` repository.

## Development contract

- Mods run through `nimi-hook` inside desktop sandbox
- Mods do not call runtime/realm directly
- Runtime and realm capabilities are exposed through approved hook interfaces

## Local development

```bash
# Terminal A (mods)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
pnpm -C "$NIMI_MODS_ROOT" install
pnpm -C "$NIMI_MODS_ROOT" run watch -- --mod local-chat

# Terminal B (desktop)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run dev:shell
```

## Validation

```bash
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run smoke:mod:local-chat
```

For a runnable mod SDK sample using `setModSdkHost()`, `createHookClient()`, and `createModRuntimeClient()`, see [`examples/mods/mod-basic.ts`](../../examples/mods/mod-basic.ts).
