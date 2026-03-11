# Nimi Mod Template

This directory is a standalone template for a third-party runtime mod.

Inside this repo it invokes [`nimi-mod.mjs`](/Users/snwozy/nimi-realm/nimi/dev-tools/bin/nimi-mod.mjs).
Outside this repo:

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create --dir my-mod --name "My Mod"
pnpm add -D @nimiplatform/dev-tools
pnpm add @nimiplatform/sdk react
```

Then replace the script paths with the published `nimi-mod` CLI binary.

## Development

```bash
pnpm dev
```

Then in Desktop:

1. Open `Settings > Mod Developer`
2. Enable `Developer Mode`
3. Add this directory as a `dev` source
4. Edit `src/index.tsx`
5. Desktop auto-reloads the mod

## Packaging

```bash
pnpm build
pnpm doctor
pnpm pack
```
