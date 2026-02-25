# Mod Development

This guide defines the local joint-debug contract between `apps/desktop/` and external `nimi-mods/` (no legacy fallback).

## Contract

1. `nimi-mods/` is the only source of mod code.
2. `NIMI_MODS_ROOT` is required and must be an absolute directory path.
3. `NIMI_RUNTIME_MODS_DIR` is required in `apps/desktop` dev and must be an absolute directory path.
4. In local joint-debug, set `NIMI_RUNTIME_MODS_DIR == NIMI_MODS_ROOT`.
5. Desktop does not use implicit path fallback or deprecated env aliases.

## Build Contract

1. Use `nimi-mods/scripts/build-mod.mjs` as the only build entry.
2. Supported flags: `--mod <id>`, `--all`, `--watch`.
3. Manifest entry must match output:
`./dist/mods/<mod-name>/index.js`.

## Standard Dual-Terminal Flow

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

## Smoke Check

Use the desktop smoke script to verify the local joint-debug contract end-to-end before starting shell:

```bash
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run smoke:mod:local-chat
```

What it checks:

1. env contract (`NIMI_MODS_ROOT` + `NIMI_RUNTIME_MODS_DIR`, and equality).
2. external build entry (`$NIMI_MODS_ROOT/scripts/build-mod.mjs`) and dist output.
3. desktop default-mod resources copy (`src-tauri/resources/default-mods/<mod>/...`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required env NIMI_MODS_ROOT` | env not set | export absolute path |
| `Missing required env NIMI_RUNTIME_MODS_DIR` | env not set | export absolute path |
| `NIMI_RUNTIME_MODS_DIR must equal NIMI_MODS_ROOT` | mismatched dirs | set both to same path |
| `manifest.entry mismatch` | wrong manifest entry | set to `./dist/mods/<mod>/index.js` |
| desktop cannot load latest code | dist not rebuilt | run `watch` or `build` in `nimi-mods` |
