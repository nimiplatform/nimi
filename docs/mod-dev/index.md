# Mod Developer Overview

A Nimi mod is a packaged extension that loads into the Nimi Desktop app. Mods run inside a sandboxed, hook-based runtime (`nimi-hook`) and extend the desktop experience without direct access to the underlying runtime or realm services. All capabilities are mediated through approved hook interfaces.

## Development Contract

- Mods run through `nimi-hook` inside the desktop sandbox.
- Mods do **not** call runtime or realm directly.
- Capabilities are exposed through approved hook interfaces only.
- Import from `@nimiplatform/sdk/mod`, not `@nimiplatform/sdk/runtime`.

## Quick Path

### 1. Scaffold a new mod

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create --dir my-mod --name "My Mod"
```

### 2. Develop

```bash
cd my-mod && pnpm install && pnpm dev
```

### 3. Load in Desktop

Open the Nimi Desktop app and navigate to **Settings > Mod Developer > Add directory**. Point it at your mod's root folder.

### 4. Validate and package

```bash
pnpm build && pnpm doctor && pnpm pack
```

`pnpm doctor` checks manifest correctness, hook compatibility, and sandbox compliance before you distribute.

## Next Steps

- [Development Guide](./guide.md) -- Full development workflow
- [Release & Submission](./release.md) -- Publishing and catalog listing
- [Release Guide (CN)](./release_cn.md) -- Chinese version
