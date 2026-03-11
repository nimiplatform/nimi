# @nimiplatform/dev-tools

CLI package for Nimi author workflows.

One-shot scaffold commands use a package-qualified launcher:

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create
pnpm dlx @nimiplatform/dev-tools nimi-app create
```

Install for mod authoring:

```bash
pnpm add -D @nimiplatform/dev-tools
pnpm add @nimiplatform/sdk react
```

Install for app authoring:

```bash
pnpm add -D @nimiplatform/dev-tools
pnpm add @nimiplatform/sdk
```

Until `@nimiplatform/sdk` is published, external `pnpm install` for scaffolded app repos will not succeed. The scaffold shape is still the intended public output.

Commands:

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create
pnpm dlx @nimiplatform/dev-tools nimi-app create
nimi-mod build
nimi-mod dev
nimi-mod doctor
nimi-mod pack
```

`nimi-mod` is for mod-author workflows. `nimi-app` currently exposes only `create`.

Suggested mod repo scripts:

```json
{
  "scripts": {
    "build": "nimi-mod build",
    "dev": "nimi-mod dev",
    "doctor": "nimi-mod doctor",
    "pack": "nimi-mod pack"
  }
}
```

Desktop-side mod development flow is UI-only:

1. Open `Settings > Mod Developer`
2. Enable `Developer Mode`
3. Add your mod directory as a `dev` source
4. Turn on `Auto Reload` if needed

Inside this monorepo, examples call the repo-local binaries:

```bash
node ../../dev-tools/bin/nimi-mod.mjs <command>
node ../../dev-tools/bin/nimi-app.mjs create
```
