# Mod Developer Guide

Use this guide when building desktop mods in any independent mod repository.

## Development contract

- Mods run through `nimi-hook` inside desktop sandbox
- Mods do not call runtime/realm directly
- Runtime and realm capabilities are exposed through approved hook interfaces

## Local development

```bash
# Scaffold once
pnpm dlx @nimiplatform/dev-tools nimi-mod create --dir my-mod --name "My Mod"

# Then inside your mod repo
cd my-mod
pnpm install
pnpm dev
```

Then inside Desktop:

1. Open `Settings > Mod Developer`
2. Enable `Developer Mode`
3. Add your mod directory as a `dev` source
4. Enable `Auto Reload` if desired
5. Watch diagnostics and reload results in the same panel

Desktop side development should be UI-only. `NIMI_RUNTIME_MODS_DIR` is kept only for CI/internal compatibility, not for the main third-party flow.

Recommended toolchain:

- inside this monorepo: invoke [`nimi-mod.mjs`](/Users/snwozy/nimi-realm/nimi/dev-tools/bin/nimi-mod.mjs)
- outside this monorepo: `pnpm add -D @nimiplatform/dev-tools` and use the published `nimi-mod` CLI

## Validation

```bash
pnpm build
pnpm doctor
pnpm pack
```

For a runnable mod repo template, see [`examples/mod-template`](../../examples/mod-template).

For a mod SDK sample using `setModSdkHost()`, `createHookClient()`, and `createModRuntimeClient()`, see [`examples/mods/mod-basic.ts`](../../examples/mods/mod-basic.ts).
