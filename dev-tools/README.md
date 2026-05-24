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
pnpm add @nimiplatform/sdk @nimiplatform/nimi-kit
```

`nimi-app create` emits Tauri app-authoring scaffolds. Generated pack,
validate, and local-audit outputs are pre-submission self-checks only; public
Nimi App admission remains an upstream Platform review outcome.
`nimi-app doctor` verifies scaffold lock, managed glue, package-owned
projections, and boundary wording in a developer source checkout. `nimi-app
update` refreshes scaffold-managed glue and package-owned projections while
preserving app-owned product code.

Commands:

```bash
pnpm dlx @nimiplatform/dev-tools nimi-mod create
pnpm dlx @nimiplatform/dev-tools nimi-app create --profile standalone
pnpm dlx @nimiplatform/dev-tools nimi-app create --profile workspace-app
pnpm dlx @nimiplatform/dev-tools nimi-app doctor --dir path/to/app
pnpm dlx @nimiplatform/dev-tools nimi-app update --dir path/to/app
nimi-mod build
nimi-mod dev
nimi-mod doctor
nimi-mod pack
```

`nimi-mod pack` now writes two release assets under `dist/packages/`:

- `<package-id>.zip`: runtime-installable prebuilt mod archive
- `release.manifest.json`: sidecar release metadata for catalog indexing, digest verification, and signing

Release manifest generation is GitHub-first and env-driven. Common inputs:

- `NIMI_MOD_RELEASE_CHANNEL`
- `NIMI_MOD_ARTIFACT_URL`
- `NIMI_MOD_SIGNER_ID`
- `NIMI_MOD_SIGNING_KEY`
- `NIMI_MOD_PUBLISHER_ID`
- `NIMI_MOD_PUBLISHER_NAME`
- `NIMI_MOD_TRUST_TIER`

Reserved `nimi-app`-only release fields:

- `NIMI_MOD_APP_MODE`
- `NIMI_MOD_SCOPE_CATALOG_VERSION`
- `NIMI_MOD_MIN_RUNTIME_VERSION`

Those three fields are only valid when `NIMI_MOD_PACKAGE_TYPE=nimi-app`.

`nimi-mod` is for mod-author workflows. `nimi-app` exposes developer
app-authoring `create`, `doctor`, and `update` commands with the `standalone`
and `workspace-app` profiles. These commands do not create public admission,
permission grants, registry visibility, release descriptors, or installed-app
update truth.

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
